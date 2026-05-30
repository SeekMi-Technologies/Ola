/**
 * Multi-tenant isolation tests for olaController/chat.js autotitle path.
 *
 * Background (PR #258, Ziyue review, 2026-05-20):
 *   generateTitle() did not forward the X-Ola-Acting-As header that the main
 *   chat path sends. Nanobot's per-admin session routing fell back to
 *   admins/_system/sessions/ for the autotitle subagent, leaking the full
 *   conversation text (embedded in the autotitle prompt) across the
 *   multi-tenant boundary.
 *
 * Coverage:
 *   1. Unit — generateTitle outbound HTTP carries X-Ola-Acting-As = userId
 *   2. E2E (Ziyue's manual repro, automated) — accumulate 4 ChatMessages →
 *      maybeAutoTitle() triggers generateTitle → fake nanobot emulates the
 *      same per-admin routing nanobot does on disk (admins/<id>/ vs
 *      admins/_system/) → assert leak directory stays empty
 *
 * Nanobot's actual routing decision is covered by Ola_bot's
 * `test_no_header_falls_back_to_system_dir` (N2.8); CRM's contract here is
 * "the header is always sent". The fake nanobot only emulates routing
 * enough to make the leak visible in jest land.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BACKEND_ROOT = path.join(__dirname, '..');
const FAKE_NANOBOT_PORT = 18903;
const adminAId = new mongoose.Types.ObjectId();

let mongo;
let fakeNanoBot;
let tmpWorkspace;
let capturedRequests = [];

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  process.env.NANOBOT_HOST = '127.0.0.1';
  process.env.NANOBOT_PORT = String(FAKE_NANOBOT_PORT);

  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'autotitle-iso-'));

  fakeNanoBot = http.createServer((req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const actingAs = req.headers['x-ola-acting-as'];
      capturedRequests.push({
        headers: req.headers,
        body,
        actingAs: actingAs || null,
      });
      // Emulate nanobot's routing decision: with header → admins/<id>/sessions/,
      // without → admins/_system/sessions/. Persists the prompt payload to disk
      // so the test can assert what would have leaked.
      const dir = path.join(
        tmpWorkspace,
        'admins',
        actingAs || '_system',
        'sessions'
      );
      fs.mkdirSync(dir, { recursive: true });
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
      const sid = parsed.session_id || 'unknown';
      fs.writeFileSync(
        path.join(dir, `${sid}.jsonl`),
        JSON.stringify(parsed) + '\n'
      );
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      // Omit `usage` entirely → recordUsage skips silently (no LlmUsage row,
      // no console.error noise from the provider/model wire-contract check).
      res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Generated Title' },
          finish_reason: 'stop',
        }],
      }));
    });
  });
  await new Promise((resolve) =>
    fakeNanoBot.listen(FAKE_NANOBOT_PORT, '127.0.0.1', resolve)
  );
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeNanoBot) await new Promise((resolve) => fakeNanoBot.close(resolve));
  if (tmpWorkspace) fs.rmSync(tmpWorkspace, { recursive: true, force: true });
});

beforeEach(async () => {
  capturedRequests = [];
  for (const name of ['ChatSession', 'ChatMessage', 'LlmUsage']) {
    if (mongoose.models[name]) await mongoose.models[name].deleteMany({});
  }
  // Wipe fake-workspace between cases so disk assertions are deterministic.
  if (fs.existsSync(tmpWorkspace)) {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    fs.mkdirSync(tmpWorkspace, { recursive: true });
  }
});

async function waitForCapture(timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (capturedRequests.length > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('autotitle multi-tenant isolation (PR #258 Ziyue review)', () => {
  test('unit: generateTitle outbound request carries X-Ola-Acting-As = userId', async () => {
    const ChatSession = mongoose.model('ChatSession');
    const session = await ChatSession.create({
      userId: adminAId,
      nanobotSessionId: 'user:test:conv:header-1',
      title: 'New Chat',
      createdBy: adminAId,
    });

    const { __test__ } = require(
      path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
    );
    __test__.generateTitle(session, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ], adminAId);

    await waitForCapture();
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].actingAs).toBe(adminAId.toString());
  });

  test('e2e: 4-msg conversation triggers maybeAutoTitle → no _system/ leak (Ziyue repro automated)', async () => {
    const ChatSession = mongoose.model('ChatSession');
    const ChatMessage = mongoose.model('ChatMessage');

    const session = await ChatSession.create({
      userId: adminAId,
      nanobotSessionId: 'user:test:conv:e2e-1',
      title: 'New Chat',
      createdBy: adminAId,
    });

    // Seed 4 messages including Ziyue's exact probe phrase. maybeAutoTitle's
    // count threshold (>=4) triggers; generateTitle embeds full conversation
    // as the prompt body and forwards to nanobot.
    const SECRET = 'SECRET_ZIYUE_E2E_PHRASE = banana cinnamon roll';
    const seed = [
      { role: 'user', content: 'where is my order' },
      { role: 'assistant', content: 'Q-1234 ships tomorrow' },
      { role: 'user', content: `please remember a probe: ${SECRET}` },
      { role: 'assistant', content: 'noted the probe phrase' },
    ];
    for (const m of seed) {
      await ChatMessage.create({
        sessionId: session._id,
        role: m.role,
        content: m.content,
        createdBy: adminAId,
      });
    }

    const { __test__ } = require(
      path.join(BACKEND_ROOT, 'src/controllers/appControllers/olaController/chat')
    );
    __test__.maybeAutoTitle(session, seed[2], seed[3].content, adminAId);

    await waitForCapture();

    // Contract assertion: outbound autotitle request carried the header.
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].actingAs).toBe(adminAId.toString());

    // Behavioral assertion: simulated nanobot disk routing landed in
    // admins/<adminA>/sessions/, not admins/_system/sessions/. This is the
    // exact failure mode Ziyue caught manually on 2026-05-20.
    const adminDir = path.join(tmpWorkspace, 'admins', adminAId.toString(), 'sessions');
    const systemDir = path.join(tmpWorkspace, 'admins', '_system', 'sessions');
    expect(fs.existsSync(adminDir)).toBe(true);
    expect(fs.readdirSync(adminDir).length).toBeGreaterThan(0);
    expect(fs.existsSync(systemDir)).toBe(false);

    // Secret was indeed embedded in what nanobot received → fix below the
    // header layer (e.g. don't send conversation in autotitle) is a future
    // concern; for now the header proves no _system/ filesystem leak.
    expect(capturedRequests[0].body).toContain(SECRET);
  });
});
