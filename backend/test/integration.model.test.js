/**
 * Tests for the Integration model (#325 / H1).
 *
 * Covers:
 *  - Defaults: enabled=false, status='disconnected', removed=false, meta={}
 *  - provider enum accepts 'whatsapp', rejects unknown
 *  - createdBy is required
 *  - unique (createdBy, provider) index enforced
 *  - upsert by (createdBy, provider) is idempotent (no duplicate rows)
 *  - cross-admin: same provider for two admins coexists
 */

const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');

let mongo;
let Integration;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Integration = mongoose.model('Integration');
  // Build the unique index in the in-memory server before exercising it.
  await Integration.init();
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  if (Integration) await Integration.deleteMany({});
});

function fixture(extra = {}) {
  return {
    createdBy: new mongoose.Types.ObjectId(),
    provider: 'whatsapp',
    ...extra,
  };
}

test('1. Defaults: enabled=false, status=disconnected, removed=false, meta={}', async () => {
  const doc = await Integration.create(fixture());
  expect(doc.enabled).toBe(false);
  expect(doc.status).toBe('disconnected');
  expect(doc.removed).toBe(false);
  expect(doc.meta).toEqual({});
  expect(doc.created).toBeInstanceOf(Date);
});

test('2. provider enum accepts "whatsapp"', async () => {
  const doc = await Integration.create(fixture({ provider: 'whatsapp' }));
  expect(doc.provider).toBe('whatsapp');
});

test('3. provider enum rejects unknown value', async () => {
  await expect(Integration.create(fixture({ provider: 'telegram' }))).rejects.toThrow(
    /provider/
  );
});

test('4. createdBy is required', async () => {
  await expect(Integration.create({ provider: 'whatsapp' })).rejects.toThrow(/createdBy/);
});

test('5. unique (createdBy, provider) rejects a second row for same admin+provider', async () => {
  const adminId = new mongoose.Types.ObjectId();
  await Integration.create(fixture({ createdBy: adminId }));
  await expect(Integration.create(fixture({ createdBy: adminId }))).rejects.toThrow(
    /E11000|duplicate key/
  );
});

test('6. upsert by (createdBy, provider) is idempotent — no duplicate rows', async () => {
  const adminId = new mongoose.Types.ObjectId();
  const filter = { createdBy: adminId, provider: 'whatsapp' };

  await Integration.findOneAndUpdate(
    filter,
    { enabled: true, status: 'qr_pending' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Integration.findOneAndUpdate(
    filter,
    { status: 'connected', meta: { phoneNumber: '+8613800138000' } },
    { upsert: true, new: true }
  );

  const rows = await Integration.find(filter);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('connected');
  expect(rows[0].enabled).toBe(true);
  expect(rows[0].meta.phoneNumber).toBe('+8613800138000');
});

test('7. cross-admin: same provider for two different admins coexists', async () => {
  await Integration.create(fixture({ createdBy: new mongoose.Types.ObjectId() }));
  await Integration.create(fixture({ createdBy: new mongoose.Types.ObjectId() }));
  expect(await Integration.countDocuments({ provider: 'whatsapp' })).toBe(2);
});
