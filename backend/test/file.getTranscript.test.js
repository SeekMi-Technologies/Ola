/**
 * Multi-tenant isolation tests for fileController/getTranscript.js.
 *
 * Background (PR #258, Ziyue review, 2026-05-20):
 *   The handler scoped the File lookup by createdBy but then looked up the
 *   associated Job via findById with no createdBy filter. Combined with
 *   createCRUDController/update lacking a field whitelist, an admin could
 *   PATCH File.transcriptionJobId to point at another admin's Job and then
 *   GET /file/transcript/:id to read the other admin's sidecar transcript.
 *   The same handler is reached via MCP file.get_transcript, so the agent
 *   could drive the same attack.
 *
 * Covered:
 *   1. Happy path — admin A reads own transcript → 200 + content
 *   2. Cross-admin attack — admin A's File.transcriptionJobId points to
 *      admin B's Job → 500 "转写任务记录缺失" (Job query returns null after
 *      createdBy filter), and admin B's sidecar contents NEVER appear in
 *      the response body
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'get-transcript-test-'));
// #266: getTranscript resolves Job.result.sidecarPath via UPLOADS_DIR; point
// it at TMP_DIR before requiring the controller so resolveUploadPath() reads
// the right root.
process.env.UPLOADS_DIR = TMP_DIR;

let mongo;
const adminAId = new mongoose.Types.ObjectId();
const adminBId = new mongoose.Types.ObjectId();

beforeAll(async () => {
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
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  if (mongoose.models.File) await mongoose.models.File.deleteMany({});
  if (mongoose.models.Job) await mongoose.models.Job.deleteMany({});
});

function buildApp(adminId) {
  const getTranscript = require(
    path.join(BACKEND_ROOT, 'src/controllers/appControllers/fileController/getTranscript')
  );
  const app = express();
  app.use((req, _res, next) => {
    req.admin = { _id: adminId };
    next();
  });
  app.get('/api/file/transcript/:id', (req, res) => getTranscript(req, res));
  return app;
}

async function seedFileWithJob({ adminId, transcript = 'hello world transcript' }) {
  const File = mongoose.model('File');
  const Job = mongoose.model('Job');
  // #266: sourcePath / sidecarPath stored RELATIVE to UPLOADS_DIR (= TMP_DIR).
  const relativeSourcePath = `${Date.now()}-${Math.random()}-audio.mp3`;
  const relativeSidecarPath = `${relativeSourcePath}.txt`;
  const absoluteSourcePath = path.join(TMP_DIR, relativeSourcePath);
  const absoluteSidecarPath = path.join(TMP_DIR, relativeSidecarPath);
  fs.writeFileSync(absoluteSourcePath, Buffer.alloc(8, 0));
  fs.writeFileSync(absoluteSidecarPath, transcript);
  const file = await File.create({
    createdBy: adminId,
    originalName: 'audio.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 8,
    sourcePath: relativeSourcePath,
  });
  const job = await Job.create({
    createdBy: adminId,
    type: 'transcription',
    refModel: 'File',
    refId: file._id,
    status: 'done',
    result: { sidecarPath: relativeSidecarPath, durationMs: 1234 },
  });
  file.transcriptionJobId = job._id;
  await file.save();
  return { file, job, relativeSidecarPath, absoluteSidecarPath };
}

describe('getTranscript multi-tenant isolation (PR #258 Ziyue review)', () => {
  test('happy: admin A reads own transcript → 200 + content', async () => {
    const { file } = await seedFileWithJob({
      adminId: adminAId,
      transcript: 'admin A own transcript content',
    });
    const res = await request(buildApp(adminAId))
      .get(`/api/file/transcript/${file._id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.transcript).toBe('admin A own transcript content');
    expect(res.body.result.fileId.toString()).toBe(file._id.toString());
  });

  // #266 Item 2 — fail-fast case: a legacy doc with absolute sidecarPath
  // (from before the migration) must produce a clear 500 instead of silently
  // hitting a wrong-host filesystem path.
  test('legacy absolute sidecarPath → 500 "路径无效" fail-fast (#266)', async () => {
    const File = mongoose.model('File');
    const Job = mongoose.model('Job');
    // Write a real sidecar at an absolute location so this isn't an ENOENT
    // — the absolute-path check must reject BEFORE fs.readFile is attempted.
    const absoluteSidecarPath = path.join(TMP_DIR, 'legacy-absolute-sidecar.txt');
    fs.writeFileSync(absoluteSidecarPath, 'should NOT be read');
    const file = await File.create({
      createdBy: adminAId,
      originalName: 'legacy.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 8,
      sourcePath: 'legacy-relative.mp3',
    });
    const job = await Job.create({
      createdBy: adminAId,
      type: 'transcription',
      refModel: 'File',
      refId: file._id,
      status: 'done',
      result: { sidecarPath: absoluteSidecarPath, durationMs: 1 },
    });
    file.transcriptionJobId = job._id;
    await file.save();

    const res = await request(buildApp(adminAId))
      .get(`/api/file/transcript/${file._id}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('路径无效');
    expect(JSON.stringify(res.body)).not.toContain('should NOT be read');
  });

  test('cross-admin attack: A.File → B.Job → 500, no transcript leaked', async () => {
    // Admin B's legit file + job. Sidecar contains B's secret transcript.
    const SECRET = 'SECRET_ADMIN_B_TRANSCRIPT_PHRASE';
    const bSeed = await seedFileWithJob({
      adminId: adminBId,
      transcript: SECRET,
    });

    // Admin A's file with transcriptionJobId mutated to point at B's job —
    // simulating the createCRUDController PATCH attack vector. Bypass the
    // strict createdBy join by direct Mongo update, since createCRUDController
    // exposes this exact gap in production.
    const aSeed = await seedFileWithJob({
      adminId: adminAId,
      transcript: 'admin A original transcript',
    });
    await mongoose.model('File').updateOne(
      { _id: aSeed.file._id },
      { $set: { transcriptionJobId: bSeed.job._id } }
    );

    const res = await request(buildApp(adminAId))
      .get(`/api/file/transcript/${aSeed.file._id}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('关联的转写任务记录缺失');
    // The critical assertion: B's secret transcript content NEVER appears
    // anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
