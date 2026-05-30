// DashScope Paraformer-v2 STT provider (#257).
//
// Architecture: async REST — submit task → poll task_status every N seconds
// until SUCCEEDED/FAILED → fetch transcripts JSON from a separate signed URL.
// Paraformer is pull-only (no multipart push), so the audio file must already
// be reachable at a public HTTP/HTTPS URL constructed from BACKEND_PUBLIC_BASE_URL
// + the File's relative sourcePath (served by corePublicAudioRouter).
//
// Output: sidecar string mirrors the OpenAI formatDiarizedJson shape exactly
//   `A 00:00  <text>` per line, with speaker_id 0→A, 1→B, etc.
// Then OpenCC s2hk converts the simplified output to HK traditional + a
// targeted '繫'→'係' post-fix corrects an OpenCC quirk on Cantonese 系/係.

const axios = require('axios');
const OpenCC = require('opencc-js');

const SUBMIT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const TASK_URL_BASE = 'https://dashscope.aliyuncs.com/api/v1/tasks/';

// All tunables come from env with sensible defaults; PARAFORMER_POLL_INTERVAL_MS
// is the loop tick (heartbeat cadence too); PARAFORMER_MAX_WAIT_MS is the hard
// timeout for a single transcription (default 30 min — long-form 1h+ should
// finish in <10 min based on spike).
const POLL_INTERVAL_MS = parseInt(process.env.PARAFORMER_POLL_INTERVAL_MS, 10) || 5000;
const POLL_MAX_WAIT_MS = parseInt(process.env.PARAFORMER_MAX_WAIT_MS, 10) || 30 * 60 * 1000;
const DEFAULT_LANG_HINTS = (process.env.PARAFORMER_LANG_HINTS || 'yue,zh,en')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DEFAULT_SPEAKER_COUNT = parseInt(process.env.PARAFORMER_SPEAKER_COUNT, 10) || 2;

// OpenCC converter built once at module load — Trie precomputed, conversion
// itself is O(n) on the input and called once per job. cn→hk = simplified to
// HK traditional (preserves Cantonese particles, uses HK-specific glyphs).
const opencc_s2hk = OpenCC.Converter({ from: 'cn', to: 'hk' });

// --- helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function speakerIdToLetter(spkId) {
  // 0→A 1→B 2→C ... matches the existing OpenAI sidecar convention so the
  // downstream LLM prompt + ChatInput.jsx Transcript preview UI don't have
  // to special-case providers.
  if (typeof spkId !== 'number' || spkId < 0) return '?';
  if (spkId >= 26) return `S${spkId}`; // safety net for unlikely >26 speakers
  return String.fromCharCode('A'.charCodeAt(0) + spkId);
}

function formatMmSs(ms) {
  const seconds = Math.floor((ms || 0) / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// --- public API ---

async function submitTask(fileUrl, opts = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

  const langHints = opts.langHints || DEFAULT_LANG_HINTS;
  const speakerCount = opts.speakerCount || DEFAULT_SPEAKER_COUNT;

  const body = {
    model: 'paraformer-v2',
    input: { file_urls: [fileUrl] },
    parameters: {
      channel_id: [0],
      language_hints: langHints,
      diarization_enabled: true,
      speaker_count: speakerCount,
    },
  };
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  };

  let resp;
  try {
    resp = await axios.post(SUBMIT_URL, body, { headers, timeout: 60000 });
  } catch (err) {
    const status = err.response && err.response.status;
    const detail = err.response && err.response.data
      ? JSON.stringify(err.response.data).slice(0, 500)
      : err.message;
    throw new Error(`Paraformer submit failed: HTTP ${status || '?'} ${detail}`);
  }

  const taskId = resp.data && resp.data.output && resp.data.output.task_id;
  if (!taskId) {
    throw new Error(`Paraformer submit returned no task_id: ${JSON.stringify(resp.data).slice(0, 500)}`);
  }
  console.log(`[paraformer] submit ok task_id=${taskId} file_url=${fileUrl}`);
  return taskId;
}

// Network errors that are usually transient — we retry the poll iteration
// instead of aborting the whole transcription. HTTP 4xx still aborts (those
// indicate API contract violations: bad task_id, bad auth, etc.). HTTP 5xx
// is treated as transient since DashScope occasionally has brief blips.
const TRANSIENT_ERR_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED',
]);
const MAX_CONSECUTIVE_TRANSIENT = 5; // safety: don't spin forever if DashScope is fully down

function isTransientError(err) {
  if (!err) return false;
  if (err.code && TRANSIENT_ERR_CODES.has(err.code)) return true;
  if (err.response && err.response.status >= 500 && err.response.status < 600) return true;
  return false;
}

