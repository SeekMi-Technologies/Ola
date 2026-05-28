/**
 * Tests for paraformerProvider (#257 Item 3).
 *
 * Covers:
 *  - submitTask: success / no API key / HTTP error / no task_id
 *  - pollTask: SUCCEEDED / FAILED / heartbeat invoked each tick / timeout
 *  - fetchTranscripts: returns transcripts array / HTTP failure
 *  - formatParaformerSidecar: speaker_id 0→A 1→B / mmss format / multi-speaker / empty
 *  - applyOpenCC: simplified→hk traditional + 繫→係 quirk fix
 *  - speakerIdToLetter edge cases
 *  - transcribeViaParaformer happy path orchestration
 *  - transcribeViaParaformer no BACKEND_PUBLIC_BASE_URL → throws
 */

// Speed up poll loops for tests — must be set BEFORE require.
process.env.PARAFORMER_POLL_INTERVAL_MS = '5';
process.env.PARAFORMER_MAX_WAIT_MS = '500';
process.env.DASHSCOPE_API_KEY = 'sk-fake-for-tests';
process.env.BACKEND_PUBLIC_BASE_URL = 'https://test.example.com';

jest.mock('axios');
const axios = require('axios');

const transcribeViaParaformer = require('@/jobs/providers/paraformerProvider');
const {
  submitTask,
  pollTask,
  fetchTranscripts,
  formatParaformerSidecar,
  applyOpenCC,
  speakerIdToLetter,
  formatMmSs,
} = transcribeViaParaformer.__test__;

beforeEach(() => {
  jest.resetAllMocks();
});

// =========== speakerIdToLetter ===========

test('speakerIdToLetter: 0→A, 1→B, 25→Z, 26→S26, negative→?, non-number→?', () => {
  expect(speakerIdToLetter(0)).toBe('A');
  expect(speakerIdToLetter(1)).toBe('B');
  expect(speakerIdToLetter(25)).toBe('Z');
  expect(speakerIdToLetter(26)).toBe('S26');
  expect(speakerIdToLetter(-1)).toBe('?');
  expect(speakerIdToLetter(null)).toBe('?');
  expect(speakerIdToLetter(undefined)).toBe('?');
});

// =========== formatMmSs ===========

test('formatMmSs: 0→00:00, 14000→00:14, 624300→10:24, missing→00:00', () => {
  expect(formatMmSs(0)).toBe('00:00');
  expect(formatMmSs(14000)).toBe('00:14');
  expect(formatMmSs(624300)).toBe('10:24');
  expect(formatMmSs(null)).toBe('00:00');
  expect(formatMmSs(undefined)).toBe('00:00');
});

// =========== formatParaformerSidecar ===========

test('formatParaformerSidecar: maps speaker_id+begin_time+text to lines', () => {
  const transcripts = [{
    sentences: [
      { speaker_id: 0, begin_time: 0, text: 'hello world' },
      { speaker_id: 1, begin_time: 14000, text: '你好' },
      { speaker_id: 0, begin_time: 27500, text: 'second turn' },
    ],
  }];
  const out = formatParaformerSidecar(transcripts);
  expect(out).toBe(
    'A 00:00  hello world\n' +
    'B 00:14  你好\n' +
    'A 00:27  second turn'
  );
});

test('formatParaformerSidecar: empty input → empty string', () => {
  expect(formatParaformerSidecar([])).toBe('');
  expect(formatParaformerSidecar(null)).toBe('');
  expect(formatParaformerSidecar([{ sentences: [] }])).toBe('');
});

// =========== applyOpenCC ===========

test('applyOpenCC: simplified → HK traditional', () => {
  const input = '讲细啲 嗰啲 听 数 实 时 边 见 国 经 网 余';
  const out = applyOpenCC(input);
  // each simplified char → HK traditional equivalent
  expect(out).toContain('講');
  expect(out).toContain('聽');
  expect(out).toContain('數');
  expect(out).toContain('實');
  expect(out).toContain('時');
  expect(out).toContain('邊');
  expect(out).toContain('國');
  expect(out).toContain('經');
  // and no simplified leakage
  expect(out).not.toMatch(/[讲听数实时边见国经网余]/);
});

test('applyOpenCC: 繫→係 post-fix (Cantonese 系 quirk)', () => {
  // OpenCC turns standalone 系个 → 繫個 (= "to tie a piece"), but
  // Cantonese 系 is always 係 (= "is/yes"). The post-fix corrects this.
  const input = '系个原因系咩咧';
  const out = applyOpenCC(input);
  expect(out).toContain('係'); // appears at least once
  expect(out).not.toContain('繫'); // never escapes
});

