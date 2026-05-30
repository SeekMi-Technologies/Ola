/**
 * Tests for fileController/upload.js — POST /api/file/create multipart upload (#249 B1).
 *
 * Covers:
 *  - Happy path (valid audio mp3 → 200 + File._id + disk write)
 *  - LIMIT_FILE_SIZE (>100MB → 413)
 *  - Mime rejection (PDF / non-audio → 415)
 *  - Cross-tenant isolation (admin B reading admin A's fileId via /file/read → 404)
 *  - Disk path scope (sourcePath under uploads/<adminId>/)
 *  - Audio upload spawns transcription Job (#249 Plan B v2 item 2)
 */

// Stub the worker so audio uploads don't actually hit OpenAI in tests.
jest.mock('@/jobs/transcriptionWorker', () =>
  jest.fn().mockResolvedValue(undefined)
);

const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'file-upload-test-'));

let mongo;
const adminAId = new mongoose.Types.ObjectId();
const adminBId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  process.env.UPLOADS_DIR = TMP_UPLOADS;
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
});

beforeEach(async () => {
  if (mongoose.models.File) await mongoose.models.File.deleteMany({});
  if (mongoose.models.Job) await mongoose.models.Job.deleteMany({});
  const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
  if (transcribeWithOpenAI.mockClear) transcribeWithOpenAI.mockClear();
});

function buildApp(adminId) {
  const upload = require(
    path.join(BACKEND_ROOT, 'src/controllers/appControllers/fileController/upload')
  );
  const app = express();
  app.use((req, _res, next) => {
    req.admin = { _id: adminId };
    next();
  });
  app.post('/api/file/create', (req, res) => upload(req, res));
  return app;
}

function buildReadApp(adminId) {
  // Read uses createCRUDController's read which filters by createdBy.
  const fileController = require(
    path.join(BACKEND_ROOT, 'src/controllers/appControllers/fileController')
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { _id: adminId };
    next();
  });
  app.get('/api/file/read/:id', (req, res) => fileController.read(req, res));
  return app;
}

describe('POST /api/file/create — happy path', () => {
  it('accepts an audio/mp3 buffer and returns File._id', async () => {
    const app = buildApp(adminAId);
    const fakeAudio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04]); // mp3 frame header + bytes
    const res = await request(app)
      .post('/api/file/create')
      .attach('file', fakeAudio, { filename: 'hello.mp3', contentType: 'audio/mpeg' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result._id).toBeTruthy();
    expect(res.body.result.originalName).toBe('hello.mp3');
    expect(res.body.result.mimeType).toBe('audio/mpeg');
    expect(res.body.result.sizeBytes).toBe(fakeAudio.length);

    // Mongo persistence
    const FileModel = mongoose.model('File');
    const doc = await FileModel.findById(res.body.result._id);
    expect(doc).toBeTruthy();
    expect(doc.createdBy.toString()).toBe(adminAId.toString());

    // #266: sourcePath stored RELATIVE to UPLOADS_DIR (not absolute).
    expect(path.isAbsolute(doc.sourcePath)).toBe(false);
    expect(doc.sourcePath.startsWith(`${adminAId.toString()}/`)).toBe(true);
    const absoluteSourcePath = path.join(TMP_UPLOADS, doc.sourcePath);
    expect(fs.existsSync(absoluteSourcePath)).toBe(true);
    expect(fs.readFileSync(absoluteSourcePath)).toEqual(fakeAudio);
  });
});

describe('POST /api/file/create — rejections', () => {
  it('rejects files over 100MB with 413', async () => {
    const app = buildApp(adminAId);
    const overSize = Buffer.alloc(101 * 1024 * 1024, 0); // 101MB

    const res = await request(app)
      .post('/api/file/create')
      .attach('file', overSize, { filename: 'big.mp3', contentType: 'audio/mpeg' });

    expect(res.statusCode).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('100MB');
  });

  it('rejects non-audio mime with 415', async () => {
    const app = buildApp(adminAId);
    const fakePdf = Buffer.from('%PDF-1.4 fake pdf bytes');

    const res = await request(app)
      .post('/api/file/create')
      .attach('file', fakePdf, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.statusCode).toBe(415);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('audio');
  });

  it('rejects request with no file field with 400', async () => {
    const app = buildApp(adminAId);
    const res = await request(app)
      .post('/api/file/create')
      .field('description', 'no file attached');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('file');
  });
});

describe('Tenant isolation', () => {
  it('admin B cannot read admin A file via /file/read → 404', async () => {
    // Admin A uploads
    const appA = buildApp(adminAId);
    const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const uploadRes = await request(appA)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'a.mp3', contentType: 'audio/mpeg' });
    expect(uploadRes.statusCode).toBe(200);
    const fileId = uploadRes.body.result._id;

    // Admin B tries to read
    const appB = buildReadApp(adminBId);
    const readRes = await request(appB).get(`/api/file/read/${fileId}`);

    expect(readRes.statusCode).toBe(404);
    expect(readRes.body.success).toBe(false);

    // Admin A can still read their own
    const appARead = buildReadApp(adminAId);
    const ownRead = await request(appARead).get(`/api/file/read/${fileId}`);
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.body.success).toBe(true);
  });
});

