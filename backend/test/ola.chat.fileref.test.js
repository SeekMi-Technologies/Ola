/**
 * Tests for chat.js fileIds extension — POST /api/ola/chat with audio attachments (#249 B2).
 *
 * Covers:
 *  - valid fileId from same admin → 200 SSE, NanoBot upstream user content
 *    contains "[file: <sourcePath>]" prepend
 *  - cross-admin fileId → 404 (don't leak existence)
 *  - non-existent fileId → 404
 *  - removed=true fileId → 404
 *  - malformed fileId string → 404
 *  - fileIds omitted / empty → regression, no file tag injected
 *  - second call in same session w/o fileIds after a first-call w/ fileIds → no residual tag
 *
 * Pattern matches olaController.chat.test.js: fake NanoBot on port 18901
 * captures upstream request body for inspection.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const FAKE_NANOBOT_PORT = 18901;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-fileref-test-'));
const adminAId = new mongoose.Types.ObjectId();
const adminBId = new mongoose.Types.ObjectId();

let mongo;
let fakeNanoBot;
let lastUpstreamBody = null;

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  process.env.NANOBOT_HOST = '127.0.0.1';
  process.env.NANOBOT_PORT = String(FAKE_NANOBOT_PORT);

  fakeNanoBot = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        lastUpstreamBody = body;
        // Minimal SSE: emit one text token then [DONE]
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(
          'data: ' +
          JSON.stringify({ choices: [{ delta: { content: 'ack' } }] }) +
          '\n\n',
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) =>
    fakeNanoBot.listen(FAKE_NANOBOT_PORT, '127.0.0.1', resolve)
  );
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeNanoBot) await new Promise((resolve) => fakeNanoBot.close(resolve));
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  lastUpstreamBody = null;
  for (const name of ['ChatSession', 'ChatMessage', 'File', 'Job']) {
    if (mongoose.models[name]) await mongoose.models[name].deleteMany({});
  }
});

function buildChatApp(adminId) {
  const chat = require(
    path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { _id: adminId };
    next();
  });
  app.post('/api/ola/chat', (req, res) => chat(req, res));
  return app;
}

/**
 * Build a fully ready audio File: backing bytes on disk, an associated Job
 * with status='done', and a sidecar .txt next to the source. This is what
 * Plan B v2 chat.js expects when fileIds are passed in.
 *
 * Pass overrides.skipJob=true to create only the File without Job+sidecar
 * (useful for negative tests that don't reach the Job branch).
 * Pass overrides.removed=true / etc to test the rejection paths.
 */
async function createFileForAdmin(adminId, overrides = {}) {
  const FileModel = mongoose.model('File');
  const JobModel = mongoose.model('Job');
  const originalName = overrides.originalName || 'sample.mp3';
  const sourcePath = path.join(TMP_DIR, `${adminId}-${Date.now()}-${Math.random()}-${originalName}`);
  fs.writeFileSync(sourcePath, Buffer.from([0xff, 0xfb, 0x90, 0x00]));

  const fileDoc = await FileModel.create({
    createdBy: adminId,
    originalName,
    mimeType: 'audio/mpeg',
    sizeBytes: 1024,
    sourcePath,
    ...overrides,
  });

  if (!overrides.skipJob) {
    const transcriptText = overrides.transcriptText || 'A 00:00  你好\nB 00:03  请问押金';
    fs.writeFileSync(sourcePath + '.txt', transcriptText, 'utf-8');
    const job = await JobModel.create({
      createdBy: adminId,
      type: 'transcription',
      refModel: 'File',
      refId: fileDoc._id,
      status: 'done',
      result: { sidecarPath: sourcePath + '.txt' },
    });
    await FileModel.findByIdAndUpdate(fileDoc._id, { transcriptionJobId: job._id });
    fileDoc.transcriptionJobId = job._id;
  }
  return fileDoc;
}

describe('chat fileIds — valid same-admin file (Plan B v3 hint-only)', () => {
  it('injects minimal [available files: id=X name="Y"] hint, NOT transcript text', async () => {
    const file = await createFileForAdmin(adminAId, {
      originalName: 'cici-test.mp3',
      transcriptText: 'A 00:00  你好\nB 00:03  请问押金',
    });

    const app = buildChatApp(adminAId);
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: '请评估这段录音', fileIds: [file._id.toString()] });

    expect(res.statusCode).toBe(200);
    expect(lastUpstreamBody).toBeTruthy();
    const parsed = JSON.parse(lastUpstreamBody);
    const userContent = parsed.messages[0].content;
    expect(userContent).toContain('[available files for tool calls:');
    expect(userContent).toContain(`id=${file._id}`);
    expect(userContent).toContain('name="cici-test.mp3"');
    expect(userContent).toContain('status="done"');
    expect(userContent).toContain('请评估这段录音');
    // Plan B v2 inline injection MUST NOT leak — agent fetches via MCP, not via user content
    expect(userContent).not.toContain('[transcript of');
    expect(userContent).not.toContain('A 00:00  你好');
    expect(userContent).not.toContain('B 00:03  请问押金');
    expect(userContent).not.toContain('[file:');
  });

  it('multi-file: 2 attached files → both in single hint, comma-separated', async () => {
    const f1 = await createFileForAdmin(adminAId, { originalName: 'first.mp3' });
    const f2 = await createFileForAdmin(adminAId, { originalName: 'second.mp3' });
    const app = buildChatApp(adminAId);

    await request(app)
      .post('/api/ola/chat')
      .send({
        message: '比较这两段录音',
        fileIds: [f1._id.toString(), f2._id.toString()],
      });

    const parsed = JSON.parse(lastUpstreamBody);
    const content = parsed.messages[0].content;
    expect(content).toMatch(/\[available files for tool calls: id=\w+ name="first\.mp3" status="done", id=\w+ name="second\.mp3" status="done"\]/);
  });
});

