/**
 * EM6 (issue #170, Ola #176) — quote.generate_pdf_url.
 *
 * Verifies the URL-generation tool returns a correct, idempotent, env-aware
 * URL pointing to the existing public /download/quote/quote-<id>.pdf
 * endpoint. The PDF generation chain itself (Gotenberg, pdfController) is
 * pre-existing and out of scope.
 */

const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const { runWithContext } = require(path.join(BACKEND_ROOT, 'src/mcp/context'));

let quoteTools;
let mongo;
const ADMIN_A_ID = new mongoose.Types.ObjectId();
const ADMIN_B_ID = new mongoose.Types.ObjectId();
const ADMIN_A = { _id: ADMIN_A_ID, email: 'a@example.com' };
const ADMIN_B = { _id: ADMIN_B_ID, email: 'b@example.com' };

async function callAs(admin, fn) {
  return runWithContext({ actingAdmin: admin, isSystemFallback: false }, fn);
}

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f)),
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // eslint-disable-next-line global-require
  quoteTools = require(path.join(BACKEND_ROOT, 'src/mcp/tools/crud/quote'));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await mongoose.model('Quote').deleteMany({});
  await mongoose.model('Client').deleteMany({});
  // Reset env so tests are deterministic
  delete process.env.PUBLIC_SERVER_FILE;
  delete process.env.PORT;
});

function findTool(name) {
  return quoteTools.tools.find((t) => t.name === name);
}

async function makeQuote(overrides = {}) {
  const Client = mongoose.model('Client');
  const ownerId = overrides.createdBy || ADMIN_A_ID;
  const client = await Client.create({
    name: `TestCustomer-${Math.random().toString(36).slice(2, 8)}`,
    country: 'CN',
    createdBy: ownerId,
  });
  return mongoose.model('Quote').create({
    number: `Q-TEST-${Math.random().toString(36).slice(2, 8)}`,
    year: 2026,
    client: client._id,
    items: [
      {
        itemName: 'X',
        description: 'X',
        quantity: 1,
        price: 1,
        total: 1,
        unit_en: 'PCS',
        unit_cn: '个',
      },
    ],
    currency: 'USD',
    subTotal: 1,
    taxTotal: 0,
    total: 1,
    status: 'draft',
    date: new Date(),
    expiredDate: new Date(),
    createdBy: ownerId,
    removed: false,
    ...overrides,
  });
}

describe('quote.generate_pdf_url — exposure + registration', () => {
  test('tool is exported with the right name', () => {
    expect(findTool('quote.generate_pdf_url')).toBeDefined();
    expect(findTool('quote.generate_pdf_url').name).toBe('quote.generate_pdf_url');
  });

  test('does NOT require quote.create — usable independently (closes #170)', () => {
    // The tool is a top-level export, not a hidden method on quote.create.
    // Anyone who has a quote _id can call it directly.
    const tool = findTool('quote.generate_pdf_url');
    expect(typeof tool.handler).toBe('function');
    // No prerequisite handlers, no internal state coupling
  });
});

