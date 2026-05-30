/**
 * Tests for transcriptionWorker — async audio→sidecar pipeline (#249 Plan B v2 item 2).
 *
 * Strategy: mock external bits (axios, child_process.execFile), use real fs +
 * real mongoose Job/File models. Verify state transitions + sidecar artifacts.
 *
 * Covers:
 *  1. Happy: small mp3 → no ffmpeg, OpenAI mocked → Job.done + sidecar written
 *  2. Large WAV → ffmpeg compress THEN OpenAI → Job.done + ffmpeg args correct
 *  3. OpenAI 401 → Job.failed + error captured + throws
 *  4. ffmpeg ENOENT → Job.failed + axios never called
 *  5. Empty transcript (no segments, no text) → Job.failed
 */

jest.mock('axios');
// Preserve the rest of child_process (mongodb-memory-server uses spawn to launch mongod).
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execFile: jest.fn(),
  };
});

const path = require('path');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');
const child_process = require('child_process');

const BACKEND_ROOT = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-test-'));
// #266: worker resolves File.sourcePath via UPLOADS_DIR; point it at TMP_DIR
// before requiring the worker so resolveUploadPath() reads the right root.
process.env.UPLOADS_DIR = TMP_DIR;
const adminAId = new mongoose.Types.ObjectId();

let mongo;
let File;
let Job;
let runTranscription;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'sk-test-key';
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  File = mongoose.model('File');
  Job = mongoose.model('Job');
  runTranscription = require(path.join(
    BACKEND_ROOT, 'src/jobs/transcriptionWorker'
  ));
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await File.deleteMany({});
  await Job.deleteMany({});
  jest.clearAllMocks();
  // Default: execFile success (resolves promisify wrapper)
  child_process.execFile.mockImplementation((cmd, args, cb) => cb(null, '', ''));
});

async function setupAudioFile({
  name = 'a.mp3',
  sizeBytes = 5_000_000,
  mimeType = 'audio/mpeg',
} = {}) {
  // #266: sourcePath stored RELATIVE to TMP_DIR (= UPLOADS_DIR in this test).
  const relativeSourcePath = `${Date.now()}-${Math.random()}-${name}`;
  const absoluteSourcePath = path.join(TMP_DIR, relativeSourcePath);
  fs.writeFileSync(absoluteSourcePath, Buffer.alloc(Math.min(sizeBytes, 1024), 0));
  const fileDoc = await File.create({
    createdBy: adminAId,
    originalName: name,
    mimeType,
    sizeBytes,
    sourcePath: relativeSourcePath,
  });
  const jobDoc = await Job.create({
    createdBy: adminAId,
    type: 'transcription',
    refModel: 'File',
    refId: fileDoc._id,
  });
  return { fileDoc, jobDoc, relativeSourcePath, absoluteSourcePath };
}

test('1. Happy: small mp3 (no compress) → axios called, sidecar written, Job.done', async () => {
  axios.post.mockResolvedValue({
    data: {
      segments: [
        { speaker: 'A', start: 0.5, text: '你好' },
        { speaker: 'B', start: 3.2, text: '问一下押金' },
      ],
      text: '你好 问一下押金',
    },
  });

  const { fileDoc, jobDoc, relativeSourcePath, absoluteSourcePath } =
    await setupAudioFile({ sizeBytes: 5_000_000 });

  await runTranscription(fileDoc, jobDoc);

  expect(child_process.execFile).not.toHaveBeenCalled();
  expect(axios.post).toHaveBeenCalledTimes(1);

  const sidecar = fs.readFileSync(absoluteSourcePath + '.txt', 'utf-8');
  expect(sidecar).toContain('A 00:00');
  expect(sidecar).toContain('你好');
  expect(sidecar).toContain('B 00:03');
  expect(sidecar).toContain('问一下押金');

  const finalJob = await Job.findById(jobDoc._id);
  expect(finalJob.status).toBe('done');
  // #266: sidecarPath stored RELATIVE (matches relativeSourcePath + '.txt'),
  // not absolute. Disk write uses the resolver under the hood.
  expect(path.isAbsolute(finalJob.result.sidecarPath)).toBe(false);
  expect(finalJob.result.sidecarPath).toBe(relativeSourcePath + '.txt');
  expect(finalJob.result.sizeBytes).toBeGreaterThan(0);
  expect(finalJob.result.durationMs).toBeGreaterThanOrEqual(0);
});

test('2. Large WAV → ffmpeg compress invoked with mono 16k 64k flags → Job.done', async () => {
  axios.post.mockResolvedValue({
    data: { segments: [{ speaker: 'A', start: 0, text: 'hello' }], text: 'hello' },
  });

  const { fileDoc, jobDoc } = await setupAudioFile({
    name: 'big.wav',
    sizeBytes: 45_000_000,
    mimeType: 'audio/wav',
  });

  await runTranscription(fileDoc, jobDoc);

  expect(child_process.execFile).toHaveBeenCalledTimes(1);
  const [cmd, args] = child_process.execFile.mock.calls[0];
  expect(cmd).toBe('ffmpeg');
  expect(args).toEqual(expect.arrayContaining(['-ac', '1', '-ar', '16000', '-b:a', '64k', '-y']));

  const finalJob = await Job.findById(jobDoc._id);
  expect(finalJob.status).toBe('done');
});

test('3. OpenAI 401 → Job.failed + error captured + worker throws', async () => {
  const err = new Error('Request failed with status code 401');
  err.response = { status: 401, data: { error: { message: 'invalid key' } } };
  axios.post.mockRejectedValue(err);

  const { fileDoc, jobDoc } = await setupAudioFile();

  await expect(runTranscription(fileDoc, jobDoc)).rejects.toThrow(/401/);

  const finalJob = await Job.findById(jobDoc._id);
  expect(finalJob.status).toBe('failed');
  expect(finalJob.error).toMatch(/401/);
});

test('4. ffmpeg ENOENT → Job.failed + axios never called', async () => {
  child_process.execFile.mockImplementation((cmd, args, cb) =>
    cb(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))
  );

  const { fileDoc, jobDoc } = await setupAudioFile({
    name: 'big.wav',
    sizeBytes: 45_000_000,
    mimeType: 'audio/wav',
  });

  await expect(runTranscription(fileDoc, jobDoc)).rejects.toThrow(/ffmpeg|ENOENT/i);

  const finalJob = await Job.findById(jobDoc._id);
  expect(finalJob.status).toBe('failed');
  expect(finalJob.error.toLowerCase()).toMatch(/ffmpeg|enoent/);
  expect(axios.post).not.toHaveBeenCalled();
});

test('5. Empty transcript (no segments + no text) → Job.failed', async () => {
  axios.post.mockResolvedValue({ data: { segments: [], text: '' } });

  const { fileDoc, jobDoc } = await setupAudioFile();

  await expect(runTranscription(fileDoc, jobDoc)).rejects.toThrow(/empty transcript/i);

  const finalJob = await Job.findById(jobDoc._id);
  expect(finalJob.status).toBe('failed');
  expect(finalJob.error).toMatch(/empty transcript/i);
});
