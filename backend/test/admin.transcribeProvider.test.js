/**
 * Tests for Admin.transcribeProvider field (#257 Item 1).
 *
 * Covers:
 *  - Default value is null when not specified (existing-doc fallback path)
 *  - Accepted enum values: 'openai' and 'paraformer'
 *  - Invalid value → save throws ValidationError
 *  - findOneAndUpdate transitions through both values + back to null
 */

const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');

let mongo;
let Admin;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Admin = mongoose.model('Admin');
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  if (Admin) await Admin.deleteMany({});
});

function adminFixture(extra = {}) {
  return {
    email: 'test@example.com',
    name: 'Test',
    surname: 'Admin',
    ...extra,
  };
}

test('1. Default transcribeProvider is null (existing-doc fallback)', async () => {
  const admin = await Admin.create(adminFixture());
  expect(admin.transcribeProvider).toBeNull();
});

test('2. transcribeProvider accepts "openai"', async () => {
  const admin = await Admin.create(adminFixture({ transcribeProvider: 'openai' }));
  expect(admin.transcribeProvider).toBe('openai');
});

test('3. transcribeProvider accepts "paraformer"', async () => {
  const admin = await Admin.create(adminFixture({ transcribeProvider: 'paraformer' }));
  expect(admin.transcribeProvider).toBe('paraformer');
});

test('4. Invalid transcribeProvider value rejected by enum', async () => {
  await expect(
    Admin.create(adminFixture({ transcribeProvider: 'whisper' }))
  ).rejects.toThrow(/transcribeProvider/);
});

test('5. findOneAndUpdate transitions: null → paraformer → openai → null', async () => {
  const admin = await Admin.create(adminFixture());
  expect(admin.transcribeProvider).toBeNull();

  await Admin.findByIdAndUpdate(admin._id, { transcribeProvider: 'paraformer' });
  let reloaded = await Admin.findById(admin._id);
  expect(reloaded.transcribeProvider).toBe('paraformer');

  await Admin.findByIdAndUpdate(admin._id, { transcribeProvider: 'openai' });
  reloaded = await Admin.findById(admin._id);
  expect(reloaded.transcribeProvider).toBe('openai');

  await Admin.findByIdAndUpdate(admin._id, { transcribeProvider: null });
  reloaded = await Admin.findById(admin._id);
  expect(reloaded.transcribeProvider).toBeNull();
});