describe('chat fileIds — hint status field (Plan B v4.1)', () => {
  it('Job.status="running" → hint carries status="processing"', async () => {
    const file = await createFileForAdmin(adminAId);
    await mongoose
      .model('Job')
      .findByIdAndUpdate(file.transcriptionJobId, { status: 'running' });
    const app = buildChatApp(adminAId);
    await request(app)
      .post('/api/ola/chat')
      .send({ message: 'analyze', fileIds: [file._id.toString()] });
    const content = JSON.parse(lastUpstreamBody).messages[0].content;
    expect(content).toContain('status="processing"');
    expect(content).not.toContain('status="done"');
  });

  it('Job.status="failed" → hint carries status="failed"', async () => {
    const file = await createFileForAdmin(adminAId);
    await mongoose
      .model('Job')
      .findByIdAndUpdate(file.transcriptionJobId, { status: 'failed' });
    const app = buildChatApp(adminAId);
    await request(app)
      .post('/api/ola/chat')
      .send({ message: 'analyze', fileIds: [file._id.toString()] });
    const content = JSON.parse(lastUpstreamBody).messages[0].content;
    expect(content).toContain('status="failed"');
  });

  it('non-audio file (no transcriptionJobId) → hint carries status="ready"', async () => {
    const file = await createFileForAdmin(adminAId, {
      skipJob: true,
      mimeType: 'application/pdf',
      originalName: 'spec.pdf',
    });
    const app = buildChatApp(adminAId);
    await request(app)
      .post('/api/ola/chat')
      .send({ message: 'what is in this file', fileIds: [file._id.toString()] });
    const content = JSON.parse(lastUpstreamBody).messages[0].content;
    expect(content).toContain('status="ready"');
  });
});

describe('chat fileIds — rejections (all return 404, no existence leak)', () => {
  it('cross-admin fileId → 404', async () => {
    const file = await createFileForAdmin(adminAId);
    const app = buildChatApp(adminBId); // B uses A's fileId
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hi', fileIds: [file._id.toString()] });

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('文件不存在或无权访问');
  });

  it('non-existent fileId → 404', async () => {
    const app = buildChatApp(adminAId);
    const phantomId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hi', fileIds: [phantomId] });

    expect(res.statusCode).toBe(404);
  });

  it('removed=true fileId → 404', async () => {
    const file = await createFileForAdmin(adminAId, { removed: true, skipJob: true });
    const app = buildChatApp(adminAId);
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hi', fileIds: [file._id.toString()] });

    expect(res.statusCode).toBe(404);
  });

  it('malformed fileId string → 404', async () => {
    const app = buildChatApp(adminAId);
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hi', fileIds: ['not-an-objectid'] });

    expect(res.statusCode).toBe(404);
  });

  it('fileIds non-array → 400', async () => {
    const app = buildChatApp(adminAId);
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hi', fileIds: 'just-a-string' });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('fileIds');
  });
});

describe('chat fileIds — regression (no fileIds = no hint emitted)', () => {
  it('omitting fileIds → no [available files: ...] hint', async () => {
    const app = buildChatApp(adminAId);
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'plain chat with no file' });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(lastUpstreamBody);
    expect(parsed.messages[0].content).not.toContain('[available files');
    expect(parsed.messages[0].content).not.toContain('[transcript of');
    expect(parsed.messages[0].content).toContain('plain chat with no file');
  });

  it('empty fileIds array → no hint', async () => {
    const app = buildChatApp(adminAId);
    await request(app).post('/api/ola/chat').send({ message: 'hi', fileIds: [] });
    const parsed = JSON.parse(lastUpstreamBody);
    expect(parsed.messages[0].content).not.toContain('[available files');
  });

  it('second call without fileIds after first call with fileIds → no residual hint', async () => {
    const file = await createFileForAdmin(adminAId);
    const app = buildChatApp(adminAId);

    // First call with fileIds — hint emitted
    await request(app)
      .post('/api/ola/chat')
      .send({ message: 'analyze this', fileIds: [file._id.toString()] });
    expect(JSON.parse(lastUpstreamBody).messages[0].content).toContain('[available files');

    // Second call without fileIds — must not leak
    await request(app)
      .post('/api/ola/chat')
      .send({ message: 'follow up question' });
    const second = JSON.parse(lastUpstreamBody);
    expect(second.messages[0].content).not.toContain('[available files');
    expect(second.messages[0].content).toContain('follow up question');
  });
});