describe('Audio upload spawns transcription Job (Plan B v2 item 2)', () => {
  it('audio mp3 → response includes transcriptionJobId + Job doc exists + worker called', async () => {
    const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
    const app = buildApp(adminAId);
    const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01]);

    const res = await request(app)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'spawn.mp3', contentType: 'audio/mpeg' });

    expect(res.statusCode).toBe(200);
    expect(res.body.result.transcriptionJobId).toBeTruthy();

    const FileModel = mongoose.model('File');
    const JobModel = mongoose.model('Job');

    const fileDoc = await FileModel.findById(res.body.result._id);
    expect(fileDoc.transcriptionJobId.toString()).toBe(res.body.result.transcriptionJobId.toString());

    const jobDoc = await JobModel.findById(res.body.result.transcriptionJobId);
    expect(jobDoc).toBeTruthy();
    expect(jobDoc.type).toBe('transcription');
    expect(jobDoc.refModel).toBe('File');
    expect(jobDoc.refId.toString()).toBe(fileDoc._id.toString());
    expect(jobDoc.createdBy.toString()).toBe(adminAId.toString());
    expect(jobDoc.status).toBe('pending');

    // Worker was invoked fire-and-forget
    expect(transcribeWithOpenAI).toHaveBeenCalledTimes(1);
    const [calledFile, calledJob] = transcribeWithOpenAI.mock.calls[0];
    expect(calledFile._id.toString()).toBe(fileDoc._id.toString());
    expect(calledJob._id.toString()).toBe(jobDoc._id.toString());
  });
});

describe('Content-hash dedup (Plan B v3 item A)', () => {
  it('uploading same audio twice → 2nd response has deduped:true + same _id + same transcriptionJobId', async () => {
    const transcribeWithOpenAI = require('@/jobs/transcriptionWorker');
    const app = buildApp(adminAId);
    const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

    // First upload — fresh
    const res1 = await request(app)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'dedup.mp3', contentType: 'audio/mpeg' });
    expect(res1.statusCode).toBe(200);
    expect(res1.body.result.deduped).toBe(false);
    expect(res1.body.result.contentHash).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    expect(res1.body.result.transcriptionJobId).toBeTruthy();
    const firstId = res1.body.result._id;
    const firstHash = res1.body.result.contentHash;
    const firstJobId = res1.body.result.transcriptionJobId;

    // Second upload — same buffer, different filename
    const res2 = await request(app)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'dedup-renamed.mp3', contentType: 'audio/mpeg' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body.result.deduped).toBe(true);
    expect(res2.body.result._id).toBe(firstId);
    expect(res2.body.result.contentHash).toBe(firstHash);
    expect(res2.body.result.transcriptionJobId.toString()).toBe(firstJobId.toString());
    expect(res2.body.message).toContain('已上传');

    // Worker should only have been called ONCE total (first upload), not twice
    expect(transcribeWithOpenAI).toHaveBeenCalledTimes(1);
  });

  it('dedup is per-admin: admin B uploads same audio → fresh File doc (not dedup)', async () => {
    const audio = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);

    // Admin A uploads
    const appA = buildApp(adminAId);
    const resA = await request(appA)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'shared.mp3', contentType: 'audio/mpeg' });
    expect(resA.body.result.deduped).toBe(false);

    // Admin B uploads same bytes — should NOT dedup against admin A
    const appB = buildApp(adminBId);
    const resB = await request(appB)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'shared.mp3', contentType: 'audio/mpeg' });
    expect(resB.body.result.deduped).toBe(false);
    expect(resB.body.result._id).not.toBe(resA.body.result._id);
    // Both have same contentHash but different _id (privacy: no cross-admin dedup)
    expect(resB.body.result.contentHash).toBe(resA.body.result.contentHash);
  });
});

describe('Disk path scope', () => {
  it('writes under uploads/<adminId>/YYYY/MM/ structure', async () => {
    const app = buildApp(adminAId);
    const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const res = await request(app)
      .post('/api/file/create')
      .attach('file', audio, { filename: 'tenant-check.mp3', contentType: 'audio/mpeg' });

    const FileModel = mongoose.model('File');
    const doc = await FileModel.findById(res.body.result._id);
    // #266: doc.sourcePath is already relative; split directly (no path.relative)
    expect(path.isAbsolute(doc.sourcePath)).toBe(false);
    const parts = doc.sourcePath.split(path.sep);

    expect(parts[0]).toBe(adminAId.toString());
    expect(parts[1]).toMatch(/^\d{4}$/); // YYYY
    expect(parts[2]).toMatch(/^\d{2}$/); // MM
    expect(parts[3]).toMatch(/^[a-f0-9-]{36}\.mp3$/); // uuid.ext
  });
});
