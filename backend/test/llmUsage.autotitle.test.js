/**
 * Unit test for olaController/chat.js auto-title LLMUsage capture
 * (Ola CRM #98 C5).
 *
 * generateTitle() makes a non-streaming /v1/chat/completions call to
 * nanobot for a short conversation summary. Token spend on that call
 * should be persisted with channel='ask-ola-autotitle' so the dashboard
 * can split it from user-facing chat cost.
 *
 * Pattern: spawn a fake nanobot HTTP server on a unique port (18902 to
 * avoid collision with llmUsage.chat.test.js's 18901), let it serve a
 * canned non-streaming OpenAI response with a `usage` object that
 * mirrors what real nanobot/api/server.py:_chat_completion_response
 * returns post-N4. Then call generateTitle directly and assert a single
 * LlmUsage row appears with the correct channel.
 */

const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const adminId = new mongoose.Types.ObjectId();
const FAKE_NANOBOT_PORT = 18902;

const FRAME_USAGE = {
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite-preview',
  prompt_tokens: 240,
  completion_tokens: 12,
  total_tokens: 252,
  cached_tokens: 0,
  iterations: 1,
};

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
          nanoBotResponder(req, res, body);
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
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeNanoBot) await new Promise((resolve) => fakeNanoBot.close(resolve));
});

beforeEach(async () => {
  nanoBotResponder = null;
  for (const name of ['ChatSession', 'LlmUsage']) {
    if (mongoose.models[name]) await mongoose.models[name].deleteMany({});
  }
});

async function waitForRow(channel, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = await mongoose.model('LlmUsage').countDocuments({ channel });
    if (c > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('generateTitle — auto-title LLMUsage capture (#98 C5)', () => {
  test('non-streaming response usage → LlmUsage row with channel=ask-ola-autotitle', async () => {
    nanoBotResponder = (_req, res, _body) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-fake-title',
        object: 'chat.completion',
        model: 'gemini-3.1-flash-lite-preview',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Order Status Inquiry' },
          finish_reason: 'stop',
        }],
        usage: FRAME_USAGE,
      }));
    };

    const ChatSession = mongoose.model('ChatSession');
    const session = await ChatSession.create({
      userId: adminId,
      nanobotSessionId: 'user:test:conv:title-1',
      title: 'New Chat',
      createdBy: adminId,
    });

    const { __test__ } = require(
      path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
    );
    __test__.generateTitle(session, [
      { role: 'user', content: 'where is my order?' },
      { role: 'assistant', content: 'order Q-1234 ships tomorrow' },
    ], adminId);

    await waitForRow('ask-ola-autotitle');

    const rows = await mongoose.model('LlmUsage').find({}).lean();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.channel).toBe('ask-ola-autotitle');
    expect(r.userId.toString()).toBe(adminId.toString());
    expect(r.sessionId.toString()).toBe(session._id.toString());
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe('gemini-3.1-flash-lite-preview');
    expect(r.inputTokens).toBe(240);
    expect(r.outputTokens).toBe(12);
    expect(r.totalTokens).toBe(252);
    expect(r.iterations).toBe(1);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.requestId).toBeTruthy();
    expect(r.messageId).toBeNull();
  });

  test('non-streaming response WITHOUT usage → no LlmUsage row (legacy nanobot)', async () => {
    nanoBotResponder = (_req, res, _body) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      // Pre-N4 nanobot: response body does not include `usage` field at all
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Some Title' },
          finish_reason: 'stop',
        }],
      }));
    };

    const ChatSession = mongoose.model('ChatSession');
    const session = await ChatSession.create({
      userId: adminId,
      nanobotSessionId: 'user:test:conv:title-2',
      title: 'New Chat',
      createdBy: adminId,
    });

    const { __test__ } = require(
      path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
    );
    __test__.generateTitle(session, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ], adminId);

    // Wait briefly to confirm no row materializes
    await new Promise((r) => setTimeout(r, 400));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
  });

  test('non-streaming response with zero-usage placeholder → no LlmUsage row', async () => {
    // Pre-N4 nanobot's hardcoded {0,0,0} placeholder must be skipped
    // (totalTokens=0 short-circuit in recordUsage).
    nanoBotResponder = (_req, res, _body) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: 'T' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
    };

    const ChatSession = mongoose.model('ChatSession');
    const session = await ChatSession.create({
      userId: adminId,
      nanobotSessionId: 'user:test:conv:title-3',
      title: 'New Chat',
      createdBy: adminId,
    });

    const { __test__ } = require(
      path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
    );
    __test__.generateTitle(session, [{ role: 'user', content: 'q' }], adminId);

    await new Promise((r) => setTimeout(r, 400));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
  });

  test('non-streaming response usage missing provider → no LlmUsage row, console.error fires', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    nanoBotResponder = (_req, res, _body) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      // usage exists but lacks provider — wire-contract violation
      res.end(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: 'T' }, finish_reason: 'stop' }],
        usage: { model: 'gemini-flash', prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }));
    };

    const ChatSession = mongoose.model('ChatSession');
    const session = await ChatSession.create({
      userId: adminId,
      nanobotSessionId: 'user:test:conv:title-4',
      title: 'New Chat',
      createdBy: adminId,
    });

    const { __test__ } = require(
      path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
    );
    __test__.generateTitle(session, [{ role: 'user', content: 'q' }], adminId);

    await new Promise((r) => setTimeout(r, 400));
    expect(await mongoose.model('LlmUsage').countDocuments({})).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('frame missing provider/model'),
    );
    errSpy.mockRestore();
  });
});
