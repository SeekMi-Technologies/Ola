/**
 * EM3 (issue #187, Ola #176 email integration) — salesperson.lookup_by_email.
 *
 * Covers:
 *   - happy / not-found / disabled / removed gates
 *   - case-insensitive + whitespace input normalization
 *   - field whitelist (defense against future Admin schema additions)
 *   - zod schema input validation
 *   - second-call follow-up: lookup → use _id as X-Acting-As → verify scoping
 *     (cross-references ISO controllerAdapter context propagation)
 */

const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

const { runWithContext } = require(path.join(BACKEND_ROOT, 'src/mcp/context'));

let salespersonTools;
let customerTools;
let mongo;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f)),
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // Late require: tool modules transitively load controllers that touch
  // models (e.g. clientController references Invoice). Models must be
  // registered before requiring the tools.
  // eslint-disable-next-line global-require
  salespersonTools = require(path.join(BACKEND_ROOT, 'src/mcp/tools/crud/salesperson'));
  // eslint-disable-next-line global-require
  customerTools = require(path.join(BACKEND_ROOT, 'src/mcp/tools/crud/customer'));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await mongoose.model('Admin').deleteMany({});
  await mongoose.model('Client').deleteMany({});
});

function findTool(tools, name) {
  return tools.tools.find((t) => t.name === name);
}

async function makeAdmin(overrides = {}) {
  return mongoose.model('Admin').create({
    email: 'test@example.com',
    name: 'Test',
    surname: 'Admin',
    role: 'admin',
    enabled: true,
    removed: false,
    language: 'zh',
    ...overrides,
  });
}

describe('salesperson.lookup_by_email — exposure', () => {
  test('module exports exactly one tool: lookup_by_email (no list, by design)', () => {
    expect(salespersonTools.tools).toHaveLength(1);
    expect(salespersonTools.tools[0].name).toBe('salesperson.lookup_by_email');
  });
});

describe('salesperson.lookup_by_email — happy path', () => {
  test('known enabled admin → found:true with all safe fields', async () => {
    const a = await makeAdmin({
      email: 'sales@olatech.ai',
      name: 'Yuandong',
      surname: 'Zhang',
      role: 'owner',
      language: 'en',
    });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'sales@olatech.ai' });

    expect(res.ok).toBe(true);
    expect(res.data.found).toBe(true);
    expect(res.data.salesperson._id.toString()).toBe(a._id.toString());
    expect(res.data.salesperson.email).toBe('sales@olatech.ai');
    expect(res.data.salesperson.name).toBe('Yuandong');
    expect(res.data.salesperson.surname).toBe('Zhang');
    expect(res.data.salesperson.role).toBe('owner');
    expect(res.data.salesperson.language).toBe('en');
  });
});

describe('salesperson.lookup_by_email — not-found gates', () => {
  test('unknown email → found:false with message containing the email', async () => {
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'nobody@nowhere.com' });
    expect(res.ok).toBe(true);
    expect(res.data.found).toBe(false);
    expect(res.data.message).toMatch(/No matching salesperson/);
    expect(res.data.message).toMatch(/nobody@nowhere\.com/);
    expect(res.data.salesperson).toBeUndefined();
  });

  test('disabled admin → found:false (do not propagate disabled identities)', async () => {
    await makeAdmin({ email: 'disabled@example.com', enabled: false });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'disabled@example.com' });
    expect(res.data.found).toBe(false);
  });

  test('removed admin → found:false', async () => {
    await makeAdmin({ email: 'removed@example.com', removed: true });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'removed@example.com' });
    expect(res.data.found).toBe(false);
  });
});

