/**
 * Tests for openaiProvider (#271 — T1 unit gap).
 *
 * openaiProvider.js was extracted from transcriptionWorker.js in #257 PR #269
 * but never got its own dedicated unit suite. Existing coverage only hit it
 * indirectly through file.upload.transcription.test.js (one happy-path mock).
 * This file covers the provider in isolation so dispatcher-level regressions
 * can't hide error-path breakage in either provider.
 *
 * Covers:
 *  - formatDiarizedJson: multi-segment / single segment / missing speaker /
 *    empty segments+text fallback / completely empty payload / start edge cases
 *  - callOpenAI: no OPENAI_API_KEY / happy POST / HTTP 401 with body.error.message
 *    / HTTP 500 string body / HTTP 500 object body without error.message
 *    / network error (no .response) passes through unchanged
 *  - transcribeViaOpenAI: happy orchestration / callOpenAI error propagates
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('axios');
const axios = require('axios');

const transcribeViaOpenAI = require('@/jobs/providers/openaiProvider');
const { callOpenAI, formatDiarizedJson } = transcribeViaOpenAI.__test__;

// callOpenAI invokes fsSync.createReadStream(audioPath) before reaching axios.
// The stream itself is never consumed because axios.post is mocked, but the
// path must exist or createReadStream throws ENOENT on the spot.
let TMP_AUDIO;
beforeAll(() => {
  TMP_AUDIO = path.join(os.tmpdir(), `openai-provider-test-${Date.now()}.mp3`);
  fs.writeFileSync(TMP_AUDIO, Buffer.from('FAKE_AUDIO_BYTES_FOR_STREAM_TARGET'));
});
afterAll(() => {
  try { fs.unlinkSync(TMP_AUDIO); } catch (_) { /* already gone */ }
});

beforeEach(() => {
  jest.resetAllMocks();
});

// =========== formatDiarizedJson ===========

test('formatDiarizedJson: multi-segment renders A/B speaker + mmss', () => {
  const out = formatDiarizedJson({
    segments: [
      { speaker: 'A', start: 0, text: 'hello' },
      { speaker: 'B', start: 14, text: 'hi back' },
      { speaker: 'A', start: 624.3, text: 'much later' },
    ],
  });
  expect(out).toBe('A 00:00  hello\nB 00:14  hi back\nA 10:24  much later');
});

test('formatDiarizedJson: missing speaker → "?" fallback', () => {
  const out = formatDiarizedJson({
    segments: [{ start: 5, text: 'mystery voice' }],
  });
  expect(out).toBe('? 00:05  mystery voice');
});

test('formatDiarizedJson: empty segments + payload.text → text fallback', () => {
  // OpenAI sometimes returns text-only when diarization fails to find boundaries
  expect(formatDiarizedJson({ segments: [], text: 'undiarized transcript' }))
    .toBe('undiarized transcript');
});

test('formatDiarizedJson: no segments key + payload.text → text fallback', () => {
  expect(formatDiarizedJson({ text: 'just text' })).toBe('just text');
});

test('formatDiarizedJson: completely empty payload → empty string', () => {
  expect(formatDiarizedJson({})).toBe('');
  expect(formatDiarizedJson(null)).toBe('');
  expect(formatDiarizedJson(undefined)).toBe('');
});

test('formatDiarizedJson: seg.start non-numeric → 00:00', () => {
  const out = formatDiarizedJson({
    segments: [{ speaker: 'A', start: 'not a number', text: 'x' }],
  });
  expect(out).toBe('A 00:00  x');
});

test('formatDiarizedJson: trims whitespace in text', () => {
  const out = formatDiarizedJson({
    segments: [{ speaker: 'A', start: 0, text: '  padded text  ' }],
  });
  expect(out).toBe('A 00:00  padded text');
});

// =========== callOpenAI ===========

test('callOpenAI: no OPENAI_API_KEY → throws "not set"', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await expect(callOpenAI(TMP_AUDIO)).rejects.toThrow(/OPENAI_API_KEY not set/);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});

