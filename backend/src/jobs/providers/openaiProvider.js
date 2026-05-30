// OpenAI gpt-4o-transcribe-diarize STT provider (#257 — extracted from
// transcriptionWorker.js to live alongside paraformerProvider under
// providers/, dispatched by runTranscription based on admin.transcribeProvider).
//
// Push model: stream the local audio file as multipart to OpenAI. No public
// URL involvement (contrast with paraformer's pull model).

const fsSync = require('fs');
const FormData = require('form-data');
const axios = require('axios');

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = 'gpt-4o-transcribe-diarize';
const RESPONSE_FORMAT = 'diarized_json';

// Mirrors paraformerProvider's formatParaformerSidecar output shape so both
// providers produce sidecars LLM-readable with the same `A 00:00  text` form.
// OpenAI's diarize response already uses A/B/C speaker letters, so this is a
// straight render (no enum mapping like paraformer's speaker_id 0→A).
function formatDiarizedJson(payload) {
  const segments = payload && Array.isArray(payload.segments) ? payload.segments : null;
  if (!segments || segments.length === 0) {
    return (payload && payload.text) || '';
  }
  return segments
    .map((seg) => {
      const speaker = seg.speaker || '?';
      const start = Number(seg.start) || 0;
      const text = (seg.text || '').trim();
      const mm = String(Math.floor(start / 60)).padStart(2, '0');
      const ss = String(Math.floor(start % 60)).padStart(2, '0');
      return `${speaker} ${mm}:${ss}  ${text}`;
    })
    .join('\n');
}

async function callOpenAI(audioPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const formData = new FormData();
  formData.append('file', fsSync.createReadStream(audioPath));
  formData.append('model', MODEL);
  formData.append('response_format', RESPONSE_FORMAT);
  formData.append('chunking_strategy', 'auto');
  try {
    const response = await axios.post(OPENAI_URL, formData, {
      headers: { ...formData.getHeaders(), Authorization: `Bearer ${apiKey}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: parseInt(process.env.OPENAI_TRANSCRIPTION_TIMEOUT_MS, 10) || 600000,
    });
    return response.data;
  } catch (err) {
    // axios swallows the OpenAI error body — surface it so Job.error and the
    // structured log capture the real "why" instead of just the HTTP code.
    if (err && err.response) {
      const status = err.response.status;
      const body = err.response.data;
      const bodyJson =
        typeof body === 'object' ? JSON.stringify(body) : String(body).slice(0, 500);
      const detail =
        body && body.error && body.error.message
          ? body.error.message
          : bodyJson;
      const wrapped = new Error(`OpenAI HTTP ${status}: ${detail}`);
      wrapped.status = status;
      wrapped.openaiBody = body;
      throw wrapped;
    }
    throw err;
  }
}

async function transcribeViaOpenAI(audioPath) {
  const payload = await callOpenAI(audioPath);
  return formatDiarizedJson(payload);
}

module.exports = transcribeViaOpenAI;
module.exports.__test__ = { callOpenAI, formatDiarizedJson };