describe('salesperson.lookup_by_email — input normalization', () => {
  test('case-insensitive: User@Example.com matches stored user@example.com', async () => {
    await makeAdmin({ email: 'user@example.com' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'User@Example.com' });
    expect(res.data.found).toBe(true);
    expect(res.data.salesperson.email).toBe('user@example.com');
  });

  test('input with surrounding whitespace is trimmed before lookup', async () => {
    await makeAdmin({ email: 'trim@example.com' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: '  trim@example.com  ' });
    expect(res.data.found).toBe(true);
  });
});

describe('salesperson.lookup_by_email — field whitelist (security)', () => {
  test('returned salesperson contains ONLY {_id, email, name, surname, role, language}', async () => {
    await makeAdmin({
      email: 'secure@example.com',
      phone: '13800000000',
      jobTitle: 'Sales Manager',
      photo: 'avatar.png',
      onboarded: true,
    });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'secure@example.com' });

    expect(res.data.found).toBe(true);
    const sp = res.data.salesperson;
    const keys = Object.keys(sp).sort();
    expect(keys).toEqual(['_id', 'email', 'language', 'name', 'role', 'surname']);
  });

  test('explicit deny: response object never carries known sensitive/sealed keys', async () => {
    await makeAdmin({ email: 'denyfields@example.com' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'denyfields@example.com' });
    const sp = res.data.salesperson;
    const forbidden = [
      'password',
      'salt',
      'hash',
      'loggedSession',
      '_loggedSession',
      'verificationCode',
      'resetPasswordToken',
      'token',
      'phone',
      'jobTitle',
      'photo',
      'onboarded',
      'enabled',
      'removed',
      'created',
    ];
    for (const f of forbidden) {
      expect(sp).not.toHaveProperty(f);
    }
  });
});

describe('salesperson.lookup_by_email — zod schema validation', () => {
  test('rejects non-email input', () => {
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    expect(tool.inputSchema.email.safeParse('not-an-email').success).toBe(false);
    expect(tool.inputSchema.email.safeParse('').success).toBe(false);
    expect(tool.inputSchema.email.safeParse(123).success).toBe(false);
    expect(tool.inputSchema.email.safeParse(null).success).toBe(false);
  });

  test('accepts valid email format', () => {
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    expect(tool.inputSchema.email.safeParse('valid@example.com').success).toBe(true);
    expect(tool.inputSchema.email.safeParse('a.b+tag@sub.example.co.uk').success).toBe(true);
  });
});

describe('salesperson.lookup_by_email — security: query injection defense', () => {
  test('input shaped like a Mongo operator object is rejected at zod layer', () => {
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    // zod's .email() accepts only string-shaped emails; an object payload
    // attempting Mongo operator injection (e.g. `{ $ne: null }`) must fail
    // schema validation BEFORE reaching the handler.
    expect(tool.inputSchema.email.safeParse({ $ne: null }).success).toBe(false);
    expect(tool.inputSchema.email.safeParse({ $gt: '' }).success).toBe(false);
    expect(tool.inputSchema.email.safeParse(['a@b.com']).success).toBe(false);
  });

  test('email string containing $-prefixed substring is treated as literal', async () => {
    // Even if a string slips past zod (it won't — must be email format), our
    // findOne uses parameterized queries; mongoose treats values as literals,
    // not operators. Verify by inserting a "weird but valid email" and ensure
    // exact match still works.
    await makeAdmin({ email: 'weird+$ne@example.com' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'weird+$ne@example.com' });
    expect(res.data.found).toBe(true);
  });
});

