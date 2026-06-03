/**
 * file.transcribe MCP tool — unit + integration tests (#307 Item 4).
 *
 * Real-stack test: MongoMemoryServer + File + Job + Admin models,
 * real controllerAdapter chain, real sidecar fs I/O.
 * Mocks only the transcriptionWorker (no actual API calls).
 *
 * Covers:
 *  1. file.transcribe creates Job for audio file → status: 'processing'
 *  2. file.transcribe rejects non-audio file → UNSUPPORTED_TYPE
 *  3. file.transcribe returns cached transcript when job is done
 *  4. file.transcribe returns PROCESSING when job is already running
 *  5. file.transcribe re-transcribes when previous job failed
 *  6. file.transcribe file not found → NOT_FOUND
 *  7. file.transcribe cross-admin → NOT_FOUND
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'file-transcribe-test-'));
process.env.UPLOADS_DIR = TMP_DIR;

// Mock the transcription worker — we don't want real API calls
jest.mock('@/jobs/transcriptionWorker', () => {
  return jest.fn().mockResolvedValue(undefined);
});

const { runWithContext } = require(path.join(BACKEND_ROOT, 'src/mcp/context'));

let file_transcribe;
let mongo;
let adminA, adminB;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  file_transcribe = require(path.join(BACKEND_ROOT, 'src/mcp/tools/compute/transcribe'));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await mongoose.model('Admin').deleteMany({});
  await mongoose.model('File').deleteMany({});
  await mongoose.model('Job').deleteMany({});
  adminA = await mongoose.model('Admin').create({
    email: 'a@a.com', name: 'A', surname: 'X', role: 'admin', enabled: true, removed: false,
  });
  adminB = await mongoose.model('Admin').create({
    email: 'b@b.com', name: 'B', surname: 'Y', role: 'admin', enabled: true, removed: false,
  });
});

/**
 * Helper: create a file on disk + in DB, optionally with an existing Job.
 */
async function createFile(admin, opts = {}) {
  const FileModel = mongoose.model('File');
  const JobModel = mongoose.model('Job');
  const originalName = opts.originalName || 'voice.ogg';
  const mimeType = opts.mimeType || 'audio/ogg';
  const relativeSourcePath = `${admin._id}-${Date.now()}-${Math.random()}-${originalName}`;
  const absoluteSourcePath = path.join(TMP_DIR, relativeSourcePath);
  fs.writeFileSync(absoluteSourcePath, Buffer.from([0x4F, 0x67, 0x67, 0x53])); // OGG magic bytes

  const file = await FileModel.create({
    createdBy: admin._id,
    originalName,
    mimeType,
    sizeBytes: opts.sizeBytes || 2048,
    sourcePath: relativeSourcePath,
    contentHash: opts.contentHash || ('hash-' + Date.now()),
  });

  if (opts.skipJob) return { file };

  const job = await JobModel.create({
    createdBy: admin._id,
    type: 'transcription',
    refModel: 'File',
    refId: file._id,
    status: opts.jobStatus || 'done',
    result: opts.jobResult || null,
    error: opts.jobError || '',
  });
  await FileModel.findByIdAndUpdate(file._id, { transcriptionJobId: job._id });
  file.transcriptionJobId = job._id;

  // If job is done, also create the sidecar file
  if (opts.jobStatus === 'done' || !opts.jobStatus) {
    const transcriptText = opts.transcriptText || 'A 00:00  hello world';
    const relativeSidecarPath = relativeSourcePath + '.txt';
    fs.writeFileSync(absoluteSourcePath + '.txt', transcriptText, 'utf-8');
    if (!opts.jobResult) {
      await JobModel.findByIdAndUpdate(job._id, {
        result: { sidecarPath: relativeSidecarPath, sizeBytes: transcriptText.length, durationMs: 1500 },
      });
    }
  }

  return { file, job };
}

// ─── Tests ────────────────────────────────────────────────────────────

test('1. file.transcribe creates Job for audio file → status: processing', async () => {
  const { file } = await createFile(adminA, { skipJob: true });

  const res = await runWithContext({ actingAdmin: adminA }, () =>
    file_transcribe.handler({ fileId: file._id.toString() })
  );

  expect(res.ok).toBe(true);
  expect(res.data.status).toBe('processing');
  expect(res.data.jobId).toBeTruthy();

  // Verify Job was created in DB
  const JobModel = mongoose.model('Job');
  const job = await JobModel.findById(res.data.jobId);
  expect(job).toBeTruthy();
  expect(job.type).toBe('transcription');
  expect(job.refId.toString()).toBe(file._id.toString());

  // Verify File was updated with transcriptionJobId
  const FileModel = mongoose.model('File');
  const updated = await FileModel.findById(file._id);
  expect(String(updated.transcriptionJobId)).toBe(res.data.jobId);
});

test('2. file.transcribe rejects non-audio file → UNSUPPORTED_TYPE', async () => {
  const { file } = await createFile(adminA, {
    skipJob: true,
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
  });

  const res = await runWithContext({ actingAdmin: adminA }, () =>
    file_transcribe.handler({ fileId: file._id.toString() })
  );

  expect(res.ok).toBe(false);
  expect(res.code).toBe('UNSUPPORTED_TYPE');
  expect(res.message).toMatch(/not an audio\/video file/);
});

test('3. file.transcribe returns cached transcript when job is done', async () => {
  const { file } = await createFile(adminA, {
    jobStatus: 'done',
    transcriptText: 'A 00:00  cached transcript content',
  });

  const res = await runWithContext({ actingAdmin: adminA }, () =>
    file_transcribe.handler({ fileId: file._id.toString() })
  );

  expect(res.ok).toBe(true);
  expect(res.data.status).toBe('done');
  expect(res.data.transcript).toBeTruthy();
  expect(res.data.transcript.transcript).toContain('cached transcript content');
});

test('4. file.transcribe returns PROCESSING when job is already running', async () => {
  const { file } = await createFile(adminA, { jobStatus: 'running' });

  const res = await runWithContext({ actingAdmin: adminA }, () =>
    file_transcribe.handler({ fileId: file._id.toString() })
  );

  expect(res.ok).toBe(false);
  expect(res.code).toBe('PROCESSING');
  expect(res.message).toMatch(/already in progress/);
});

test('5. file.transcribe re-transcribes when previous job failed', async () => {
  const { file, job: oldJob } = await createFile(adminA, {
    jobStatus: 'failed',
    jobError: 'Network timeout',
  });

  const res = await runWithContext({ actingAdmin: adminA }, () =>
    file_transcribe.handler({ fileId: file._id.toString() })
  );

  expect(res.ok).toBe(true);
  expect(res.data.status).toBe('processing');
  // A new job should have been created
  const JobModel = mongoose.model('Job');
  const jobs = await JobModel.find({ refId: file._id });
  expect(jobs.length).toBeGreaterThanOrEqual(2);
});

test('6. file.transcribe file not found → NOT_FOUND', async () => {
  const fakeId = new mongoose.Types.ObjectId();

  const res = await runWithContext({ actingAdmin: adminA }, () =>
    file_transcribe.handler({ fileId: fakeId.toString() })
  );

  expect(res.ok).toBe(false);
  expect(res.code).toBe('NOT_FOUND');
});

test('7. file.transcribe cross-admin → NOT_FOUND', async () => {
  const { file } = await createFile(adminA, { skipJob: true });

  const res = await runWithContext({ actingAdmin: adminB }, () =>
    file_transcribe.handler({ fileId: file._id.toString() })
  );

  expect(res.ok).toBe(false);
  expect(res.code).toBe('NOT_FOUND');
});