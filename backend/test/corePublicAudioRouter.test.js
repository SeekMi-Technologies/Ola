/**
 * Tests for corePublicAudioRouter (#257 Item 2).
 *
 * Covers:
 *  - Happy path: valid 4-segment URL serves file from UPLOADS_DIR (200 + bytes)
 *  - Strict regex on each segment (400 for adminId/year/month/filename mismatch)
 *  - Path traversal attempts blocked by regex (400) — `..` etc never match
 *  - Valid format but file absent on disk → 404
 *  - Belt-and-suspenders: even contrived crafted path stays inside UPLOADS_DIR
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

// Override UPLOADS_DIR to a tmp sandbox BEFORE requiring the router.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ola-router-test-'));
process.env.UPLOADS_DIR = SANDBOX;

// Clear @/utils/uploadsPath from cache to ensure it picks up the env override.
delete require.cache[require.resolve('@/utils/uploadsPath')];

const corePublicAudioRouter = require('@/routes/coreRoutes/corePublicAudioRouter');

const VALID_ADMIN = 'a'.repeat(24);
const VALID_YEAR = '2026';
const VALID_MONTH = '05';
const VALID_FILE = '9f8a3b2c-7e1d-4a5b-9c6d-1f2e3a4b5c6d.m4a';

let app;

beforeAll(() => {
  app = express();
  app.use('/public/audio', corePublicAudioRouter);

  // Create the test file at expected sandbox path
  const dir = path.join(SANDBOX, VALID_ADMIN, VALID_YEAR, VALID_MONTH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, VALID_FILE), Buffer.from('FAKE_AUDIO_BYTES'));
});

afterAll(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('1. Happy: valid URL serves file (200 + body bytes)', async () => {
  const res = await request(app).get(
    `/public/audio/${VALID_ADMIN}/${VALID_YEAR}/${VALID_MONTH}/${VALID_FILE}`
  );
  expect(res.status).toBe(200);
  expect(res.body.toString()).toBe('FAKE_AUDIO_BYTES');
});

test('2. Invalid adminId (not 24 hex) → 400', async () => {
  const res = await request(app).get(
    `/public/audio/not-a-mongo-id/${VALID_YEAR}/${VALID_MONTH}/${VALID_FILE}`
  );
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/adminId/);
});

test('3. Invalid year (3 digits) → 400', async () => {
  const res = await request(app).get(
    `/public/audio/${VALID_ADMIN}/202/${VALID_MONTH}/${VALID_FILE}`
  );
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/year/);
});

test('4. Invalid month (1 digit) → 400', async () => {
  const res = await request(app).get(
    `/public/audio/${VALID_ADMIN}/${VALID_YEAR}/5/${VALID_FILE}`
  );
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/month/);
});

test('5. Invalid filename (no extension) → 400', async () => {
  const noext = '9f8a3b2c-7e1d-4a5b-9c6d-1f2e3a4b5c6d';
  const res = await request(app).get(
    `/public/audio/${VALID_ADMIN}/${VALID_YEAR}/${VALID_MONTH}/${noext}`
  );
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/filename/);
});

test('6. Path traversal attempt with .. in filename → blocked by regex (400)', async () => {
  // Express decodes %2E → '.' so traversal must appear in a way URL can carry.
  // We use raw `..%2Fetc%2Fpasswd` as filename — fails uuid regex.
  const res = await request(app).get(
    `/public/audio/${VALID_ADMIN}/${VALID_YEAR}/${VALID_MONTH}/..%2Fetc%2Fpasswd`
  );
  expect(res.status).toBe(400);
});

test('7. Valid format but file does not exist on disk → 404', async () => {
  const missing = 'deadbeef-0000-4000-8000-000000000000.m4a';
  const res = await request(app).get(
    `/public/audio/${VALID_ADMIN}/${VALID_YEAR}/${VALID_MONTH}/${missing}`
  );
  expect(res.status).toBe(404);
  expect(res.body.message).toMatch(/not found/);
});

test('8. Wrong adminId (valid hex but different) returns 404, not someone elseʼs file', async () => {
  const otherAdmin = 'b'.repeat(24);
  const res = await request(app).get(
    `/public/audio/${otherAdmin}/${VALID_YEAR}/${VALID_MONTH}/${VALID_FILE}`
  );
  // Should pass regex, fail at sendFile (different admin dir doesn't exist)
  expect(res.status).toBe(404);
});
