// HTTP-layer decideActingAdmin E2E with real Mongo. Fail-closed on missing
// header for business tools; SYSTEM_TOOLS whitelist still allows protocol
// methods + salesperson.lookup_by_email to fall back to systemAdmin.

const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

const {
  resolveSystemAdmin,
  invalidateActingAsCache,
} = require(path.join(BACKEND_ROOT, 'src/mcp/bootstrap'));
const {
  decideActingAdmin,
  SYSTEM_TOOLS,
} = require(path.join(BACKEND_ROOT, 'src/mcp/headerResolver'));

let mongo;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f)),
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  invalidateActingAsCache();
  await mongoose.model('Admin').deleteMany({});
});

async function makeAdmin(overrides = {}) {
  return mongoose.model('Admin').create({
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    name: 'T',
    surname: 'A',
    role: 'admin',
    enabled: true,
    removed: false,
    ...overrides,
  });
}

async function bootstrapWithSystemAdmin() {
  await mongoose.model('Admin').create({
    email: 'sys@example.com',
    name: 'Sys',
    surname: 'Admin',
    role: 'owner',
    enabled: true,
    removed: false,
  });
  await resolveSystemAdmin();
}

describe('decideActingAdmin — fail-closed when header missing for business tool', () => {
  test('undefined header + customer.create → 401 UNAUTHORIZED', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'customer.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe('UNAUTHORIZED');
    expect(d.message).toMatch(/X-Acting-As/);
  });

  test('empty string + merch.create → 401 UNAUTHORIZED', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin('', 'merch.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe('UNAUTHORIZED');
  });

  test('whitespace-only + quote.create → 401 UNAUTHORIZED', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin('   ', 'quote.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe('UNAUTHORIZED');
  });

  test('null + quote.generate_pdf_url → 401 (PDF requires acting-as)', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(null, 'quote.generate_pdf_url');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe('UNAUTHORIZED');
  });

  test('missing header + unknown toolLabel → 401 (fail-closed by default)', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'mcp.request');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe('UNAUTHORIZED');
  });

  test('missing header + undefined toolLabel → 401 (no whitelist match)', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, undefined);
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
    expect(d.code).toBe('UNAUTHORIZED');
  });
});

describe('decideActingAdmin — SYSTEM_TOOLS whitelist falls back to systemAdmin', () => {
  test('missing header + initialize → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'initialize');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
    expect(d.actingAdmin.email).toBe('sys@example.com');
  });

  test('missing header + tools/list → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'tools/list');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + resources/list → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'resources/list');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + prompts/list → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'prompts/list');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + ping → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'ping');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + salesperson.lookup_by_email → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'salesperson.lookup_by_email');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
    expect(d.actingAdmin.email).toBe('sys@example.com');
  });

  test('missing header + notifications/initialized → systemAdmin fallback (handshake)', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'notifications/initialized');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + notifications/cancelled → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'notifications/cancelled');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + notifications/progress → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'notifications/progress');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + notifications/roots/list_changed → systemAdmin fallback', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'notifications/roots/list_changed');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(true);
  });

  test('missing header + unknown notifications/ method → 401 (not whitelisted)', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin(undefined, 'notifications/unknown_method');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(401);
  });

  test('SYSTEM_TOOLS export contains exactly the documented set', () => {
    expect(Array.from(SYSTEM_TOOLS).sort()).toEqual(
      [
        'initialize',
        'notifications/cancelled',
        'notifications/initialized',
        'notifications/progress',
        'notifications/roots/list_changed',
        'ping',
        'prompts/list',
        'resources/list',
        'salesperson.lookup_by_email',
        'tools/list',
      ].sort(),
    );
  });
});

describe('decideActingAdmin — header validation (unchanged behaviour)', () => {
  test('non-ObjectId header → 400 VALIDATION', async () => {
    await bootstrapWithSystemAdmin();
    const d = await decideActingAdmin('not-a-valid-id', 'customer.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(400);
    expect(d.code).toBe('VALIDATION');
  });

  test('unknown ObjectId → 403 NOT_FOUND', async () => {
    await bootstrapWithSystemAdmin();
    const fakeId = new mongoose.Types.ObjectId().toString();
    const d = await decideActingAdmin(fakeId, 'customer.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('NOT_FOUND');
  });

  test('removed admin → 403 PERMISSION', async () => {
    await bootstrapWithSystemAdmin();
    const a = await makeAdmin({ email: 'gone@example.com', removed: true });
    const d = await decideActingAdmin(a._id.toString(), 'customer.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('PERMISSION');
  });

  test('disabled admin → 403 PERMISSION', async () => {
    await bootstrapWithSystemAdmin();
    const a = await makeAdmin({ email: 'off@example.com', enabled: false });
    const d = await decideActingAdmin(a._id.toString(), 'customer.create');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
    expect(d.code).toBe('PERMISSION');
  });

  test('valid enabled admin + business tool → 200, not fallback', async () => {
    await bootstrapWithSystemAdmin();
    const a = await makeAdmin({ email: 'sales@example.com' });
    const d = await decideActingAdmin(a._id.toString(), 'customer.create');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(false);
    expect(d.actingAdmin.email).toBe('sales@example.com');
  });

  test('header value with surrounding whitespace → trimmed and resolved', async () => {
    await bootstrapWithSystemAdmin();
    const a = await makeAdmin({ email: 'trimmed@example.com' });
    const d = await decideActingAdmin(
      `  ${a._id.toString()}  `,
      'customer.create',
    );
    expect(d.ok).toBe(true);
    expect(d.actingAdmin.email).toBe('trimmed@example.com');
  });

  test('valid header BEATS SYSTEM_TOOLS — explicit identity wins', async () => {
    await bootstrapWithSystemAdmin();
    const a = await makeAdmin({ email: 'real@example.com' });
    const d = await decideActingAdmin(a._id.toString(), 'initialize');
    expect(d.ok).toBe(true);
    expect(d.isSystemFallback).toBe(false);
    expect(d.actingAdmin.email).toBe('real@example.com');
  });
});
