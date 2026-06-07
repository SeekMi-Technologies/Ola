/**
 * Tests for Phase N — per-salesperson language support (issue #70).
 *
 * Covers:
 *   1. chat.js prepends [SESSION_LANG=en] when admin.language === 'en'
 *      → assert proxy payload to NanoBot has the directive
 *      → assert ChatMessage user-row content does NOT have it (UI safety)
 *   2. chat.js defaults to [SESSION_LANG=zh] when admin.language is undefined
 *      (existing-doc backward-compat path; no migration needed)
 *   3. updateProfile rejects invalid language (400) and accepts valid (200 + DB write)
 *   4. quote.js enrichItemDescriptions prefers description_en over description_cn
 *      (verifies the L68 default flip)
 *
 * Pattern matches backend/test/olaController.chat.test.js
 * (mongo-memory + fake nanobot + supertest).
 */

const path = require('path');
const http = require('http');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
// Distinct port from other fake-NanoBot tests so jest can run them in parallel.
// Taken: 18900 (olaController.chat), 18901 (llmUsage.chat), 18902 (llmUsage.autotitle).
const FAKE_NANOBOT_PORT = 18903;

let mongo;
let fakeNanoBot;
let nanoBotResponder = null;
// Captures the last raw request body sent to the fake NanoBot — used to
// inspect the proxy payload from chat.js.
let lastNanoBody = null;

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
        lastNanoBody = body;
        if (typeof nanoBotResponder === 'function') {
          nanoBotResponder(req, res);
        } else {
          // Default: minimal SSE response so chat.js completes successfully.
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream');
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
          })}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        }
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => fakeNanoBot.listen(FAKE_NANOBOT_PORT, '127.0.0.1', r));
}, 120000);

afterAll(async () => {
  // Let fire-and-forget persistence settle before tearing down mongo.
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeNanoBot) await new Promise((r) => fakeNanoBot.close(r));
});

beforeEach(async () => {
  nanoBotResponder = null;
  lastNanoBody = null;
  for (const name of ['ChatSession', 'ChatMessage', 'Admin', 'Merch']) {
    if (mongoose.models[name]) await mongoose.models[name].deleteMany({});
  }
});

function buildChatApp(admin) {
  const chat = require(
    path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = admin;
    next();
  });
  app.post('/api/ola/chat', (req, res) => chat(req, res));
  return app;
}

function buildProfileApp(adminId) {
  const updateProfile = require(
    path.join(BACKEND_ROOT, 'src/controllers/middlewaresControllers/createUserController/updateProfile')
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { _id: adminId };
    next();
  });
  app.patch('/api/admin/profile/update', (req, res) => updateProfile('Admin', req, res));
  return app;
}

// ===========================================================================
// 1 + 2: chat.js SESSION_LANG directive injection
// ===========================================================================

describe('chat.js — SESSION_LANG directive injection', () => {
  test('admin.language=en → prepends [SESSION_LANG=en] to NanoBot payload, NOT to ChatMessage', async () => {
    const adminId = new mongoose.Types.ObjectId();
    const app = buildChatApp({ _id: adminId, language: 'en' });
    const res = await request(app).post('/api/ola/chat').send({ message: 'find a customer' });
    expect(res.status).toBe(200);

    // Assert the proxy payload sent to NanoBot has the directive prepended.
    const parsed = JSON.parse(lastNanoBody);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toBe('[SESSION_LANG=en]\n\nfind a customer');

    // Assert ChatMessage user row stores the RAW message (no directive leak to UI).
    await new Promise((r) => setTimeout(r, 100));
    const ChatMessage = mongoose.model('ChatMessage');
    const userMsgs = await ChatMessage.find({ role: 'user' }).lean();
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].content).toBe('find a customer');
    expect(userMsgs[0].content).not.toMatch(/SESSION_LANG/);
    expect(userMsgs[0].blocks[0]).toEqual({ type: 'text', content: 'find a customer' });
  });

  test('admin.language=undefined (existing pre-N1 doc) → defaults to [SESSION_LANG=zh]', async () => {
    const adminId = new mongoose.Types.ObjectId();
    // Admin object WITHOUT a language field — simulates an admin doc created
    // before Phase N1 added the schema field.
    const app = buildChatApp({ _id: adminId });
    await request(app).post('/api/ola/chat').send({ message: 'hello' });
    const parsed = JSON.parse(lastNanoBody);
    expect(parsed.messages[0].content).toBe('[SESSION_LANG=zh]\n\nhello');
  });

  test('admin.language=zh → prepends [SESSION_LANG=zh]', async () => {
    const adminId = new mongoose.Types.ObjectId();
    const app = buildChatApp({ _id: adminId, language: 'zh' });
    await request(app).post('/api/ola/chat').send({ message: '你好' });
    const parsed = JSON.parse(lastNanoBody);
    expect(parsed.messages[0].content).toBe('[SESSION_LANG=zh]\n\n你好');
  });
});

// ===========================================================================
// 3: updateProfile language validation + persistence
// ===========================================================================