describe('salesperson.lookup_by_email — robustness edges', () => {
  test('email at RFC 5321 practical max length still works', async () => {
    // 60-char local + @ + 100-char domain = 161 chars (well within real-world limits;
    // RFC theoretical max is 254 but most providers cap at ~64+~255).
    const longEmail = 'a'.repeat(60) + '@' + 'b'.repeat(50) + '.example.com';
    await makeAdmin({ email: longEmail });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: longEmail });
    expect(res.data.found).toBe(true);
    expect(res.data.salesperson.email).toBe(longEmail.toLowerCase());
  });

  test('idempotent: same lookup called twice returns identical result', async () => {
    await makeAdmin({ email: 'idem@example.com', name: 'I' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const r1 = await tool.handler({ email: 'idem@example.com' });
    const r2 = await tool.handler({ email: 'idem@example.com' });
    expect(r1.data).toEqual(r2.data);
  });

  test('disabled AND removed simultaneously → found:false (either gate is sufficient)', async () => {
    await makeAdmin({ email: 'both@example.com', enabled: false, removed: true });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'both@example.com' });
    expect(res.data.found).toBe(false);
  });

  test('admin enabled state change between calls reflects on next lookup (no stale cache)', async () => {
    // EM3 hits the DB on every call (no caching at this tool layer — caching
    // happens later in bootstrap.resolveActingAdmin for X-Acting-As resolution
    // only). Verify state changes are visible immediately.
    const a = await makeAdmin({ email: 'state@example.com' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');

    const r1 = await tool.handler({ email: 'state@example.com' });
    expect(r1.data.found).toBe(true);

    await mongoose.model('Admin').updateOne({ _id: a._id }, { enabled: false });

    const r2 = await tool.handler({ email: 'state@example.com' });
    expect(r2.data.found).toBe(false);
  });

  test('newly created admin is immediately findable (no warmup window)', async () => {
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const r1 = await tool.handler({ email: 'newcomer@example.com' });
    expect(r1.data.found).toBe(false);

    await makeAdmin({ email: 'newcomer@example.com' });

    const r2 = await tool.handler({ email: 'newcomer@example.com' });
    expect(r2.data.found).toBe(true);
  });

  test('multiple admins exist in DB — lookup returns ONLY the matched one', async () => {
    // Defensive: ensure the query is exact-match, not a partial / scan.
    await makeAdmin({ email: 'a@example.com', name: 'A' });
    await makeAdmin({ email: 'b@example.com', name: 'B' });
    await makeAdmin({ email: 'c@example.com', name: 'C' });
    const tool = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const res = await tool.handler({ email: 'b@example.com' });
    expect(res.data.found).toBe(true);
    expect(res.data.salesperson.name).toBe('B');
  });
});

describe('salesperson.lookup_by_email — second-call follow-up (ISO integration)', () => {
  test('lookup → take _id → use as acting-as → customer.search returns own customers only', async () => {
    // Two admins; each creates one customer. lookup admin A's email,
    // then run customer.search inside runWithContext({actingAdmin: A})
    // and verify only A's customer is visible.
    const adminA = await makeAdmin({ email: 'a@example.com' });
    const adminB = await makeAdmin({ email: 'b@example.com' });
    await mongoose.model('Client').create({
      name: 'AcmeOwnedByA',
      country: 'CN',
      createdBy: adminA._id,
      enabled: true,
      removed: false,
    });
    await mongoose.model('Client').create({
      name: 'BetaOwnedByB',
      country: 'US',
      createdBy: adminB._id,
      enabled: true,
      removed: false,
    });

    // Step 1: reverse-lookup admin A
    const lookup = findTool(salespersonTools, 'salesperson.lookup_by_email');
    const lookupRes = await lookup.handler({ email: 'a@example.com' });
    expect(lookupRes.data.found).toBe(true);
    const adminAId = lookupRes.data.salesperson._id;

    // Step 2: run customer.search with that _id as the acting-as admin
    const search = findTool(customerTools, 'customer.search');
    const searchRes = await runWithContext(
      { actingAdmin: { _id: adminAId }, isSystemFallback: false },
      async () => search.handler({ q: 'owned' }),
    );

    expect(searchRes.ok).toBe(true);
    expect(searchRes.data.found).toBe(true);
    const names = searchRes.data.results.map((c) => c.name);
    expect(names).toContain('AcmeOwnedByA');
    expect(names).not.toContain('BetaOwnedByB');
  });
});