async function pollTask(taskId, opts = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

  const onPollHeartbeat = opts.onPollHeartbeat;
  const url = TASK_URL_BASE + taskId;
  const headers = { Authorization: `Bearer ${apiKey}` };
  const t0 = Date.now();
  const deadline = t0 + POLL_MAX_WAIT_MS;
  let lastStatus = null;
  let consecutiveTransient = 0;

  while (Date.now() < deadline) {
    let resp;
    try {
      // GET per DashScope task-query API doc:
      // https://www.alibabacloud.com/help/en/model-studio/paraformer-recorded-speech-recognition-restful-api
      resp = await axios.get(url, { headers, timeout: 30000 });
      consecutiveTransient = 0;
    } catch (err) {
      if (isTransientError(err) && consecutiveTransient < MAX_CONSECUTIVE_TRANSIENT) {
        consecutiveTransient += 1;
        const elapsedSec = Math.floor((Date.now() - t0) / 1000);
        console.warn(
          `[paraformer] poll [${String(elapsedSec).padStart(4)}s] transient error ` +
          `${err.code || err.response?.status} (retry ${consecutiveTransient}/${MAX_CONSECUTIVE_TRANSIENT})`
        );
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const status = err.response && err.response.status;
      const detail = err.response && err.response.data
        ? JSON.stringify(err.response.data).slice(0, 300)
        : err.message;
      throw new Error(`Paraformer poll failed: HTTP ${status || '?'} ${detail}`);
    }

    const status = resp.data && resp.data.output && resp.data.output.task_status;
    const elapsedSec = Math.floor((Date.now() - t0) / 1000);

    if (status !== lastStatus) {
      console.log(`[paraformer] poll [${String(elapsedSec).padStart(4)}s] ${status}`);
      lastStatus = status;
    }

    // Heartbeat: tell the orphan-job reaper "I'm still alive." Skip silently
    // if caller didn't provide one (e.g. one-off scripts).
    if (typeof onPollHeartbeat === 'function') {
      try { await onPollHeartbeat(); } catch (e) { /* heartbeat errors non-fatal */ }
    }

    if (status === 'SUCCEEDED' || status === 'FAILED') {
      return resp.data;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Paraformer poll timeout after ${Math.floor(POLL_MAX_WAIT_MS / 1000)}s (task_id=${taskId})`);
}

async function fetchTranscripts(transcriptionUrl) {
  let resp;
  try {
    resp = await axios.get(transcriptionUrl, { timeout: 120000 });
  } catch (err) {
    const status = err.response && err.response.status;
    throw new Error(`Paraformer fetch transcripts failed: HTTP ${status || '?'} ${err.message}`);
  }
  return (resp.data && resp.data.transcripts) || [];
}

function formatParaformerSidecar(transcripts) {
  // Produces lines exactly mirroring OpenAI formatDiarizedJson:
  //   "A 00:14  text..."
  const lines = [];
  for (const tr of transcripts || []) {
    for (const sent of (tr && tr.sentences) || []) {
      const speaker = speakerIdToLetter(sent.speaker_id);
      const mmss = formatMmSs(sent.begin_time);
      const text = (sent.text || '').trim();
      lines.push(`${speaker} ${mmss}  ${text}`);
    }
  }
  return lines.join('\n');
}

function applyOpenCC(text) {
  // OpenCC s2hk converts simplified → HK traditional. Then we fix one quirk:
  // OpenCC sometimes maps Cantonese 系 (= 係, "is/yes") to 繫 (= "to tie")
  // because cn→hk lacks the context to distinguish these in casual speech.
  // Cantonese conversational 系 should always be 係.
  const converted = opencc_s2hk(text);
  return converted.replace(/繫/g, '係');
}

async function transcribeViaParaformer(fileDoc, opts = {}) {
  const baseUrl = process.env.BACKEND_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error('BACKEND_PUBLIC_BASE_URL not set — paraformer cannot construct public audio URL');
  }
  if (!fileDoc || !fileDoc.sourcePath) {
    throw new Error('transcribeViaParaformer: fileDoc with sourcePath required');
  }

  // URL constructed from the relative sourcePath. corePublicAudioRouter
  // serves UPLOADS_DIR via /public/audio. Note: encodeURI on each segment is
  // unnecessary because upload.js only writes lowercase hex / digits / uuid
  // pattern — no characters that need URL-encoding.
  const fileUrl = `${baseUrl.replace(/\/+$/, '')}/public/audio/${fileDoc.sourcePath}`;

  const taskId = await submitTask(fileUrl, opts);
  const taskData = await pollTask(taskId, opts);

  const taskStatus = taskData.output && taskData.output.task_status;
  if (taskStatus !== 'SUCCEEDED') {
    const results = (taskData.output && taskData.output.results) || [];
    const message = results[0] && (results[0].message || results[0].code) || 'unknown';
    throw new Error(`Paraformer task FAILED: ${message}`);
  }

  const results = (taskData.output && taskData.output.results) || [];
  if (!results.length) throw new Error('Paraformer task SUCCEEDED but no results');
  const subtaskStatus = results[0].subtask_status;
  if (subtaskStatus !== 'SUCCEEDED') {
    const message = results[0].message || results[0].code || subtaskStatus;
    throw new Error(`Paraformer subtask FAILED: ${message}`);
  }

  const transcriptionUrl = results[0].transcription_url;
  if (!transcriptionUrl) throw new Error('Paraformer SUCCEEDED but no transcription_url');

  const transcripts = await fetchTranscripts(transcriptionUrl);
  const sentenceCount = transcripts.reduce((n, t) => n + ((t.sentences || []).length), 0);
  const speakerSet = new Set();
  for (const t of transcripts) {
    for (const s of (t.sentences || [])) {
      if (typeof s.speaker_id === 'number') speakerSet.add(s.speaker_id);
    }
  }
  console.log(`[paraformer] fetched ${sentenceCount} sentences ${speakerSet.size} speakers`);

  const rawSidecar = formatParaformerSidecar(transcripts);
  if (!rawSidecar || rawSidecar.trim() === '') {
    throw new Error('Paraformer returned empty transcript');
  }
  const converted = applyOpenCC(rawSidecar);
  console.log(`[paraformer] OpenCC s2hk + 繫→係 applied (${rawSidecar.length} → ${converted.length} chars)`);
  return converted;
}

module.exports = transcribeViaParaformer;
module.exports.__test__ = {
  submitTask,
  pollTask,
  fetchTranscripts,
  formatParaformerSidecar,
  applyOpenCC,
  speakerIdToLetter,
  formatMmSs,
};