describe('quote.generate_pdf_url — happy path', () => {
  test('existing quote → returns URL pointing to /download/quote/quote-<id>.pdf', async () => {
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(res.ok).toBe(true);
    expect(res.data.url).toMatch(
      new RegExp(`/download/quote/quote-${q._id.toString()}\\.pdf$`),
    );
  });

  test('default URL base is http://localhost:8888 when no env set', async () => {
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(res.data.url).toMatch(/^http:\/\/localhost:8888\/download\/quote\//);
  });

  test('PUBLIC_SERVER_FILE env overrides default (with trailing slash)', async () => {
    process.env.PUBLIC_SERVER_FILE = 'https://app.olatech.ai/';
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(res.data.url).toBe(
      `https://app.olatech.ai/download/quote/quote-${q._id.toString()}.pdf`,
    );
  });

  test('PUBLIC_SERVER_FILE env without trailing slash works too', async () => {
    process.env.PUBLIC_SERVER_FILE = 'https://app.olatech.ai';
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(res.data.url).toBe(
      `https://app.olatech.ai/download/quote/quote-${q._id.toString()}.pdf`,
    );
  });

  test('PORT env tweaks dev-fallback URL', async () => {
    process.env.PORT = '9999';
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(res.data.url).toMatch(/^http:\/\/localhost:9999\/download\/quote\//);
  });
});

describe('quote.generate_pdf_url — error gates', () => {
  test('non-ObjectId string → VALIDATION', async () => {
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: 'not-an-objectid' }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('VALIDATION');
    expect(res.message).toMatch(/Invalid quote id/);
  });

  test('valid ObjectId but quote not found → NOT_FOUND', async () => {
    const tool = findTool('quote.generate_pdf_url');
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await callAs(ADMIN_A, () => tool.handler({ id: fakeId }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
    expect(res.message).toMatch(/Quote not found/);
    expect(res.message).toMatch(fakeId);
  });

  test('removed quote → NOT_FOUND (do not generate URL for soft-deleted quotes)', async () => {
    const q = await makeQuote({ removed: true });
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
  });

  test('zod schema rejects empty / null / non-string id', () => {
    const tool = findTool('quote.generate_pdf_url');
    expect(tool.inputSchema.id.safeParse('').success).toBe(false);
    expect(tool.inputSchema.id.safeParse(null).success).toBe(false);
    expect(tool.inputSchema.id.safeParse(123).success).toBe(false);
    expect(tool.inputSchema.id.safeParse({ $ne: null }).success).toBe(false);
  });
});

describe('quote.generate_pdf_url — robustness', () => {
  test('idempotent: same id called twice returns identical URL', async () => {
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const r1 = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    const r2 = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(r1.data.url).toBe(r2.data.url);
  });

  test('concurrent calls for different quotes return distinct URLs', async () => {
    const [q1, q2, q3] = await Promise.all([makeQuote(), makeQuote(), makeQuote()]);
    const tool = findTool('quote.generate_pdf_url');
    const [r1, r2, r3] = await Promise.all([
      callAs(ADMIN_A, () => tool.handler({ id: q1._id.toString() })),
      callAs(ADMIN_A, () => tool.handler({ id: q2._id.toString() })),
      callAs(ADMIN_A, () => tool.handler({ id: q3._id.toString() })),
    ]);
    expect(r1.data.url).toContain(q1._id.toString());
    expect(r2.data.url).toContain(q2._id.toString());
    expect(r3.data.url).toContain(q3._id.toString());
    expect(new Set([r1.data.url, r2.data.url, r3.data.url]).size).toBe(3);
  });

  test('quote state change between calls is reflected (no URL caching)', async () => {
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const r1 = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(r1.ok).toBe(true);

    await mongoose.model('Quote').updateOne({ _id: q._id }, { removed: true });

    const r2 = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('NOT_FOUND');
  });
});

describe('quote.generate_pdf_url — URL format strict', () => {
  test('URL matches expected regex shape', async () => {
    process.env.PUBLIC_SERVER_FILE = 'https://app.olatech.ai/';
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () => tool.handler({ id: q._id.toString() }));
    // Strict shape: scheme://host[:port]/download/quote/quote-<24hex>.pdf
    expect(res.data.url).toMatch(
      /^https?:\/\/[^/]+\/download\/quote\/quote-[a-f0-9]{24}\.pdf$/,
    );
  });
});

describe('quote.generate_pdf_url — acting-as ownership isolation', () => {
  test('admin A cannot generate URL for admin B quote → NOT_FOUND', async () => {
    const adminBQuote = await makeQuote({ createdBy: ADMIN_B_ID });
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_A, () =>
      tool.handler({ id: adminBQuote._id.toString() }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
    expect(res.message).toMatch(adminBQuote._id.toString());
  });

  test('admin B can generate URL for own quote (positive control)', async () => {
    const adminBQuote = await makeQuote({ createdBy: ADMIN_B_ID });
    const tool = findTool('quote.generate_pdf_url');
    const res = await callAs(ADMIN_B, () =>
      tool.handler({ id: adminBQuote._id.toString() }),
    );
    expect(res.ok).toBe(true);
    expect(res.data.url).toContain(adminBQuote._id.toString());
  });

  test('called without runWithContext scope → PERMISSION (programmer error)', async () => {
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await tool.handler({ id: q._id.toString() });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('PERMISSION');
    expect(res.message).toMatch(/authenticated admin context/);
  });

  test('null actingAdmin in scope → PERMISSION (system fallback never owns quotes)', async () => {
    const q = await makeQuote();
    const tool = findTool('quote.generate_pdf_url');
    const res = await runWithContext(
      { actingAdmin: null, isSystemFallback: true },
      () => tool.handler({ id: q._id.toString() }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe('PERMISSION');
  });
});
