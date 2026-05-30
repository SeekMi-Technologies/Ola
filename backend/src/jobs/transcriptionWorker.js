// Transcription dispatcher (#257). Resolves STT provider per upload then
// hands off to the matching provider module. Per-admin selection beats
// process-wide env which beats hardcoded 'openai' fallback.
//
//   admin.transcribeProvider > process.env.TRANSCRIPTION_PROVIDER > 'openai'
//
// Shared helpers (needsCompression / compressToMp3) live here because they
// apply to OpenAI's push-multipart path (size budget); paraformer's pull
// path skips compression — DashScope's 2 GB / 2 h limits leave plenty of
// headroom for the original file.

const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const mongoose = require('mongoose');

const { resolveUploadPath } = require('@/utils/uploadsPath');
const transcribeViaOpenAI = require('./providers/openaiProvider');
const transcribeViaParaformer = require('./providers/paraformerProvider');

const execFileAsync = promisify(execFile);

const COMPRESSIBLE_EXTS = new Set(['.wav', '.flac', '.aiff', '.aac', '.m4a']);
const SIZE_THRESHOLD_BYTES = 20 * 1024 * 1024;
const VALID_PROVIDERS = new Set(['openai', 'paraformer']);

function needsCompression(file) {
  const ext = path.extname(file.sourcePath).toLowerCase();
  return file.sizeBytes > SIZE_THRESHOLD_BYTES || COMPRESSIBLE_EXTS.has(ext);
}

async function compressToMp3(srcPath) {
  const dstPath = srcPath + '.compressed.mp3';
  await execFileAsync('ffmpeg', [
    '-i', srcPath, '-ac', '1', '-ar', '16000', '-b:a', '64k', '-y', dstPath,
  ]);
  return dstPath;
}

async function resolveProvider(fileDoc) {
  let adminProvider = null;
  try {
    const Admin = mongoose.model('Admin');
    const admin = await Admin.findById(fileDoc.createdBy).select('transcribeProvider').lean();
    if (admin && admin.transcribeProvider) adminProvider = admin.transcribeProvider;
  } catch (e) {
    // Admin lookup failure shouldn't block transcription — fall through to env/default.
    console.warn(`[transcribe.dispatch] admin lookup failed: ${e.message}`);
  }
  const provider = adminProvider || process.env.TRANSCRIPTION_PROVIDER || 'openai';
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(`Unknown transcription provider: ${provider}`);
  }
  return provider;
}

async function runTranscription(fileDoc, jobDoc) {
  const Job = mongoose.model('Job');
  const startTs = Date.now();
  let compressedPath = null;

  const provider = await resolveProvider(fileDoc);
  console.log(
    `[transcribe.worker] job=${jobDoc._id} file=${fileDoc._id} name=${fileDoc.originalName} ` +
    `size=${fileDoc.sizeBytes} mime=${fileDoc.mimeType} provider=${provider} status=pending→running`
  );

  try {
    await Job.findByIdAndUpdate(jobDoc._id, { status: 'running', updated: Date.now() });

    let transcript;
    if (provider === 'openai') {
      // Push model — compress if needed, then stream multipart.
      const absoluteSourcePath = resolveUploadPath(fileDoc.sourcePath);
      const audioPath = needsCompression(fileDoc)
        ? (compressedPath = await compressToMp3(absoluteSourcePath))
        : absoluteSourcePath;
      transcript = await transcribeViaOpenAI(audioPath);
    } else if (provider === 'paraformer') {
      // Pull model — DashScope fetches from BACKEND_PUBLIC_BASE_URL via
      // corePublicAudioRouter; no compression, no local read by us.
      transcript = await transcribeViaParaformer(fileDoc, {
        onPollHeartbeat: () =>
          Job.findByIdAndUpdate(jobDoc._id, { updated: Date.now() }),
      });
    }

    if (!transcript || transcript.trim() === '') {
      throw new Error(`${provider} returned empty transcript`);
    }

    // Sidecar lives next to source on disk; path stored RELATIVE in Job.result
    // (same #266 invariant as File.sourcePath).
    const relativeSidecarPath = fileDoc.sourcePath + '.txt';
    const absoluteSidecarPath = resolveUploadPath(relativeSidecarPath);
    await fs.writeFile(absoluteSidecarPath, transcript, 'utf-8');

    const durationMs = Date.now() - startTs;
    const transcriptBytes = Buffer.byteLength(transcript, 'utf-8');
    await Job.findByIdAndUpdate(jobDoc._id, {
      status: 'done',
      result: {
        sidecarPath: relativeSidecarPath,
        sizeBytes: transcriptBytes,
        durationMs,
        provider,
      },
      updated: Date.now(),
    });
    console.log(
      `[transcribe.worker] job=${jobDoc._id} provider=${provider} status=running→done ` +
      `duration_ms=${durationMs} sidecar_bytes=${transcriptBytes}`
    );
  } catch (err) {
    await Job.findByIdAndUpdate(jobDoc._id, {
      status: 'failed',
      error: err.message || String(err),
      updated: Date.now(),
    });
    console.error(
      `[transcribe.worker] job=${jobDoc._id} provider=${provider} status=running→failed ` +
      `error=${err.message || String(err)}`
    );
    throw err;
  } finally {
    if (compressedPath) {
      try {
        await fs.unlink(compressedPath);
      } catch (cleanupErr) {
        console.warn(`[transcribe] cleanup of ${compressedPath} failed:`, cleanupErr.message);
      }
    }
  }
}

module.exports = runTranscription;
module.exports.__test__ = { needsCompression, compressToMp3, resolveProvider };
