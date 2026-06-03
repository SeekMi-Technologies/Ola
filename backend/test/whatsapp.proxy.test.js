/**
 * Tests for the WhatsApp CRM proxy controller (#326 / T2).
 *
 * Strategy: mount the 3 controllers behind a fake adminAuth (injects req.admin)
 * on a throwaway express app, back them with a fake bridge HTTP server and an
 * in-memory Mongo. No real WhatsApp/Baileys involved.
 *
 * Covers:
 *  - login → 200 {status:qr_pending} + Integration row {enabled:true}
 *  - status → 200 passes through {status, qr}; refreshes cache only on change
 *  - logout → 200 {status:logged_out} + Integration {enabled:false}
 *  - bridge unreachable → 503 'WhatsApp bridge not running'
 *  - bridge non-2xx → 502 'WhatsApp bridge error'
 *  - HMAC Bearer is what the bridge receives
 */

const http = require('http');
const path = require('path');
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const { MongoMemoryServer } = require('mongodb-memory-server');

const SECRET = 'test-mcp-service-token-0123456789';
process.env.MCP_SERVICE_TOKEN = SECRET;

const BACKEND_ROOT = path.join(__dirname, '..');
const ADMIN_ID = new mongoose.Types.ObjectId();

let mongo;
let Integration;
let app;
let fakeBridge;
let bridgeRespond; // (req, res) => void — overridable per test
let lastBridgeReq; // { method, url, auth }

beforeAll(async () => {
  globSync('src/models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Integration = mongoose.model('Integration');
  await Integration.init();

  // Fake bridge: capture the request, then defer to the per-test responder.
  fakeBridge = http.createServer((req, res) => {
    lastBridgeReq = { method: req.method, url: req.url, auth: req.headers.authorization };
    bridgeRespond(req, res);
  });
  await new Promise((r) => fakeBridge.listen(0, '127.0.0.1', r));
  process.env.WA_BRIDGE_HOST = '127.0.0.1';
  process.env.WA_BRIDGE_PORT = String(fakeBridge.address().port);

  const { catchErrors } = require('@/handlers/errorHandlers');
  const wa = require('@/controllers/appControllers/whatsappController');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { _id: ADMIN_ID };
    next();
  });
  app.post('/api/whatsapp/login', catchErrors(wa.login));
  app.get('/api/whatsapp/status', catchErrors(wa.status));
  app.delete('/api/whatsapp', catchErrors(wa.logout));
}, 120000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fakeBridge) await new Promise((r) => fakeBridge.close(r));
});

beforeEach(async () => {
  await Integration.deleteMany({});
  // Default responder mirrors the bridge contract by method/action.
  bridgeRespond = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'POST' && req.url.endsWith('/login')) {
      res.end(JSON.stringify({ status: 'qr_pending' }));
    } else if (req.method === 'GET' && req.url.endsWith('/status')) {
      res.end(JSON.stringify({ status: 'qr_pending', qr: 'QR-DATA-123' }));
    } else if (req.method === 'DELETE') {
      res.end(JSON.stringify({ status: 'logged_out' }));
    } else {
      res.writeHead(404).end();
    }
  };
});

const expectedToken = () => crypto.createHmac('sha256', SECRET).update(ADMIN_ID.toString()).digest('hex');

test('1. login → 200 qr_pending + Integration row enabled=true', async () => {
  const res = await request(app).post('/api/whatsapp/login');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ success: true, result: { status: 'qr_pending' } });

  const row = await Integration.findOne({ createdBy: ADMIN_ID, provider: 'whatsapp' });
  expect(row).not.toBeNull();
  expect(row.enabled).toBe(true);
  expect(row.status).toBe('qr_pending');

  // bridge saw POST /wa/<id>/login with the HMAC Bearer
  expect(lastBridgeReq.method).toBe('POST');
  expect(lastBridgeReq.url).toBe(`/wa/${ADMIN_ID}/login`);
  expect(lastBridgeReq.auth).toBe(`Bearer ${expectedToken()}`);
});

test('2. status → 200 passes through {status, qr}', async () => {
  const res = await request(app).get('/api/whatsapp/status');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.result).toEqual({ status: 'qr_pending', qr: 'QR-DATA-123' });
});

test('3. status refreshes cache only on change (no redundant write)', async () => {
  // seed connected row
  await Integration.create({ createdBy: ADMIN_ID, provider: 'whatsapp', enabled: true, status: 'connected' });
  const before = await Integration.findOne({ createdBy: ADMIN_ID, provider: 'whatsapp' });

  // bridge still reports connected → status unchanged → no write (updated stays)
  bridgeRespond = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'connected' }));
  };
  await request(app).get('/api/whatsapp/status');
  const afterSame = await Integration.findOne({ createdBy: ADMIN_ID, provider: 'whatsapp' });
  expect(afterSame.updated.getTime()).toBe(before.updated.getTime());

  // bridge now reports disconnected → status changed → row updated
  bridgeRespond = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'disconnected' }));
  };
  await request(app).get('/api/whatsapp/status');
  const afterChange = await Integration.findOne({ createdBy: ADMIN_ID, provider: 'whatsapp' });
  expect(afterChange.status).toBe('disconnected');
});

test('4. status does NOT create a row when none exists (login owns creation)', async () => {
  await request(app).get('/api/whatsapp/status');
  expect(await Integration.countDocuments({ createdBy: ADMIN_ID })).toBe(0);
});

test('5. logout → 200 logged_out + Integration enabled=false', async () => {
  await Integration.create({ createdBy: ADMIN_ID, provider: 'whatsapp', enabled: true, status: 'connected' });
  const res = await request(app).delete('/api/whatsapp');
  expect(res.status).toBe(200);
  expect(res.body.result.status).toBe('logged_out');

  const row = await Integration.findOne({ createdBy: ADMIN_ID, provider: 'whatsapp' });
  expect(row.enabled).toBe(false);
  expect(row.status).toBe('logged_out');
  expect(lastBridgeReq.method).toBe('DELETE');
  expect(lastBridgeReq.url).toBe(`/wa/${ADMIN_ID}`);
});

test('6. bridge unreachable → 503 plain message', async () => {
  const saved = process.env.WA_BRIDGE_PORT;
  // point at a closed port → ECONNREFUSED
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  await new Promise((r) => probe.close(r));
  process.env.WA_BRIDGE_PORT = String(deadPort);
  try {
    const res = await request(app).get('/api/whatsapp/status');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, result: null, message: 'WhatsApp bridge not running' });
  } finally {
    process.env.WA_BRIDGE_PORT = saved;
  }
});

test('7. bridge non-2xx → 502', async () => {
  bridgeRespond = (_req, res) => {
    res.writeHead(500).end('boom');
  };
  const res = await request(app).post('/api/whatsapp/login');
  expect(res.status).toBe(502);
  expect(res.body.message).toBe('WhatsApp bridge error');
});

test('8. bridge 2xx with non-JSON body → 502 (not a silent success)', async () => {
  bridgeRespond = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>proxy error</html>');
  };
  const res = await request(app).post('/api/whatsapp/login');
  expect(res.status).toBe(502);
  expect(res.body.message).toBe('WhatsApp bridge error');
  // and no Integration row was written for a non-success
  expect(await Integration.countDocuments({ createdBy: ADMIN_ID })).toBe(0);
});