describe('updateProfile — language enum validation', () => {
  test('valid language=en → 200, response includes language, persisted to DB', async () => {
    const Admin = mongoose.model('Admin');
    const admin = await Admin.create({ name: 'Test', email: 'test@test.com' });
    const app = buildProfileApp(admin._id);

    const res = await request(app)
      .patch('/api/admin/profile/update')
      .send({ name: 'Test', surname: 'X', email: 'test@test.com', language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.language).toBe('en');

    const persisted = await Admin.findById(admin._id).lean();
    expect(persisted.language).toBe('en');
  });

  test('invalid language=fr → 400 with explicit message', async () => {
    const Admin = mongoose.model('Admin');
    const admin = await Admin.create({ name: 'Test', email: 'test2@test.com' });
    const app = buildProfileApp(admin._id);

    const res = await request(app)
      .patch('/api/admin/profile/update')
      .send({ name: 'Test', surname: 'X', email: 'test2@test.com', language: 'fr' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid language/);

    // DB unchanged — language remains the schema default ('zh') applied at create
    const persisted = await Admin.findById(admin._id).lean();
    expect(persisted.language).toBe('zh');
  });

  test('explicit null language → 400 (must not silently corrupt enum)', async () => {
    // Reason: a truthy `if (req.body.language)` check would let null bypass
    // validation and `$set: { language: null }` would write null to Mongo,
    // breaking the schema enum invariant. Verifies the !== undefined guard.
    const Admin = mongoose.model('Admin');
    const admin = await Admin.create({ name: 'Test', email: 'test_null@test.com' });
    const app = buildProfileApp(admin._id);

    const res = await request(app)
      .patch('/api/admin/profile/update')
      .send({ name: 'Test', surname: 'X', email: 'test_null@test.com', language: null });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid language/);

    const persisted = await Admin.findById(admin._id).lean();
    expect(persisted.language).toBe('zh'); // schema default unchanged, NOT null
  });

  test('omitted language (existing field flow) → 200, language not overwritten', async () => {
    const Admin = mongoose.model('Admin');
    const admin = await Admin.create({ name: 'Test', email: 'test3@test.com', language: 'en' });
    const app = buildProfileApp(admin._id);

    // Update name only — should not clear language.
    const res = await request(app)
      .patch('/api/admin/profile/update')
      .send({ name: 'New Name', surname: 'X', email: 'test3@test.com' });

    expect(res.status).toBe(200);
    // Persisted: language should still be 'en' (we passed undefined; the
    // findOneAndUpdate $set: { language: undefined } is a no-op in mongoose).
    const persisted = await Admin.findById(admin._id).lean();
    expect(persisted.language).toBe('en');
    expect(persisted.name).toBe('New Name');
  });
});

// ===========================================================================
// 4: quote.js enrichItemDescriptions — English-first default
// ===========================================================================

describe('quote enrichItemDescriptions — English description default', () => {
  test('Merch with both en + cn descriptions → enriched item.description === English', async () => {
    const Merch = mongoose.model('Merch');
    await Merch.create({
      serialNumber: 'A-TEST',
      serialNumberLong: 'A-TEST-LONG',
      description_en: 'Cutting Tip 15-25mm',
      description_cn: '割嘴 15-25mm',
      unit_en: 'PC',
      unit_cn: '件',
      weight: 0.2, VAT: 1.13, ETR: 0.13,
    });

    const { __forTesting } = require(
      path.join(BACKEND_ROOT, 'src/mcp/tools/crud/quote')
    );
    const { items, warnings } = await __forTesting.enrichItemDescriptions([
      { itemName: 'A-TEST', quantity: 1, price: 0 },
    ]);

    expect(warnings).toHaveLength(0);
    expect(items[0].description).toBe('Cutting Tip 15-25mm');
    expect(items[0].description).not.toMatch(/割嘴/);
  });

  test('Merch with only description_cn → falls back to Chinese (no warning)', async () => {
    const Merch = mongoose.model('Merch');
    // Direct collection insert bypasses Mongoose `required: true` on description_en
    // — simulates legacy data where en was never filled in.
    await Merch.collection.insertOne({
      serialNumber: 'A-CN-ONLY',
      description_en: '',
      description_cn: '只有中文',
      unit_en: 'PC',
      removed: false,
    });

    const { __forTesting } = require(
      path.join(BACKEND_ROOT, 'src/mcp/tools/crud/quote')
    );
    const { items, warnings } = await __forTesting.enrichItemDescriptions([
      { itemName: 'A-CN-ONLY', quantity: 1, price: 0 },
    ]);

    expect(items[0].description).toBe('只有中文');
    expect(warnings).toHaveLength(0); // description not blank → no warning
  });

  test('Merch not found → English warning ("not matched in Merch")', async () => {
    const { __forTesting } = require(
      path.join(BACKEND_ROOT, 'src/mcp/tools/crud/quote')
    );
    const { items, warnings } = await __forTesting.enrichItemDescriptions([
      { itemName: 'A-NONEXISTENT', quantity: 1, price: 0 },
    ]);

    expect(items[0].description).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe('A-NONEXISTENT: serialNumber not matched in Merch — description and unit left blank');
    expect(warnings[0]).not.toMatch(/未在 Merch/);
  });
});
