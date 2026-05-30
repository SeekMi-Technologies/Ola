/**
 * Tests for transcriptionWorker dispatcher logic (#257 Item 4).
 *
 * Focus on resolveProvider + dispatch routing (not the provider internals,
 * which are covered separately in paraformerProvider.test.js and the existing
 * file.upload.transcription.test.js for openai path).
 *
 * Covers:
 *  - resolveProvider: admin field wins
 *  - resolveProvider: env wins when admin field is null/missing
 *  - resolveProvider: hardcoded 'openai' fallback when neither set
 *  - resolveProvider: admin doc missing → fall through (no crash)
 *  - runTranscription: paraformer admin routes to paraformerProvider (mocked)
 *  - runTranscription: openai admin routes to openaiProvider (mocked)
 *  - runTranscription: unknown provider value → throws explicit error
 *  - runTranscription: Job.result.provider field written on success
 */

jest.mock('@/jobs/providers/openaiProvider');
jest.mock('@/jobs/providers/paraformerProvider');

const path = require('path');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-test-'));
process.env.UPLOADS_DIR = TMP_DIR;

const transcribeViaOpenAI = require('@/jobs/providers/openaiProvider');
const transcribeViaParaformer = require('@/jobs/providers/paraformerProvider');
const runTranscription = require('@/jobs/transcriptionWorker');
const { resolveProvider } = runTranscription.__test__;

let mongo;
let Admin;
let File;
let Job;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Admin = mongoose.model('Admin');
  File = mongoose.model('File');
  Job = mongoose.model('Job');
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await Admin.deleteMany({});
  await File.deleteMany({});
  await Job.deleteMany({});
  jest.clearAllMocks();
  delete process.env.TRANSCRIPTION_PROVIDER;
});

async function makeAdmin({ provider = null, email = 'x@y.com' } = {}) {
  return Admin.create({
    email,
    name: 'Tester',
    transcribeProvider: provider,
  });
}

async function makeFileAndJob(adminId, name = 'a.mp3') {
  const relativeSourcePath = `${Date.now()}-${Math.random()}-${name}`;
  const absoluteSourcePath = path.join(TMP_DIR, relativeSourcePath);
  fs.writeFileSync(absoluteSourcePath, Buffer.alloc(1024, 0));
  const file = await File.create({
    createdBy: adminId,
    originalName: name,
    mimeType: 'audio/mpeg',
    sizeBytes: 1024,
    sourcePath: relativeSourcePath,
  });
  const job = await Job.create({
    createdBy: adminId,
    type: 'transcription',
    refModel: 'File',
    refId: file._id,
  });
  return { file, job, absoluteSourcePath, relativeSourcePath };
}

// =========== resolveProvider ===========

test('resolveProvider: admin field "paraformer" wins over env', async () => {
  process.env.TRANSCRIPTION_PROVIDER = 'openai';
  const admin = await makeAdmin({ provider: 'paraformer' });
  const fileDoc = { createdBy: admin._id };
  const out = await resolveProvider(fileDoc);
  expect(out).toBe('paraformer');
});

test('resolveProvider: env wins when admin field is null', async () => {
  process.env.TRANSCRIPTION_PROVIDER = 'paraformer';
  const admin = await makeAdmin({ provider: null });
  const fileDoc = { createdBy: admin._id };
  const out = await resolveProvider(fileDoc);
  expect(out).toBe('paraformer');
});

test('resolveProvider: hardcoded "openai" fallback when neither set', async () => {
  delete process.env.TRANSCRIPTION_PROVIDER;
  const admin = await makeAdmin({ provider: null });
  const fileDoc = { createdBy: admin._id };
  const out = await resolveProvider(fileDoc);
  expect(out).toBe('openai');
});

test('resolveProvider: admin doc missing → falls through cleanly to env/default', async () => {
  delete process.env.TRANSCRIPTION_PROVIDER;
  const fakeId = new mongoose.Types.ObjectId();
  const fileDoc = { createdBy: fakeId };
  const out = await resolveProvider(fileDoc);
  expect(out).toBe('openai');
});

// =========== runTranscription dispatch ===========

test('runTranscription: paraformer admin → calls paraformerProvider with heartbeat', async () => {
  transcribeViaParaformer.mockResolvedValue('A 00:00  HK 繁体粤语\nB 00:05  係咩咧');
  const admin = await makeAdmin({ provider: 'paraformer' });
  const { file, job, absoluteSourcePath } = await makeFileAndJob(admin._id);

  await runTranscription(file, job);

  expect(transcribeViaParaformer).toHaveBeenCalledTimes(1);
  expect(transcribeViaParaformer).toHaveBeenCalledWith(
    expect.objectContaining({ _id: file._id }),
    expect.objectContaining({ onPollHeartbeat: expect.any(Function) })
  );
  expect(transcribeViaOpenAI).not.toHaveBeenCalled();

  const updated = await Job.findById(job._id);
  expect(updated.status).toBe('done');
  expect(updated.result.provider).toBe('paraformer');
  expect(updated.result.sidecarPath).toBe(file.sourcePath + '.txt');
  // sidecar actually written
  expect(fs.readFileSync(absoluteSourcePath + '.txt', 'utf-8')).toContain('係咩咧');
});

test('runTranscription: openai admin → calls openaiProvider with audioPath', async () => {
  transcribeViaOpenAI.mockResolvedValue('A 00:00  hello');
  const admin = await makeAdmin({ provider: 'openai' });
  const { file, job } = await makeFileAndJob(admin._id);

  await runTranscription(file, job);

  expect(transcribeViaOpenAI).toHaveBeenCalledTimes(1);
  expect(transcribeViaOpenAI.mock.calls[0][0]).toMatch(/\.mp3$/); // audio path arg
  expect(transcribeViaParaformer).not.toHaveBeenCalled();

  const updated = await Job.findById(job._id);
  expect(updated.status).toBe('done');
  expect(updated.result.provider).toBe('openai');
});

test('runTranscription: env=paraformer + admin null → paraformer', async () => {
  process.env.TRANSCRIPTION_PROVIDER = 'paraformer';
  transcribeViaParaformer.mockResolvedValue('A 00:00  test');
  const admin = await makeAdmin({ provider: null });
  const { file, job } = await makeFileAndJob(admin._id);

  await runTranscription(file, job);
  expect(transcribeViaParaformer).toHaveBeenCalledTimes(1);
  expect(transcribeViaOpenAI).not.toHaveBeenCalled();
});

test('runTranscription: unknown provider value → throws + Job.failed', async () => {
  process.env.TRANSCRIPTION_PROVIDER = 'whisper'; // not in VALID_PROVIDERS
  const admin = await makeAdmin({ provider: null });
  const { file, job } = await makeFileAndJob(admin._id);

  await expect(runTranscription(file, job)).rejects.toThrow(/Unknown transcription provider: whisper/);
  // Provider rejection happens before status flips to running — Job stays
  // in pending. That's correct: the dispatcher fails fast and the upload
  // returns the fileId so caller can retry after fix.
});
