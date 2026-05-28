/**
 * Tests for resumeOrphanJobs — crash-recovery startup hook.
 *
 * Scenarios:
 *   1. Old running Job → reset to pending + worker re-spawned
 *   2. Old pending Job (never picked up) → reset to pending + worker re-spawned
 *   3. Fresh running Job (just started) → NOT touched (age < threshold)
 *   4. Done Job → NOT touched
 *   5. Failed Job → NOT touched
 *   6. Removed Job → NOT touched
 *   7. Orphan Job whose File is gone → marked failed
 *   8. attempts counter increments on resume
 */

const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

jest.mock('@/jobs/transcriptionWorker', () => jest.fn(() => Promise.resolve()));

let mongo;
let Job;
let File;
let resumeOrphanJobs;
const adminId = new mongoose.Types.ObjectId();

const makeFile = async (overrides = {}) => {
  return File.create({
    createdBy: adminId,
    originalName: 'a.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 1000,
    sourcePath: '/tmp/a.mp3',
    contentHash: 'h' + Math.random(),
    ...overrides,
  });
};

const makeJob = async (file, overrides = {}) => {
  const ageMs = overrides.ageMs ?? 60 * 1000;
  delete overrides.ageMs;
  const updated = new Date(Date.now() - ageMs);
  return Job.create({
    createdBy: adminId,
    type: 'transcription',
    refModel: 'File',
    refId: file._id,
    status: 'pending',
    updated,
    ...overrides,
  });
};

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Job = mongoose.model('Job');
  File = mongoose.model('File');
  resumeOrphanJobs = require('@/jobs/resumeOrphanJobs');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Job.deleteMany({});
  await File.deleteMany({});
  const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
  transcribeWithOpenAI.mockClear();
});

test('1. Old running Job → reset to pending + worker re-spawned', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'running', ageMs: 60 * 1000 });

  const result = await resumeOrphanJobs();

  expect(result).toEqual({ resumed: 1, failed: 0 });
  const updated = await Job.findById(job._id);
  expect(updated.status).toBe('pending');
  expect(updated.attempts).toBe(1);

  const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
  expect(transcribeWithOpenAI).toHaveBeenCalledTimes(1);
});

test('2. Old pending Job (never picked up) → reset + worker re-spawned', async () => {
  const file = await makeFile();
  await makeJob(file, { status: 'pending', ageMs: 60 * 1000 });

  const result = await resumeOrphanJobs();

  expect(result).toEqual({ resumed: 1, failed: 0 });
  const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
  expect(transcribeWithOpenAI).toHaveBeenCalledTimes(1);
});

test('3. Fresh running Job (5s old) → NOT touched (under 30s threshold)', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'running', ageMs: 5 * 1000 });

  const result = await resumeOrphanJobs();

  expect(result).toEqual({ resumed: 0, failed: 0 });
  const unchanged = await Job.findById(job._id);
  expect(unchanged.status).toBe('running');
  const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
  expect(transcribeWithOpenAI).not.toHaveBeenCalled();
});

test('4. Done Job → NOT touched', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'done', ageMs: 24 * 3600 * 1000 });

  await resumeOrphanJobs();

  const unchanged = await Job.findById(job._id);
  expect(unchanged.status).toBe('done');
});

test('5. Failed Job → NOT touched', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'failed', ageMs: 24 * 3600 * 1000 });

  await resumeOrphanJobs();

  const unchanged = await Job.findById(job._id);
  expect(unchanged.status).toBe('failed');
});

test('6. Removed Job → NOT touched even if old + running', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'running', ageMs: 60 * 1000, removed: true });

  const result = await resumeOrphanJobs();

  expect(result).toEqual({ resumed: 0, failed: 0 });
  const unchanged = await Job.findById(job._id);
  expect(unchanged.status).toBe('running');
});

test('7. Orphan Job whose File is gone → marked failed with explicit error', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'running', ageMs: 60 * 1000 });
  await File.findByIdAndUpdate(file._id, { removed: true });

  const result = await resumeOrphanJobs();

  expect(result).toEqual({ resumed: 0, failed: 1 });
  const updated = await Job.findById(job._id);
  expect(updated.status).toBe('failed');
  expect(updated.error).toContain('Source file missing');
});

test('8. attempts counter increments on resume', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'running', ageMs: 60 * 1000, attempts: 2 });

  await resumeOrphanJobs();

  const updated = await Job.findById(job._id);
  expect(updated.attempts).toBe(3);
});

test('9. Orphan Job at MAX_ATTEMPTS → marked failed (crash-loop guard)', async () => {
  const file = await makeFile();
  const job = await makeJob(file, { status: 'running', ageMs: 60 * 1000, attempts: 3 });

  const result = await resumeOrphanJobs();

  expect(result).toEqual({ resumed: 0, failed: 1 });
  const updated = await Job.findById(job._id);
  expect(updated.status).toBe('failed');
  expect(updated.error).toMatch(/Exceeded 3 resume attempts/);
  const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
  expect(transcribeWithOpenAI).not.toHaveBeenCalled();
});
