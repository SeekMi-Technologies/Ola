/**
 * Tests for olaController/chat.js — SSE pass-through (Issue #131, backlog L3).
 *
 * Pattern: spin up a fake NanoBot HTTP server on a fixed port (18900) so the
 * chat handler talks to it instead of the real one; supertest hits the
 * controller; we assert on the SSE response body + on what got persisted to
 * Mongo.
 *
 * unit-then-integration discipline (feedback_unit_then_integration.md): this
 * file covers the unit/component layer with mocked NanoBot. End-to-end real
 * stack (NanoBot+MCP+Mongo+Gemini+CRM with browser cookie) is the shell
 * integration test at backend/test/integration/test_ola_chat_sse.sh.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const adminId = new mongoose.Types.ObjectId();
const FAKE_NANOBOT_PORT = 18900;

let mongo;
let fakeNanoBot;
// Per-test responder: function(req, res) → drives the upstream behavior.
let nanoBotResponder = null;

beforeAll(async () => {
  // Load all mongoose models (chat.js depends on ChatSession + ChatMessage).
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );

  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  // Point chat.js at our fake NanoBot.
  process.env.NANOBOT_HOST = '127.0.0.1';
  process.env.NANOBOT_PORT = String(FAKE_NANOBOT_PORT);

  fakeNanoBot = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      // Drain request body before handing off (chat.js may need it).
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        req._body = body;
        if (typeof nanoBotResponder === 'function') {
          nanoBotResponder(req, res);
        } else {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { message: 'No responder set' } }));
        }
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => fakeNanoBot.listen(FAKE_NANOBOT_PORT, '127.0.0.1', resolve));
}, 120000);

afterAll(async () => {
  // Let any pending fire-and-forget ChatMessage.insertMany / auto-title
  // writes settle before tearing down mongo (otherwise their .catch logs
  // a noise "Operation interrupted because client was closed").
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeNanoBot) await new Promise((resolve) => fakeNanoBot.close(resolve));
});

beforeEach(async () => {
  nanoBotResponder = null;
  for (const name of ['ChatSession', 'ChatMessage']) {
    if (mongoose.models[name]) await mongoose.models[name].deleteMany({});
  }
});

function buildChatApp() {
  // Re-require to pick up the controller fresh; chat.js reads env at request
  // time so this is idempotent.
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

// Helpers to build NanoBot SSE frames the way the real server.py would.
function nanoTextChunk(content) {
  const payload = {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}
function nanoToolEvent(event) {
  return `event: tool_event\ndata: ${JSON.stringify(event)}\n\n`;
}
const NANO_DONE = `data: [DONE]\n\n`;

function startSSE(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
}

// Parse the SSE response from chat.js into structured frames.
function parseClientSSE(body) {
  const frames = [];
  for (const block of body.split('\n\n')) {
    if (!block.trim()) continue;
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    let data;
    try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
    frames.push({ event, data });
  }
  return frames;
}

// ===========================================================================
// Validation / auth shape
// ===========================================================================

describe('chat — input validation (early-return JSON, not SSE)', () => {
  test('empty message → 400 with Chinese message', async () => {
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/message/);
  });

  test('missing message → 400', async () => {
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('non-string message → 400', async () => {
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 42 });
    expect(res.status).toBe(400);
  });

  test('invalid sessionId → 404', async () => {
    const app = buildChatApp();
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hi', sessionId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Session not found/);
  });
});

// ===========================================================================
// SSE pass-through — happy paths
// ===========================================================================

describe('chat — SSE pass-through (frame translation)', () => {
  test('text-only stream → text_token frames + done, no thinking_step', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('Hello'));
      res.write(nanoTextChunk(' world'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseClientSSE(res.text);
    const textFrames = frames.filter((f) => f.event === 'text_token');
    const thinkFrames = frames.filter((f) => f.event === 'thinking_step');
    const doneFrames = frames.filter((f) => f.event === 'done');
    expect(textFrames).toHaveLength(2);
    expect(textFrames[0].data).toEqual({ delta: 'Hello' });
    expect(textFrames[1].data).toEqual({ delta: ' world' });
    expect(thinkFrames).toHaveLength(0);
    expect(doneFrames).toHaveLength(1);
    expect(doneFrames[0].data.sessionId).toBeTruthy();
    expect(doneFrames[0].data.blocks).toEqual([
      { type: 'text', content: 'Hello world' },
    ]);
  });

  test('tool_event start → thinking_step with translated friendly label', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoToolEvent({
        version: 1, phase: 'start', call_id: 'c1',
        name: 'mcp_ola_crm_merch.search', arguments: { q: 'x' },
      }));
      res.write(nanoToolEvent({
        version: 1, phase: 'end', call_id: 'c1',
        name: 'mcp_ola_crm_merch.search', arguments: { q: 'x' },
        result: '{"ok":true,"data":{"found":false}}',
      }));
      res.write(nanoTextChunk('Done'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'find x' });
    const frames = parseClientSSE(res.text);
    const thinkFrames = frames.filter((f) => f.event === 'thinking_step');
    expect(thinkFrames).toHaveLength(1);
    expect(thinkFrames[0].data.label).toBe('Ola is searching your products...');
    expect(typeof thinkFrames[0].data.ts).toBe('number');
  });

  test('tool_event end is NOT emitted as thinking_step (only start triggers labels)', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      // Just an end event with no preceding start.
      res.write(nanoToolEvent({
        version: 1, phase: 'end', call_id: 'c1', name: 'mcp_ola_crm_merch.search',
      }));
      res.write(nanoTextChunk('ok'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    const thinkFrames = parseClientSSE(res.text).filter((f) => f.event === 'thinking_step');
    expect(thinkFrames).toHaveLength(0);
  });

  test('skip-list tool (health.ping) does NOT emit thinking_step', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoToolEvent({
        version: 1, phase: 'start', call_id: 'c1', name: 'mcp_ola_crm_health.ping',
      }));
      res.write(nanoTextChunk('ok'));  // real agent always speaks (SOUL.md invariant)
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    const thinkFrames = parseClientSSE(res.text).filter((f) => f.event === 'thinking_step');
    expect(thinkFrames).toHaveLength(0);
  });

  test('unknown tool → tool-name-aware fallback label (Plan B v3 phase D)', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoToolEvent({
        version: 1, phase: 'start', call_id: 'c1', name: 'mcp_ola_crm_compute.profitMargin',
      }));
      // Real agent always emits text after tool calls (SOUL.md: never silent-error).
      // Without this the persistence step would fail ChatMessage.content required —
      // which is the desired behavior; we just don't want it triggering here.
      res.write(nanoTextChunk('done'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    const thinkFrames = parseClientSSE(res.text).filter((f) => f.event === 'thinking_step');
    expect(thinkFrames).toHaveLength(1);
    expect(thinkFrames[0].data.label).toBe('Ola is calling compute.profitMargin...');
  });
});

// ===========================================================================
// Final blocks (done frame payload) + persistence
// ===========================================================================

describe('chat — done frame blocks + Mongo persistence', () => {
  test('done.blocks prepends thinking_trace, then text, then widgets', async () => {
    const quoteResult = JSON.stringify({
      ok: true,
      data: {
        _id: '67abc1234567890123456789',
        number: 'Q-TEST-001',
        currency: 'USD',
        items: [{ itemName: 'Item A', quantity: 1, total: 100 }],
        subTotal: 100,
        total: 100,
      },
    });
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoToolEvent({
        version: 1, phase: 'start', call_id: 'q1',
        name: 'mcp_ola_crm_quote.create', arguments: {},
      }));
      res.write(nanoToolEvent({
        version: 1, phase: 'end', call_id: 'q1',
        name: 'mcp_ola_crm_quote.create', arguments: {}, result: quoteResult,
      }));
      res.write(nanoTextChunk('Done'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'create' });
    const done = parseClientSSE(res.text).find((f) => f.event === 'done');
    expect(done).toBeTruthy();
    const blocks = done.data.blocks;
    expect(blocks[0].type).toBe('thinking_trace');
    expect(blocks[0].steps).toHaveLength(1);
    expect(blocks[0].steps[0].label).toBe('Ola is drafting your quote...');
    expect(blocks[1]).toEqual({ type: 'text', content: 'Done' });
    // Widget block from quote.create result envelope.
    expect(blocks.find((b) => b.type === 'widget' && b.widgetType === 'quote_preview')).toBeTruthy();
    expect(blocks.find((b) => b.type === 'file' && b.fileType === 'pdf')).toBeTruthy();
  });

  test('persists user + assistant ChatMessages with full blocks shape', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoToolEvent({
        version: 1, phase: 'start', call_id: 'c1', name: 'mcp_ola_crm_customer.search',
      }));
      res.write(nanoTextChunk('Found 0'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    await request(app).post('/api/ola/chat').send({ message: 'search bangkok' });

    // Fire-and-forget persist — wait briefly.
    await new Promise((r) => setTimeout(r, 100));
    const ChatMessage = mongoose.model('ChatMessage');
    const msgs = await ChatMessage.find({}).sort({ created: 1 }).lean();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('search bangkok');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Found 0');
    expect(msgs[1].blocks[0].type).toBe('thinking_trace');
    expect(msgs[1].blocks[1]).toEqual({ type: 'text', content: 'Found 0' });
  });

  test('reuses existing session when sessionId provided', async () => {
    const ChatSession = mongoose.model('ChatSession');
    const session = await ChatSession.create({
      userId: adminId,
      nanobotSessionId: 'user:x:conv:y',
      createdBy: adminId,
    });
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('hi'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app)
      .post('/api/ola/chat')
      .send({ message: 'hello', sessionId: session._id.toString() });
    const done = parseClientSSE(res.text).find((f) => f.event === 'done');
    expect(done.data.sessionId).toBe(session._id.toString());
    // No new session created.
    const count = await ChatSession.countDocuments({});
    expect(count).toBe(1);
  });
});

// ===========================================================================
// Upstream error paths
// ===========================================================================

describe('chat — upstream error handling', () => {
  test('NanoBot returns 503 → emit event: error frame', async () => {
    nanoBotResponder = (_req, res) => {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'NanoBot busy' } }));
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    const errFrames = parseClientSSE(res.text).filter((f) => f.event === 'error');
    expect(errFrames).toHaveLength(1);
    expect(errFrames[0].data.message).toMatch(/NanoBot 503/);
    expect(errFrames[0].data.message).toMatch(/NanoBot busy/);
  });

  test('connection refused → emit event: error frame with host:port', async () => {
    process.env.NANOBOT_PORT = '1';  // nothing listens on port 1
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    process.env.NANOBOT_PORT = String(FAKE_NANOBOT_PORT);  // restore
    const errFrames = parseClientSSE(res.text).filter((f) => f.event === 'error');
    expect(errFrames).toHaveLength(1);
    expect(errFrames[0].data.message).toMatch(/无法连接 NanoBot/);
    expect(errFrames[0].data.message).toMatch(/127\.0\.0\.1:1/);
  });

  test('NanoBot returns malformed SSE → does not crash, ends cleanly', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write('garbage\n\n');
      res.write('event: tool_event\ndata: {bad json\n\n');
      res.write(nanoTextChunk('survived'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);
    const frames = parseClientSSE(res.text);
    expect(frames.find((f) => f.event === 'text_token' && f.data.delta === 'survived')).toBeTruthy();
    expect(frames.find((f) => f.event === 'done')).toBeTruthy();
  });

  // =========================================================================
  // ISO5c (issue #185) — X-Ola-Acting-As header propagated to NanoBot
  // =========================================================================

  test('passes req.admin._id as X-Ola-Acting-As header to NanoBot', async () => {
    let capturedHeader;
    nanoBotResponder = (req, res) => {
      capturedHeader = req.headers['x-ola-acting-as'];
      startSSE(res);
      res.write(nanoTextChunk('ok'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(capturedHeader).toBe(adminId.toString());
  });

  test('different admin._id → different X-Ola-Acting-As header', async () => {
    let capturedHeader;
    nanoBotResponder = (req, res) => {
      capturedHeader = req.headers['x-ola-acting-as'];
      startSSE(res);
      res.write(nanoTextChunk('ok'));
      res.write(NANO_DONE);
      res.end();
    };
    const otherAdminId = new mongoose.Types.ObjectId();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.admin = { _id: otherAdminId };
      next();
    });
    const chat = require(path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat.js'));
    app.post('/api/ola/chat', (req, res) => chat(req, res));
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(capturedHeader).toBe(otherAdminId.toString());
    expect(capturedHeader).not.toBe(adminId.toString());
  });
});