test('callOpenAI: happy POST returns response.data', async () => {
  process.env.OPENAI_API_KEY = 'sk-fake-for-tests';
  axios.post.mockResolvedValueOnce({
    data: { segments: [{ speaker: 'A', start: 0, text: 'ok' }] },
  });
  const payload = await callOpenAI(TMP_AUDIO);
  expect(payload.segments).toHaveLength(1);
  expect(payload.segments[0].text).toBe('ok');

  // Verify POST shape: URL + Authorization header
  expect(axios.post).toHaveBeenCalledTimes(1);
  const [url, , config] = axios.post.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
  expect(config.headers.Authorization).toBe('Bearer sk-fake-for-tests');
});

test('callOpenAI: HTTP 401 with body.error.message → "OpenAI HTTP 401: <message>"', async () => {
  process.env.OPENAI_API_KEY = 'sk-bad';
  axios.post.mockRejectedValueOnce({
    response: {
      status: 401,
      data: { error: { message: 'Incorrect API key provided' } },
    },
  });
  let caught;
  try {
    await callOpenAI(TMP_AUDIO);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeDefined();
  expect(caught.message).toMatch(/OpenAI HTTP 401: Incorrect API key/);
  expect(caught.status).toBe(401);
  expect(caught.openaiBody).toEqual({ error: { message: 'Incorrect API key provided' } });
});

test('callOpenAI: HTTP 500 with string body → "OpenAI HTTP 500: <truncated>"', async () => {
  process.env.OPENAI_API_KEY = 'sk-fake';
  axios.post.mockRejectedValueOnce({
    response: { status: 500, data: 'Internal Server Error — backend down' },
  });
  await expect(callOpenAI(TMP_AUDIO)).rejects.toThrow(/OpenAI HTTP 500: Internal Server Error/);
});

test('callOpenAI: HTTP 500 with object body lacking error.message → stringified body', async () => {
  process.env.OPENAI_API_KEY = 'sk-fake';
  axios.post.mockRejectedValueOnce({
    response: { status: 500, data: { weird: 'shape', no_error_field: true } },
  });
  let caught;
  try {
    await callOpenAI(TMP_AUDIO);
  } catch (e) {
    caught = e;
  }
  expect(caught.message).toMatch(/OpenAI HTTP 500/);
  expect(caught.message).toContain('weird');
  expect(caught.message).toContain('no_error_field');
});

test('callOpenAI: network error (no .response) → original error passes through unchanged', async () => {
  process.env.OPENAI_API_KEY = 'sk-fake';
  const networkErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
    code: 'ECONNREFUSED',
  });
  // First: verify the error message
  axios.post.mockRejectedValueOnce(networkErr);
  await expect(callOpenAI(TMP_AUDIO)).rejects.toThrow(/ECONNREFUSED/);
  // Second: verify the code is not wrapped
  axios.post.mockRejectedValueOnce(networkErr);
  const err = await callOpenAI(TMP_AUDIO).catch((e) => e);
  expect(err.code).toBe('ECONNREFUSED');
  expect(err.message).not.toMatch(/^OpenAI HTTP/);
});

// =========== transcribeViaOpenAI (orchestration) ===========

test('transcribeViaOpenAI: happy path → formatted sidecar string', async () => {
  process.env.OPENAI_API_KEY = 'sk-fake';
  axios.post.mockResolvedValueOnce({
    data: {
      segments: [
        { speaker: 'A', start: 0, text: 'first' },
        { speaker: 'B', start: 3, text: 'second' },
      ],
    },
  });
  const out = await transcribeViaOpenAI(TMP_AUDIO);
  expect(out).toBe('A 00:00  first\nB 00:03  second');
});

test('transcribeViaOpenAI: callOpenAI HTTP error propagates wrapped message', async () => {
  process.env.OPENAI_API_KEY = 'sk-fake';
  axios.post.mockRejectedValueOnce({
    response: { status: 429, data: { error: { message: 'Rate limit exceeded' } } },
  });
  await expect(transcribeViaOpenAI(TMP_AUDIO)).rejects.toThrow(/OpenAI HTTP 429: Rate limit/);
});
