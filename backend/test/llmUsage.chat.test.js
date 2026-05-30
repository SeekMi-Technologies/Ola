/**
 * Integration tests for olaController/chat.js LLMUsage capture (Ola issue #98).
 *
 * Mirrors the exact pattern of olaController.chat.test.js — fake NanoBot
 * HTTP server on port 18901 (different from chat.test's 18900 so they could
 * run in parallel; jest runs serially by default, but the separate port is
 * defensive). Sends SSE responses that include or omit `event: usage` frames
 * and verifies that:
 *   - chat.js parses the usage frame correctly
 *   - finishStream triggers a fire-and-forget recordUsage call
 *   - LLMUsage rows in mongo match expectations
 *   - Missing / malformed usage frames don't break the chat path (legacy
 *     nanobot compatibility)
 *
 * Unit tests for the pricing math and recordUsage skip rules live in
 *   backend/test/llmPricing.test.js
 *   backend/test/llmUsageController.test.js
 *
 * End-to-end real-stack tests (cookie + real NanoBot + Gemini) live at
 *   backend/test/integration/test_llm_usage.sh
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
const FAKE_NANOBOT_PORT = 18901;

let mongo;
let fakeNanoBot;
let nanoBotResponder = null;

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
  // Wait for fire-and-forget LLMUsage / ChatMessage writes to settle before
  // tearing mongo down (otherwise their .catch logs noise).
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeNanoBot) await new Promise((resolve) => fakeNanoBot.close(resolve));
});

beforeEach(async () => {
  nanoBotResponder = null;
  for (const name of ['ChatSession', 'ChatMessage', 'LlmUsage']) {
    if (mongoose.models[name]) await mongoose.models[name].deleteMany({});
  }
});

function buildChatApp() {
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

// SSE frame helpers — mirror what nanobot/api/server.py produces.
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
// =============================================================================
// WIRE CONTRACT — keep in lockstep with nanobot/api/server.py:_sse_usage
// =============================================================================
// This MUST mirror what real nanobot emits 1:1. If schema drifts, the real-
// stack integration test (backend/test/integration/test_llm_usage.sh) will
// fail and silently let bad rows land in mongo. Don't mock around it; fix
// either side until the contract holds.
// Required keys: provider, model, prompt_tokens, completion_tokens,
// total_tokens, iterations. Optional: cached_tokens (default 0).
const FRAME_META = {
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite-preview',
};
function nanoUsageFrame(usage) {
  // Spreads FRAME_META so every test gets the wire-required provider/model
  // unless it's explicitly testing a missing/empty case (in which case it
  // should pass an object that overrides them).
  return `event: usage\ndata: ${JSON.stringify({ ...FRAME_META, ...usage })}\n\n`;
}
const NANO_DONE = `data: [DONE]\n\n`;

function startSSE(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
}

// Wait for fire-and-forget writes (recordUsage + ChatMessage.insertMany run
// in parallel after the response stream ends).
async function waitForWrites(timeoutMs = 1000) {
  await new Promise((r) => setTimeout(r, 100));
  // Poll every 50ms until LlmUsage has at least 1 row OR timeout. This avoids
  // flaky waits — we only proceed once mongo actually saw the write, or
  // confirmed it's not coming.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = await mongoose.model('LlmUsage').countDocuments({});
    if (c > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ===========================================================================
// Happy path — usage frame → LLMUsage row written
// ===========================================================================

describe('chat — captures NanoBot usage frame and persists to LLMUsage', () => {
  test('usage SSE frame triggers a fire-and-forget LLMUsage write with all fields', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('Hello'));
      res.write(nanoTextChunk(' world'));
      res.write(nanoUsageFrame({
        prompt_tokens: 1234,
        completion_tokens: 567,
        total_tokens: 1801,
        cached_tokens: 50,
        iterations: 1,
      }));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);

    await waitForWrites();
    const LlmUsage = mongoose.model('LlmUsage');
    const rows = await LlmUsage.find({}).lean();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.userId.toString()).toBe(adminId.toString());
    expect(r.inputTokens).toBe(1234);
    expect(r.outputTokens).toBe(567);
    expect(r.totalTokens).toBe(1801);
    expect(r.cachedTokens).toBe(50);
    expect(r.iterations).toBe(1);
    expect(r.errored).toBe(false);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.channel).toBe('ask-ola');
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe('gemini-3.1-flash-lite-preview');
    expect(r.requestId).toBeTruthy();
    expect(r.nanobotSessionId).toBeTruthy();
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    // messageId should be plumbed from the inserted assistant ChatMessage.
    expect(r.messageId).toBeTruthy();
  });

  test('messageId on LLMUsage row matches the assistant ChatMessage _id', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('Reply'));
      res.write(nanoUsageFrame({
        prompt_tokens: 500, completion_tokens: 100, total_tokens: 600, iterations: 1,
      }));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    await request(app).post('/api/ola/chat').send({ message: 'q' });
    await waitForWrites();

    const ChatMessage = mongoose.model('ChatMessage');
    const LlmUsage = mongoose.model('LlmUsage');
    const assistantMsg = await ChatMessage.findOne({ role: 'assistant' }).lean();
    const usageRow = await LlmUsage.findOne({}).lean();

    expect(assistantMsg).toBeTruthy();
    expect(usageRow.messageId.toString()).toBe(assistantMsg._id.toString());
  });

  test('iterations >= 2 is preserved on a tool-using turn', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(`event: tool_event\ndata: ${JSON.stringify({
        version: 1, phase: 'start', call_id: 'c1',
        name: 'mcp_ola_crm_quote.create', arguments: {},
      })}\n\n`);
      res.write(`event: tool_event\ndata: ${JSON.stringify({
        version: 1, phase: 'end', call_id: 'c1',
        name: 'mcp_ola_crm_quote.create',
        result: '{"ok":true,"data":{"_id":"abc","number":"Q-1"}}',
      })}\n\n`);
      res.write(nanoTextChunk('Done'));
      res.write(nanoUsageFrame({
        prompt_tokens: 5000, completion_tokens: 800, total_tokens: 5800, iterations: 2,
      }));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    await request(app).post('/api/ola/chat').send({ message: 'create a quote' });
    await waitForWrites();

    const r = await mongoose.model('LlmUsage').findOne({}).lean();
    expect(r.iterations).toBe(2);
  });

  test('two consecutive chats produce two LLMUsage rows with independent requestIds', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('a'));
      res.write(nanoUsageFrame({
        prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, iterations: 1,
      }));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    await request(app).post('/api/ola/chat').send({ message: 'one' });
    await waitForWrites();
    await request(app).post('/api/ola/chat').send({ message: 'two' });
    await waitForWrites(2000);

    const rows = await mongoose.model('LlmUsage').find({}).lean();
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.requestId);
    expect(new Set(ids).size).toBe(2); // unique
  });
});

// ===========================================================================
// Cross-version compatibility — graceful degradation
// ===========================================================================

describe('chat — graceful fallback when NanoBot does not emit usage', () => {
  test('legacy NanoBot (no event:usage) → chat succeeds, NO LLMUsage row written', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('legacy reply'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);

    // Wait briefly for any potential write attempt, then confirm no row.
    await new Promise((r) => setTimeout(r, 300));
    const count = await mongoose.model('LlmUsage').countDocuments({});
    expect(count).toBe(0);

    // Chat persistence must still happen on this path (verifies the legacy
    // fallback only affects telemetry, not the user-visible behavior).
    const msgCount = await mongoose.model('ChatMessage').countDocuments({});
    expect(msgCount).toBe(2);
  });

  test('malformed usage frame JSON → chat succeeds, NO LLMUsage row, no crash', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('reply'));
      // Bad JSON in the data line. chat.js should JSON.parse → catch → no-op.
      res.write(`event: usage\ndata: {not valid json\n\n`);
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
  });

  test('usage frame with totalTokens=0 → no LLMUsage row (no real LLM call)', async () => {
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('cached fallback'));
      res.write(nanoUsageFrame({
        prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, iterations: 0,
      }));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
  });

  test('usage frame BEFORE [DONE] but AFTER text → still captured', async () => {
    // Production NanoBot emits usage right before [DONE]. This test
    // confirms ordering doesn't depend on whether usage comes mid-stream.
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoUsageFrame({
        prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, iterations: 1,
      }));
      res.write(nanoTextChunk('ok'));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    await request(app).post('/api/ola/chat').send({ message: 'hi' });
    await waitForWrites();

    const r = await mongoose.model('LlmUsage').findOne({}).lean();
    expect(r).toBeTruthy();
    expect(r.totalTokens).toBe(150);
  });

  test('frame missing provider field → no LLMUsage row, console.error fires', async () => {
    // Wire-contract enforcement (#98 C3): a malformed frame missing the
    // required `provider` field is rejected by recordUsage, so no row lands
    // in mongo. This guards against silently writing rows with default
    // provider values when nanobot ever rolls back to a version that
    // doesn't emit the field.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    nanoBotResponder = (_req, res) => {
      startSSE(res);
      res.write(nanoTextChunk('reply'));
      // Bypass the FRAME_META spread by constructing the frame directly.
      res.write(`event: usage\ndata: ${JSON.stringify({
        model: 'gemini-3.1-flash-lite-preview',  // provider intentionally missing
        prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, iterations: 1,
      })}\n\n`);
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    const res = await request(app).post('/api/ola/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('frame missing provider/model'),
    );
    errSpy.mockRestore();
  });
});

// ===========================================================================
// Error path — upstream NanoBot 5xx must NOT write LLMUsage (no real LLM call)
// ===========================================================================

describe('chat — upstream errors suppress LLMUsage writes', () => {
  test('NanoBot returns 503 → no LLMUsage row (no real LLM cost incurred)', async () => {
    nanoBotResponder = (_req, res) => {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'busy' } }));
    };
    const app = buildChatApp();
    await request(app).post('/api/ola/chat').send({ message: 'hi' });

    await new Promise((r) => setTimeout(r, 300));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
  });
});

// ===========================================================================
// Concurrency safety — no cross-request bleed (issue #98 motivation)
// ===========================================================================

describe('chat — concurrent requests do not cross-pollute usage data', () => {
  test('two parallel chats with different usage values both write correct rows', async () => {
    // Each request gets its own usage values. The whole reason we threaded
    // on_run_complete through nanobot's loop instead of relying on the
    // shared self._last_usage was to make this case correct. If shared state
    // bled, both rows might end up with the same numbers.
    let callCount = 0;
    nanoBotResponder = (_req, res) => {
      const myCall = ++callCount;
      startSSE(res);
      res.write(nanoTextChunk(`response-${myCall}`));
      res.write(nanoUsageFrame({
        prompt_tokens: myCall * 1000,
        completion_tokens: myCall * 100,
        total_tokens: myCall * 1100,
        iterations: 1,
      }));
      res.write(NANO_DONE);
      res.end();
    };
    const app = buildChatApp();
    await Promise.all([
      request(app).post('/api/ola/chat').send({ message: 'one' }),
      request(app).post('/api/ola/chat').send({ message: 'two' }),
    ]);
    await waitForWrites(2500);
    // Allow a beat for the second insert.
    await new Promise((r) => setTimeout(r, 200));

    const rows = await mongoose.model('LlmUsage').find({}).sort({ inputTokens: 1 }).lean();
    expect(rows).toHaveLength(2);
    expect(rows[0].inputTokens).toBe(1000);
    expect(rows[0].outputTokens).toBe(100);
    expect(rows[1].inputTokens).toBe(2000);
    expect(rows[1].outputTokens).toBe(200);
    // requestIds must differ (independent uuid per request).
    expect(rows[0].requestId).not.toBe(rows[1].requestId);
  });
});
