# Custom-Fields Registry — Spec

**Owner:** Yuandong · **Date:** 2026-06-26 · **Status:** Spec for review · **Track:** CRM (parallel to, independent of, the AI-native transformation)
**Relates to:** `doc/ai_native_transformation_plan.md` §Isolation (this is the D1 "per-tenant schema" answer, Tier 1).

---

## Goal

Let a tenant add their own fields to existing CRM entities (Client, Merch, Quote, …) **with no code and no deploy** — the Salesforce custom-fields / HubSpot properties model. The capability is engineered once; each field thereafter is pure data. One shared MongoDB, no connection refactor. The AI agent picks up a tenant's fields automatically at runtime.

**Example:** a tenant wants a "Notes" box on customers → they create one `CustomFieldDef` row via the admin UI; the field immediately appears in their customer form, list, and is readable/writable by the agent. No engineering involvement.

## Non-goals (not self-serve)

Tenants can extend the *schema of existing entities* with **fields**. They cannot self-serve: new entities/objects, relationships, a notes *feed* (timestamped log → use a first-class `Note` model instead), or a new field *type* we haven't implemented. New types are added once by us, then available to all tenants. For physical isolation / radically different data models → escalate to DB-per-tenant (Tier 2, see end).

---

## Design

Two pieces, both runtime-driven so no per-field code is ever needed:

1. **`CustomFieldDef` collection** — the per-tenant registry (one row per field, scoped by `createdBy`). This *is* the tenant's schema.
2. **A declared `customFields` container** on each opted-in entity — added via a Mongoose plugin, validated against the registry by plugin hooks.

Everything downstream (CRUD, validation, web forms, MCP tools) reads the registry at request time.

### Why a declared container is required

