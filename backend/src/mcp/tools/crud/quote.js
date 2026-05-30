// quote.* MCP tools (A7, issue #53)
//
// Wraps `quoteController`. 4 methods: search / read / create / update.
// NO delete in v1 (TD).
//
// quote.create is the heart of the Lead-to-Quote loop. Special rules:
//   - items[].price may be null  → MCP layer rewrites to 0 (Joi requires
//     number; price=0 is the "Agent didn't get a price" sentinel and the
//     salesperson edits it before sending). Memory locks this contract.
//   - `total` field is rejected at the MCP layer — server recomputes via
//     helpers.calculate.* (B-phase rule).
//   - currency / exchangeRate enforcement (USD→1, CNY>1 required) is
//     delegated to the controller (B3) — we do not duplicate the rule here.
//   - Sensible defaults are auto-filled when the Agent omits boilerplate:
//     number (Q-yyyymmddHHMM), year (current), status ('draft'),
//     date (today), expiredDate (today + 30d).
//
// quote.search currently matches on the `number` field only — that's the
// only short text identifier on the schema. Reads via id are the primary
// access pattern; search is a fallback for the Agent.

const { z } = require('zod');
const mongoose = require('mongoose');
const quoteController = require('@/controllers/appControllers/quoteController');
const { runController } = require('../../adapters/controllerAdapter');
const { getCurrentActingAdmin } = require('../../context');

// Auto-fill `items[].description` from the Merch master record (by
// serialNumber) so the generated Quote shows meaningful descriptions in
// the UI even when the Agent only passed itemName/quantity/price.
// EN preferred, falls back to CN (Phase N en-first default; Ola serves
// both US and CN markets, salesperson sets quote-document language at
// the consolidating step, default English). Items where the Agent
// already provided a description are left untouched. Items whose itemName
// doesn't match any Merch are also left untouched (no silent failure,
// no fabrication).
//
// Returns `{items, warnings}`. `warnings[]` is non-empty whenever an item
// ended up with a blank description that the salesperson will have to
// back-fill manually — either because the serialNumber wasn't found or
// because the Merch record itself has no description. The caller surfaces
// these into the MCP envelope so the Agent can read them verbatim to the
// salesperson (per SOUL.md). Never silent — see issue #58.
async function enrichItemDescriptions(items) {
  const Merch = mongoose.model('Merch');
  const warnings = [];

  const serialNumbersToLookUp = items
    .filter((it) => !it.description && it.itemName)
    .map((it) => it.itemName);

  if (serialNumbersToLookUp.length === 0) {
    return { items, warnings };
  }

  const merchDocs = await Merch.find({
    serialNumber: { $in: serialNumbersToLookUp },
    removed: false,
  }).lean();
  const bySerial = new Map(merchDocs.map((m) => [m.serialNumber, m]));

  const enriched = items.map((it) => {
    if (it.description) return it;
    const m = bySerial.get(it.itemName);
    if (!m) {
      warnings.push(
        `${it.itemName}: serialNumber not matched in Merch — description and unit left blank`,
      );
      return it;
    }
    const description = m.description_en || m.description_cn || '';
    if (!description) {
      warnings.push(
        `${it.itemName}: found in Merch but both description_cn and description_en are empty — description left blank`,
      );
    }
    return { ...it, description };
  });

  return { items: enriched, warnings };
}

// PR #193 follow-up: dropped the dead `call()` wrapper. ISO3 made it a
// no-op around runController since context now provides the admin.

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }

function defaultQuoteNumber(now = new Date()) {
  return `Q-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function plusDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

const ItemShape = z.object({
  itemName: z.string().min(1).describe('Merch serialNumber or human-readable label'),
  quantity: z.number().positive(),
  price: z.number().nullable().describe('Unit price; null = Agent did not get a price (rewritten to 0 server-side, salesperson fills later)'),
  description: z.string().optional(),
  unit_en: z.string().optional(),
  unit_cn: z.string().optional(),
});

const search = {
  name: 'quote.search',
  description: 'Search quotes by quote number (partial match). Returns {found:true, results:[...]} or {found:false, message}.',
  inputSchema: {
    q: z.string().min(1).describe('Quote number fragment'),
  },
  handler: async ({ q }) => {
    const res = await runController(quoteController.search, { query: { q, fields: 'number' } });
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
      return { ok: true, data: { found: true, results: res.data } };
    }
    return { ok: true, data: { found: false, message: 'No matching quote' } };
  },
};

const read = {
  name: 'quote.read',
  description: 'Read a single quote by id (includes items, totals, currency, status).',
  inputSchema: { id: z.string().min(1) },
  handler: async ({ id }) => runController(quoteController.read, { params: { id } }),
};

const create = {
  name: 'quote.create',
  description:
    'Create a new draft quote. Required: client (customer _id), items[], currency. Optional: exchangeRate (REQUIRED and >1 when currency=CNY; must be 1 or omitted when currency=USD). The Agent must NOT pass `total` — it is computed server-side. Items with unknown price should be sent as price:null (rewritten to 0; salesperson fills before sending).',
  inputSchema: {
    client: z.string().min(1).describe('Customer _id from customer.search/create'),
    currency: z.enum(['USD', 'CNY']),
    exchangeRate: z.number().positive().optional(),
    items: z.array(ItemShape).min(1),
    notes: z.array(z.string()).optional(),
    termsOfDelivery: z.array(z.string()).optional(),
    paymentTerms: z.array(z.string()).optional(),
    freight: z.number().optional(),
    discount: z.number().optional(),
  },
  handler: async (input) => {
    // MCP-layer guard: total is server-computed, never trusted from caller.
    if ('total' in input) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'quote.create rejects `total` — totals are computed server-side',
      };
    }

    // Rewrite null prices → 0 (Joi requires number; price=0 is the "no price yet" sentinel).
    let items = input.items.map((it) => ({
      itemName: it.itemName,
      description: it.description || '',
      quantity: it.quantity,
      price: it.price == null ? 0 : it.price,
      total: 0, // server recomputes
      unit_en: it.unit_en || '',
      unit_cn: it.unit_cn || '',
    }));
    const enrichResult = await enrichItemDescriptions(items);
    items = enrichResult.items;
    const warnings = enrichResult.warnings;

    const now = new Date();
    const body = {
      client: input.client,
      number: defaultQuoteNumber(now),
      year: now.getFullYear(),
      status: 'draft',
      date: now,
      expiredDate: plusDays(now, 30),
      currency: input.currency,
      items,
      notes: input.notes || [],
      termsOfDelivery: input.termsOfDelivery || [],
      paymentTerms: input.paymentTerms || [],
      freight: input.freight ?? 0,
      discount: input.discount ?? 0,
    };
    if (input.exchangeRate !== undefined) body.exchangeRate = input.exchangeRate;

    const result = await runController(quoteController.create, { body });
    if (result.ok && warnings.length > 0) {
      return { ...result, warnings };
    }
    return result;
  },
};

const update = {
  name: 'quote.update',
  description:
    'Partial update of a quote by id (PATCH semantics). Only the fields you pass are changed; everything else is preserved from the current persisted quote. The Agent does NOT need to re-pass number / date / status / expiredDate / client / currency / items unless they are actually being changed. Items is array-replacement: if you pass items, you pass the FULL new list.',
  inputSchema: {
    id: z.string().min(1),
    client: z.string().min(1).optional(),
    currency: z.enum(['USD', 'CNY']).optional(),
    exchangeRate: z.number().positive().optional(),
    items: z.array(ItemShape).min(1).optional(),
    status: z.string().optional(),
    notes: z.array(z.string()).optional(),
    termsOfDelivery: z.array(z.string()).optional(),
    paymentTerms: z.array(z.string()).optional(),
    freight: z.number().optional(),
    discount: z.number().optional(),
    number: z.string().optional(),
    year: z.number().optional(),
    date: z.string().optional(),
    expiredDate: z.string().optional(),
  },
  handler: async ({ id, ...rest }) => {
    if ('total' in rest) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'quote.update rejects `total` — totals are computed server-side',
      };
    }

    // PATCH: load the persisted quote first, merge only fields the agent
    // actually passed. Bug history (issue #198): previously this handler used
    // `||` against fresh defaults (number=defaultQuoteNumber(now), status='draft'…)
    // so an agent omitting those fields silently got them rewritten.
    const readRes = await runController(quoteController.read, { params: { id } });
    if (!readRes.ok) return readRes;
    const existing = readRes.data;

    let items;
    let warnings = [];
    if (rest.items !== undefined) {
      items = rest.items.map((it) => ({
        itemName: it.itemName,
        description: it.description || '',
        quantity: it.quantity,
        price: it.price == null ? 0 : it.price,
        total: 0,
        unit_en: it.unit_en || '',
        unit_cn: it.unit_cn || '',
      }));
      const enrichResult = await enrichItemDescriptions(items);
      items = enrichResult.items;
      warnings = enrichResult.warnings;
    } else {
      items = (existing.items || []).map((it) => ({
        itemName: it.itemName,
        description: it.description || '',
        quantity: it.quantity,
        price: it.price,
        total: it.total || 0,
        unit_en: it.unit_en || '',
        unit_cn: it.unit_cn || '',
      }));
    }

    // Quote schema autopopulates `client` — existing.client is the populated
    // Client doc, not a raw ObjectId. Pull the _id back out for the update.
    const existingClientId =
      existing.client && existing.client._id
        ? String(existing.client._id)
        : String(existing.client);

    const body = {
      client: rest.client !== undefined ? rest.client : existingClientId,
      number: rest.number !== undefined ? rest.number : existing.number,
      year: rest.year !== undefined ? rest.year : existing.year,
      status: rest.status !== undefined ? rest.status : existing.status,
      date: rest.date !== undefined ? rest.date : existing.date,
      expiredDate: rest.expiredDate !== undefined ? rest.expiredDate : existing.expiredDate,
      currency: rest.currency !== undefined ? rest.currency : existing.currency,
      items,
      notes: rest.notes !== undefined ? rest.notes : (existing.notes || []),
      termsOfDelivery:
        rest.termsOfDelivery !== undefined ? rest.termsOfDelivery : (existing.termsOfDelivery || []),
      paymentTerms:
        rest.paymentTerms !== undefined ? rest.paymentTerms : (existing.paymentTerms || []),
      freight: rest.freight !== undefined ? rest.freight : (existing.freight ?? 0),
      discount: rest.discount !== undefined ? rest.discount : (existing.discount ?? 0),
    };

    // exchangeRate: prefer agent-passed value; else preserve existing only when
    // currency hasn't changed (otherwise let controller B3 validation re-run
    // with the right defaults — USD must be 1, CNY must be > 1 explicitly).
    if (rest.exchangeRate !== undefined) {
      body.exchangeRate = rest.exchangeRate;
    } else if (rest.currency === undefined || rest.currency === existing.currency) {
      if (existing.exchangeRate !== undefined && existing.exchangeRate !== null) {
        body.exchangeRate = existing.exchangeRate;
      }
    }

    const result = await runController(quoteController.update, { params: { id }, body });
    if (result.ok && warnings.length > 0) {
      return { ...result, warnings };
    }
    return result;
  },
};

const generatePdfUrl = {
  name: 'quote.generate_pdf_url',
  description:
    'Return a downloadable PDF URL for an existing quote. Idempotent and safe to re-call; the PDF is regenerated server-side on each download. Useful any time an agent needs to surface a PDF link for a quote, not just after creation.',
  inputSchema: {
    id: z.string().min(1).describe('Quote _id (24-char Mongo ObjectId)'),
  },
  handler: async ({ id }) => {
    if (!mongoose.isValidObjectId(id)) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: `Invalid quote id (must be a 24-char hex ObjectId): ${id}`,
      };
    }
    let actingAdmin = null;
    try {
      actingAdmin = getCurrentActingAdmin();
    } catch (_outsideScope) {
      actingAdmin = null;
    }
    if (!actingAdmin || !actingAdmin._id) {
      return {
        ok: false,
        code: 'PERMISSION',
        message: 'quote.generate_pdf_url requires an authenticated admin context',
      };
    }
    const q = await mongoose
      .model('Quote')
      .findOne({ _id: id, removed: false, createdBy: actingAdmin._id })
      .select('_id')
      .lean();
    if (!q) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `Quote not found (id=${id})`,
      };
    }
    const baseRaw =
      process.env.PUBLIC_SERVER_FILE ||
      `http://localhost:${process.env.PORT || 8888}/`;
    const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
    return {
      ok: true,
      data: { url: `${base}/download/quote/quote-${id}.pdf` },
    };
  },
};

module.exports = {
  tools: [search, read, create, update, generatePdfUrl],
  // Test-only export — enrichItemDescriptions is the auto-fill helper that
  // populates `description` from Merch.description_en (preferred) or
  // description_cn (fallback). Surfaced so backend/test/language.test.js can
  // assert the en-first ordering without spinning the full quote.create stack.
  __forTesting: { enrichItemDescriptions },
};
