/**
 * file.* MCP tools — tenant isolation + envelope contract (#249 Plan B v3 phase B).
 *
 * Real-stack test: MongoMemoryServer + File + Job + Admin models, real
 * controllerAdapter chain, real sidecar fs I/O.
 *
 * Covers:
 *  1. file.search returns only the acting admin's files
 *  2. file.search query filter matches originalName partial
 *  3. file.search status filter respects collapsed status
 *  4. file.get_transcript happy path returns transcript text
 *  5. file.get_transcript cross-admin → NOT_FOUND
 *  6. file.get_transcript Job pending → ok:false CONFLICT
 *  7. file.transcription_status happy → ok:true {status: 'done', durationMs}
 *  8. file.transcription_status file with no Job → status:'ready' (collapsed)
 *  9. file.transcription_status pending Job → status:'processing' (collapsed)
 *  10. file.search status='processing' matches both pending AND running
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'file-tools-test-'));
// #266: file.get_transcript flows through getTranscript which resolves
// sidecarPath via UPLOADS_DIR. Point UPLOADS_DIR at TMP_DIR before requiring
// any controller code.
process.env.UPLOADS_DIR = TMP_DIR;

const { runWithContext } = require(path.join(BACKEND_ROOT, 'src/mcp/context'));

let fileTools; // [search, get_transcript, transcription_status]
let mongo;
let adminA, adminB;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fileTools = require(path.join(BACKEND_ROOT, 'src/mcp/tools/crud/file'));
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

function getTool(name) {
  return fileTools.find((t) => t.name === name);
}

async function createFileWithJob(admin, opts = {}) {
  const FileModel = mongoose.model('File');
  const JobModel = mongoose.model('Job');
  const originalName = opts.originalName || 'rec.mp3';
  // #266: sourcePath stored RELATIVE to TMP_DIR (= UPLOADS_DIR).
  const relativeSourcePath = `${admin._id}-${Date.now()}-${Math.random()}-${originalName}`;
  const absoluteSourcePath = path.join(TMP_DIR, relativeSourcePath);
  fs.writeFileSync(absoluteSourcePath, Buffer.from([0xff, 0xfb, 0x90, 0x00]));

  const file = await FileModel.create({
    createdBy: admin._id,
    originalName,
    mimeType: 'audio/mpeg',
    sizeBytes: 1024,
    sourcePath: relativeSourcePath,
    contentHash: opts.contentHash || 'abc',
  });

  if (opts.skipJob) return { file };

  const transcriptText = opts.transcriptText || 'A 00:00  test transcript';
  const relativeSidecarPath = relativeSourcePath + '.txt';
  fs.writeFileSync(absoluteSourcePath + '.txt', transcriptText, 'utf-8');

  const job = await JobModel.create({
    createdBy: admin._id,
    type: 'transcription',
    refModel: 'File',
    refId: file._id,
    status: opts.jobStatus || 'done',
    result: opts.jobResult || { sidecarPath: relativeSidecarPath, sizeBytes: transcriptText.length, durationMs: 1234 },
    error: opts.jobError || '',
  });
  await FileModel.findByIdAndUpdate(file._id, { transcriptionJobId: job._id });
  file.transcriptionJobId = job._id;
  return { file, job };
}

test('1. file.search returns only acting admin\'s files', async () => {
  await createFileWithJob(adminA, { originalName: 'a1.mp3' });
  await createFileWithJob(adminA, { originalName: 'a2.mp3' });
  await createFileWithJob(adminB, { originalName: 'b1.mp3' });

  const tool = getTool('file.search');
  const res = await runWithContext({ actingAdmin: adminA }, () => tool.handler({}));
  expect(res.ok).toBe(true);
  expect(res.data.found).toBe(true);
  expect(res.data.count).toBe(2);
  const names = res.data.files.map((f) => f.originalName).sort();
  expect(names).toEqual(['a1.mp3', 'a2.mp3']);
});

test('2. file.search query filter matches originalName partial', async () => {
  await createFileWithJob(adminA, { originalName: 'cici-call-1.mp3' });
  await createFileWithJob(adminA, { originalName: 'meeting-notes.mp3' });

  const tool = getTool('file.search');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ query: 'cici' })
  );
  expect(res.data.count).toBe(1);
  expect(res.data.files[0].originalName).toBe('cici-call-1.mp3');
});

test('3. file.search status filter respects Job.status', async () => {
  await createFileWithJob(adminA, { originalName: 'done.mp3', jobStatus: 'done' });
  await createFileWithJob(adminA, { originalName: 'pending.mp3', jobStatus: 'pending' });

  const tool = getTool('file.search');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ status: 'done' })
  );
  expect(res.data.count).toBe(1);
  expect(res.data.files[0].originalName).toBe('done.mp3');
});

test('4. file.get_transcript happy path returns transcript text', async () => {
  const { file } = await createFileWithJob(adminA, {
    originalName: 'happy.mp3',
    transcriptText: 'A 00:00  hello\nB 00:03  world',
  });

  const tool = getTool('file.get_transcript');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ fileId: file._id.toString() })
  );
  expect(res.ok).toBe(true);
  expect(res.data.transcript).toContain('hello');
  expect(res.data.transcript).toContain('world');
  expect(res.data.originalName).toBe('happy.mp3');
});

test('5. file.get_transcript cross-admin → NOT_FOUND', async () => {
  const { file } = await createFileWithJob(adminA, { originalName: 'a-only.mp3' });

  const tool = getTool('file.get_transcript');
  const res = await runWithContext({ actingAdmin: adminB }, () =>
    tool.handler({ fileId: file._id.toString() })
  );
  expect(res.ok).toBe(false);
  expect(res.code).toBe('NOT_FOUND');
});

test('6. file.get_transcript Job pending → ok:false CONFLICT (409)', async () => {
  const { file } = await createFileWithJob(adminA, {
    originalName: 'pending.mp3',
    jobStatus: 'pending',
  });

  const tool = getTool('file.get_transcript');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ fileId: file._id.toString() })
  );
  expect(res.ok).toBe(false);
  expect(res.code).toBe('CONFLICT');
  expect(res.message).toMatch(/转写中/);
});

test('7. file.transcription_status happy returns {status, durationMs}', async () => {
  const { file } = await createFileWithJob(adminA, {
    originalName: 'status.mp3',
    jobResult: { durationMs: 5678 },
  });

  const tool = getTool('file.transcription_status');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ fileId: file._id.toString() })
  );
  expect(res.ok).toBe(true);
  expect(res.data.status).toBe('done');
  expect(res.data.durationMs).toBe(5678);
});

test('8. file.transcription_status file with no Job → status:ready (collapsed)', async () => {
  const { file } = await createFileWithJob(adminA, { skipJob: true });

  const tool = getTool('file.transcription_status');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ fileId: file._id.toString() })
  );
  expect(res.ok).toBe(true);
  expect(res.data.status).toBe('ready');
});

test('9. file.transcription_status pending Job → status:processing (collapsed)', async () => {
  const { file } = await createFileWithJob(adminA, {
    originalName: 'p.mp3',
    jobStatus: 'pending',
  });

  const tool = getTool('file.transcription_status');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ fileId: file._id.toString() })
  );
  expect(res.ok).toBe(true);
  expect(res.data.status).toBe('processing');
});

test('10. file.search status=processing matches both pending AND running', async () => {
  await createFileWithJob(adminA, { originalName: 'pend.mp3', jobStatus: 'pending' });
  await createFileWithJob(adminA, { originalName: 'run.mp3', jobStatus: 'running' });
  await createFileWithJob(adminA, { originalName: 'done.mp3', jobStatus: 'done' });

  const tool = getTool('file.search');
  const res = await runWithContext({ actingAdmin: adminA }, () =>
    tool.handler({ status: 'processing' })
  );
  expect(res.data.count).toBe(2);
  const names = res.data.files.map((f) => f.originalName).sort();
  expect(names).toEqual(['pend.mp3', 'run.mp3']);
});