// =========== submitTask ===========

test('submitTask: happy path returns task_id', async () => {
  axios.post.mockResolvedValueOnce({
    data: { output: { task_id: 'task-abc-123', task_status: 'PENDING' } },
  });
  const id = await submitTask('https://example.com/audio.mp3');
  expect(id).toBe('task-abc-123');
  expect(axios.post).toHaveBeenCalledWith(
    'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
    expect.objectContaining({
      model: 'paraformer-v2',
      input: { file_urls: ['https://example.com/audio.mp3'] },
      parameters: expect.objectContaining({
        diarization_enabled: true,
        language_hints: ['yue', 'zh', 'en'],
      }),
    }),
    expect.objectContaining({ headers: expect.objectContaining({ 'X-DashScope-Async': 'enable' }) })
  );
});

test('submitTask: no DASHSCOPE_API_KEY → throws "not set"', async () => {
  const saved = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  try {
    await expect(submitTask('https://example.com/x.mp3')).rejects.toThrow(/DASHSCOPE_API_KEY not set/);
  } finally {
    process.env.DASHSCOPE_API_KEY = saved;
  }
});

test('submitTask: HTTP 4xx error surfaced with status + body', async () => {
  axios.post.mockRejectedValueOnce({
    response: { status: 400, data: { code: 'InvalidParameter', message: 'bad lang' } },
    message: 'Request failed with status code 400',
  });
  await expect(submitTask('https://example.com/x.mp3')).rejects.toThrow(/Paraformer submit failed: HTTP 400/);
});

test('submitTask: response missing task_id → throws', async () => {
  axios.post.mockResolvedValueOnce({ data: { output: { task_status: 'PENDING' } } });
  await expect(submitTask('https://example.com/x.mp3')).rejects.toThrow(/no task_id/);
});

// =========== pollTask ===========