[create.js:5](../backend/src/controllers/middlewaresControllers/createCRUDController/create.js#L5) does `new Model({...req.body}).save()`, and Mongoose schemas are `strict: true` — **any key not declared in the schema is silently dropped.** So custom data must live under a *declared* `customFields` path; arbitrary top-level keys won't persist. [update.js:4](../backend/src/controllers/middlewaresControllers/createCRUDController/update.js#L4) uses `findOneAndUpdate(filter, req.body, {runValidators:true})` — a *query* path where document `pre('save')` hooks don't fire and Mixed fields have no validators, so update-path validation must hook the query middleware. **The core CRUD factory is never edited** (it's protected infra) — all behavior is added via the plugin.

---

## Data model

```js
// backend/src/models/appModels/CustomFieldDef.js
{
  removed:   { type: Boolean, default: false },   // soft-delete (never physical)
  enabled:   { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'Admin' },    // tenant scope (set by create.js)
  entity:    { type: String, required: true },    // 'client' | 'merch' | 'quote' | ...
  key:       { type: String, required: true },    // stored key, e.g. 'notes'
  label:     { type: String, required: true },    // display label, e.g. 'Notes'
  type:      { type: String, enum: ['text','textarea','number','date','boolean','select','multiselect','url','email'], required: true },
  required:  { type: Boolean, default: false },
  options:   [{ value: String, label: String }],  // select / multiselect
  unique:    { type: Boolean, default: false },   // unique within (tenant, entity)
  indexed:   { type: Boolean, default: false },   // provision a partial index
  showInList:{ type: Boolean, default: false },   // render as a table column
  order:     { type: Number,  default: 0 },
}
// compound unique index: { createdBy: 1, entity: 1, key: 1 }
```

```js
// backend/src/models/utils/customFieldsPlugin.js
module.exports = function customFieldsPlugin(schema) {
  schema.add({ customFields: { type: mongoose.Schema.Types.Mixed, default: {} } });
  schema.pre('validate', async function () {            // create path (.save())
    await validateCustomFields(this.constructor.modelName, this.createdBy, this);
  });
  schema.pre('findOneAndUpdate', async function () {    // update path (query middleware)
    await validateUpdateCustomFields(this);
  });
};
// opt-in per entity (one line): Client.js / Merch.js / Quote.js → schema.plugin(customFieldsPlugin)
```

---

## Validation

`validateCustomFields(entity, createdBy, payload)` loads that tenant's defs (`CustomFieldDef.find({ createdBy, entity, removed:false })`, behind a short TTL cache like [the MCP acting-as cache](../backend/src/mcp/bootstrap.js)) and enforces:

- **required** missing → reject with a specific message (no silent drop);
- **type** → number is numeric, date parses, select value ∈ `options`;
- **unique** → no other doc in `(createdBy, entity)` holds that `customFields.<key>` value;
- **unknown keys** → reject keys with no def (prevents typo'd garbage accumulating).

Cache busts on `CustomFieldDef` create/update/delete (or rides the TTL).

---

## MCP / agent integration

The agent reads/writes CRM only through MCP tools, so custom fields flow with minimal work:

- **Discover:** the auto-registered `customfielddef.search` (or a small `schema.describe`) lets the router/worker learn a tenant's fields at runtime — "this tenant tracks `notes` on clients."
- **Write:** widen `customer.*` / `quote.*` / `merch.*` Zod inputs with `customFields: z.record(z.any()).optional()`; the plugin validates server-side.
- **Read:** ensure tool serializers don't strip `customFields` from the returned doc.
- **Zero per-tenant code** in the AI core — it learns the shape from the same registry.

---

## Frontend

- **Field-admin page** — a `CrudModule` over `CustomFieldDef` (define/edit/order fields per entity). The "add a field" widget.
- **Dynamic form** — entity forms ([src/forms/](../frontend/src/forms/)) fetch the tenant's defs for that entity and render AntD inputs by `type` (Input / Input.TextArea / InputNumber / DatePicker / Switch / Select), after the static fields.
- **Dynamic columns** — `dataTableColumns` appends columns for defs with `showInList: true`.

---

## Indexing & querying

- Filter/search by custom field rides the existing `fields` filter in [search.js](../backend/src/controllers/middlewaresControllers/createCRUDController) (`customFields.<key>`), still `.where('createdBy', adminId)`.
- For `unique`/`indexed` defs, provision a **partial index** (`partialFilterExpression: { 'customFields.<key>': { $exists: true } }`) **idempotently** — never auto-dropped.

## Edge cases

- **Mixed mutation** → call `markModified('customFields')` after merge (plugin handles it).
- **findOneAndUpdate replaces the sub-doc** → frontend sends the *full* `customFields` object (simplest); add dot-notation merge only if partial updates become necessary.
- **Delete/rename a field** → soft-delete the def, leave existing data in place (no destructive migration); a renamed key is a new def, old data stays under the old key until backfilled.
- **Type change** → disallow in-place type change on a def with data; require a new field (avoids silent coercion bugs).

---

## Build checklist (backlog — atomic, SRP)

**Backend (one-time)**
1. `CustomFieldDef` model + thin controller → auto-registers `/customfielddef/*` CRUD (model glob).
2. `customFieldsPlugin` → declared `customFields` path + `pre('validate')` + `pre('findOneAndUpdate')` hooks.
3. Validation fn + per-tenant defs TTL cache (required / type / options / unique / reject-unknown) + cache-bust on def change.
4. Opt entities in (`schema.plugin(...)` on Client, Merch, Quote …).
5. Widen MCP tool Zod inputs (`customer.*`, `quote.*`, `merch.*`) with `customFields` passthrough; ensure not stripped on read.
6. On-demand idempotent partial-index provisioning for `unique`/`indexed` defs.

**Frontend (one-time)**
7. Field-admin page (CRUD over `CustomFieldDef`).
8. Dynamic form rendering + dynamic table columns by `type`.

After 1–8 ship, **every future field is pure data** — no code, no deploy, works in the web UI *and* for the AI agent.

---

## Acceptance (E2E)

Define a `client.notes` textarea for tenant A → create a customer with a note → read it back in UI + list column → agent reads and appends a note via `customer.update`. Negatives that must hold: required-missing rejected with a clear message; unknown-key rejected; tenant B (no def) never sees A's field; A's `unique` field rejects a duplicate. Index provisioned idempotently (second run is a no-op).

## Effort

Backend ~2–3 days · Frontend ~3–4 days (dominant) · tests + E2E ~1 day → **~1 week**, runnable in parallel with the AI transformation (no collision — the AI core touches CRM only through MCP, which honors `createdBy`/`X-Acting-As` regardless of physical storage).

---

## Escalation to Tier 2 (DB-per-tenant)

Custom-fields covers per-tenant *fields*. Move a tenant to its own Mongo database only for: physical/compliance isolation, entirely different entities/relations, or noisy-neighbor scaling — typically a few enterprise tenants. That's a connection-manager refactor ([server.js](../backend/src/server.js) single `mongoose.connect` → tenant-resolved connections). Cheap insurance now: centralize model access behind one "`adminId` → connection" resolver that today always returns the default connection, so promoting a tenant later is a routing change, not a rewrite.
