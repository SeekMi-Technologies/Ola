/**
 * Tests for Job model — generic async-task tracker (#249 Plan B v2 item 1).
 *
 * Covers:
 *  - Happy path: required fields persist, defaults applied
 *  - Required field missing (type) → save throws
 *  - Invalid status enum → save throws
 *  - Cross-tenant: query with createdBy filter respects it (404 pattern)
 *  - removed:true → standard list filter excludes
 *  - Status transition pending → running → done persists state + result blob
 */

const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');

let mongo;
let Job;
const adminAId = new mongoose.Types.ObjectId();
const adminBId = new mongoose.Types.ObjectId();
const fileARefId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Job = mongoose.model('Job');
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  if (Job) await Job.deleteMany({});
});

test('1. Happy: required fields persist + defaults applied', async () => {
  const job = await Job.create({
    createdBy: adminAId,
    type: 'transcription',
    refModel: 'File',
    refId: fileARefId,
  });
  expect(job._id).toBeDefined();
  expect(job.createdBy.toString()).toBe(adminAId.toString());
  expect(job.type).toBe('transcription');
  expect(job.refModel).toBe('File');
  expect(job.refId.toString()).toBe(fileARefId.toString());
  // Defaults
  expect(job.status).toBe('pending');
  expect(job.attempts).toBe(0);
  expect(job.result).toEqual({});
  expect(job.error).toBe('');
  expect(job.removed).toBe(false);
  expect(job.enabled).toBe(true);
  expect(job.created).toBeInstanceOf(Date);
  expect(job.updated).toBeInstanceOf(Date);
});

test('2. Missing required type → save throws ValidationError', async () => {
  await expect(
    Job.create({
      createdBy: adminAId,
      refModel: 'File',
      refId: fileARefId,
    })
  ).rejects.toThrow(/type/);
});

test('3. Invalid status enum → save throws ValidationError', async () => {
  await expect(
    Job.create({
      createdBy: adminAId,
      type: 'transcription',
      refModel: 'File',
      refId: fileARefId,
      status: 'magic',
    })
  ).rejects.toThrow(/status/);
});

test('4. Cross-tenant: query scoped by createdBy excludes other admin docs', async () => {
  const aJob = await Job.create({
    createdBy: adminAId,
    type: 'transcription',
    refModel: 'File',
    refId: fileARefId,
  });
  // Admin B tries to read admin A's job
  const found = await Job.findOne({
    _id: aJob._id,
    createdBy: adminBId,
    removed: false,
  });
  expect(found).toBeNull();
  // Sanity: same query with correct admin returns it
  const ownerFound = await Job.findOne({
    _id: aJob._id,
    createdBy: adminAId,
    removed: false,
  });
  expect(ownerFound).not.toBeNull();
});

test('5. removed:true excluded by standard list filter', async () => {
  await Job.create({
    createdBy: adminAId,
    type: 'transcription',
    refModel: 'File',
    refId: fileARefId,
    removed: true,
  });
  await Job.create({
    createdBy: adminAId,
    type: 'transcription',
    refModel: 'File',
    refId: fileARefId,
  });
  const list = await Job.find({ createdBy: adminAId, removed: false });
  expect(list).toHaveLength(1);
  expect(list[0].removed).toBe(false);
});

test('6. Status transition pending → running → done persists + result blob', async () => {
  const job = await Job.create({
    createdBy: adminAId,
    type: 'transcription',
    refModel: 'File',
    refId: fileARefId,
  });

  await Job.findByIdAndUpdate(job._id, { status: 'running', updated: Date.now() });
  let current = await Job.findById(job._id);
  expect(current.status).toBe('running');

  await Job.findByIdAndUpdate(job._id, {
    status: 'done',
    result: { sidecarPath: '/tmp/uploads/a/2026/05/x.txt', sizeBytes: 12700 },
    updated: Date.now(),
  });
  current = await Job.findById(job._id);
  expect(current.status).toBe('done');
  expect(current.result.sidecarPath).toBe('/tmp/uploads/a/2026/05/x.txt');
  expect(current.result.sizeBytes).toBe(12700);
});