test('pollTask: SUCCEEDED on first poll returns data (uses GET per DashScope doc)', async () => {
  axios.get.mockResolvedValueOnce({
    data: { output: { task_id: 't1', task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED' }] } },
  });
  const out = await pollTask('t1');
  expect(out.output.task_status).toBe('SUCCEEDED');
  expect(axios.get).toHaveBeenCalledWith(
    'https://dashscope.aliyuncs.com/api/v1/tasks/t1',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-fake-for-tests' }) })
  );
});

test('pollTask: heartbeat callback invoked each poll iteration', async () => {
  axios.get
    .mockResolvedValueOnce({ data: { output: { task_status: 'RUNNING' } } })
    .mockResolvedValueOnce({ data: { output: { task_status: 'RUNNING' } } })
    .mockResolvedValueOnce({ data: { output: { task_status: 'SUCCEEDED' } } });
  const heartbeat = jest.fn().mockResolvedValue();
  await pollTask('t1', { onPollHeartbeat: heartbeat });
  expect(heartbeat).toHaveBeenCalledTimes(3);
});

test('pollTask: FAILED status returned (caller decides what to do)', async () => {
  axios.get.mockResolvedValueOnce({
    data: { output: { task_status: 'FAILED' }, code: 'InternalError' },
  });
  const out = await pollTask('t1');
  expect(out.output.task_status).toBe('FAILED');
});

test('pollTask: never-finishing task → timeout throw', async () => {
  axios.get.mockResolvedValue({ data: { output: { task_status: 'RUNNING' } } });
  // POLL_MAX_WAIT_MS=500ms, POLL_INTERVAL_MS=5ms → ~100 polls then throw
  await expect(pollTask('stuck')).rejects.toThrow(/poll timeout/);
});

test('pollTask: transient ECONNRESET retried, then SUCCEEDED returned', async () => {
  const err1 = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const err2 = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  axios.get
    .mockRejectedValueOnce(err1)
    .mockRejectedValueOnce(err2)
    .mockResolvedValueOnce({ data: { output: { task_status: 'SUCCEEDED' } } });
  const out = await pollTask('flaky');
  expect(out.output.task_status).toBe('SUCCEEDED');
  expect(axios.get).toHaveBeenCalledTimes(3);
});

test('pollTask: HTTP 5xx treated as transient (retried)', async () => {
  const err5xx = { response: { status: 503, data: { error: 'gateway' } }, message: '503' };
  axios.get
    .mockRejectedValueOnce(err5xx)
    .mockResolvedValueOnce({ data: { output: { task_status: 'SUCCEEDED' } } });
  const out = await pollTask('flaky5xx');
  expect(out.output.task_status).toBe('SUCCEEDED');
});

test('pollTask: HTTP 4xx aborts immediately (NOT retried)', async () => {
  const err4xx = { response: { status: 401, data: { error: 'unauthorized' } }, message: '401' };
  axios.get.mockRejectedValueOnce(err4xx);
  await expect(pollTask('badauth')).rejects.toThrow(/Paraformer poll failed: HTTP 401/);
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test('pollTask: persistent transient errors > MAX_CONSECUTIVE_TRANSIENT abort', async () => {
  const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
  // MAX_CONSECUTIVE_TRANSIENT=5, so 6th throws
  axios.get.mockRejectedValue(err);
  await expect(pollTask('downhost')).rejects.toThrow(/Paraformer poll failed/);
});

// =========== fetchTranscripts ===========

test('fetchTranscripts: returns transcripts array from response', async () => {
  axios.get.mockResolvedValueOnce({
    data: { transcripts: [{ channel_id: 0, sentences: [{ speaker_id: 0, begin_time: 0, text: 'a' }] }] },
  });
  const out = await fetchTranscripts('https://example.com/result.json');
  expect(out).toHaveLength(1);
  expect(out[0].sentences[0].text).toBe('a');
});

test('fetchTranscripts: HTTP error surfaced', async () => {
  axios.get.mockRejectedValueOnce({
    response: { status: 404 },
    message: 'Not Found',
  });
  await expect(fetchTranscripts('https://example.com/missing')).rejects.toThrow(/fetch transcripts failed: HTTP 404/);
});

// =========== transcribeViaParaformer (full orchestration) ===========

test('transcribeViaParaformer: happy path constructs URL, submits (POST), polls (GET), fetches (GET), formats, OpenCC', async () => {
  // submit uses POST
  axios.post.mockResolvedValueOnce({ data: { output: { task_id: 'task-xyz' } } });
  // poll uses GET (per DashScope task-query doc)
  // fetch transcripts also uses GET
  axios.get
    .mockResolvedValueOnce({
      data: {
        output: {
          task_status: 'SUCCEEDED',
          results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.example.com/out.json' }],
        },
      },
    })
    .mockResolvedValueOnce({
      data: {
        transcripts: [{
          sentences: [
            { speaker_id: 0, begin_time: 0, text: '系咯系咯' },
            { speaker_id: 1, begin_time: 5000, text: '即系咁样' },
          ],
        }],
      },
    });

  const fileDoc = { sourcePath: 'aaaaaaaaaaaaaaaaaaaaaaaa/2026/05/9f8a3b2c-7e1d-4a5b-9c6d-1f2e3a4b5c6d.m4a' };
  const out = await transcribeViaParaformer(fileDoc);

  // Verify URL passed to submit
  const submitArgs = axios.post.mock.calls[0];
  expect(submitArgs[1].input.file_urls[0]).toBe(
    `https://test.example.com/public/audio/${fileDoc.sourcePath}`
  );

  // Verify output is HK traditional with A/B speakers + mmss
  expect(out).toContain('A 00:00');
  expect(out).toContain('B 00:05');
});

test('transcribeViaParaformer: no BACKEND_PUBLIC_BASE_URL → throws', async () => {
  const saved = process.env.BACKEND_PUBLIC_BASE_URL;
  delete process.env.BACKEND_PUBLIC_BASE_URL;
  try {
    await expect(transcribeViaParaformer({ sourcePath: 'a/b/c.mp3' })).rejects.toThrow(/BACKEND_PUBLIC_BASE_URL not set/);
  } finally {
    process.env.BACKEND_PUBLIC_BASE_URL = saved;
  }
});

test('transcribeViaParaformer: fileDoc without sourcePath → throws', async () => {
  await expect(transcribeViaParaformer({})).rejects.toThrow(/sourcePath required/);
});

test('transcribeViaParaformer: task FAILED bubbles up specific error', async () => {
  axios.post.mockResolvedValueOnce({ data: { output: { task_id: 'task-fail' } } });
  axios.get.mockResolvedValueOnce({
    data: {
      output: {
        task_status: 'FAILED',
        results: [{ message: 'InvalidFile.DownloadFailed' }],
      },
    },
  });
  const fileDoc = { sourcePath: 'aaa/2026/05/file.mp3' };
  await expect(transcribeViaParaformer(fileDoc)).rejects.toThrow(/Paraformer task FAILED.*DownloadFailed/);
});
