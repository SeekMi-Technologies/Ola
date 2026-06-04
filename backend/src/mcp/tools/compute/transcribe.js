// file.transcribe MCP tool (#307 Item 3)
//
// Manually trigger transcription for an uploaded audio file.
// Use cases:
//   - Re-transcribe a previously failed file
//   - Trigger transcription for a file that wasn't auto-transcribed on upload
//
// The tool is idempotent: if a completed transcript already exists, it returns
// the existing result without re-running. If the job is still processing, it
// returns 409 so the agent can poll via file.transcription_status.

const mongoose = require('mongoose');
const { z } = require('zod');
const fileController = require('@/controllers/appControllers/fileController');
const { runController } = require('../../adapters/controllerAdapter');
const { getCurrentActingAdmin } = require('../../context');
const { collapseJobStatus } = require('@/utils/collapseJobStatus');
const runTranscription = require('@/jobs/transcriptionWorker');

// Supported MIME prefixes for transcription input.
// audio/* covers all audio formats; video entries cover common containers
// that may contain audio tracks (voice recordings, screen recordings, etc.).
const AUDIO_MIME_PREFIXES = [
  'audio/',
  'video/mp4',
  'video/3gpp',
  'video/webm',
  'video/quicktime',   // .mov
  'video/x-matroska',  // .mkv
  'video/mpeg',        // .mpeg
];

function isAudioLike(mimeType) {
  if (!mimeType) return false;
  return AUDIO_MIME_PREFIXES.some((p) => mimeType.startsWith(p));
}

const file_transcribe = {
  name: 'file.transcribe',
  description:
    'Trigger transcription for an uploaded audio/video file. If already transcribed (status=done), ' +
    'returns the existing transcript. If currently processing, returns 409. ' +
    'Use after file.upload or to retry a failed transcription. ' +
    'The agent should then poll file.transcription_status until done, then call file.get_transcript.',
  inputSchema: {
    fileId: z.string().min(1).describe('File._id of the audio/video file to transcribe'),
  },
  handler: async ({ fileId }) => {
    // 0. Business-scope tool: reject if no acting admin (X-Acting-As required)
    const actingAdmin = getCurrentActingAdmin();
    if (!actingAdmin) {
      return {
        ok: false,
        code: 'PERMISSION',
        message: 'X-Acting-As header required for file.transcribe',
      };
    }

    // 1. Load file doc (scoped to admin via controllerAdapter)
    const fileRes = await runController(fileController.read, {
      params: { id: fileId },
    });
    if (!fileRes.ok) return fileRes;
    const fileDoc = fileRes.data;

    // 2. Check mime — reject clearly non-audio files
    if (!isAudioLike(fileDoc.mimeType)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_TYPE',
        message: `File "${fileDoc.originalName}" (mime: ${fileDoc.mimeType}) is not an audio/video file. Transcription is only supported for audio files.`,
      };
    }

    const FileModel = mongoose.model('File');
    const JobModel = mongoose.model('Job');

    // 3. If a transcription job already exists, check its status
    if (fileDoc.transcriptionJobId) {
      const existingJob = await JobModel.findById(fileDoc.transcriptionJobId).lean();
      if (existingJob) {
        const collapsed = collapseJobStatus(existingJob);
        if (collapsed === 'done') {
          // Already transcribed — read the sidecar and return it
          const transcriptRes = await runController(fileController.getTranscript, {
            params: { id: fileId },
          });
          if (transcriptRes.ok) {
            return {
              ok: true,
              data: {
                status: 'done',
                message: 'Transcript already exists. Returning cached result.',
                jobId: String(existingJob._id),
                transcript: transcriptRes.data,
              },
            };
          }
          // Sidecar read failed — fall through to re-transcribe
        } else if (collapsed === 'processing') {
          return {
            ok: false,
            code: 'PROCESSING',
            message: `Transcription is already in progress (jobId=${existingJob._id}). Poll file.transcription_status until done.`,
          };
        }
        // 'failed' (or job doc not found in DB) → re-transcribe below
      }
    }

    // 4. Create a new transcription job
    // NOTE: JobModel.create and FileModel.findByIdAndUpdate are not wrapped in
    // a MongoDB transaction. If the process crashes between them, an orphaned
    // Job will exist with no File pointing to it. This is benign: the next
    // file.transcribe call will create a new Job (re-transcription is idempotent),
    // and orphaned Jobs are harmless until garbage-collected.
    let job;
    try {
      job = await JobModel.create({
        createdBy: actingAdmin._id,
        type: 'transcription',
        refModel: 'File',
        refId: fileDoc._id,
      });
      await FileModel.findByIdAndUpdate(fileDoc._id, { transcriptionJobId: job._id });
    } catch (err) {
      return {
        ok: false,
        code: 'JOB_CREATE_FAILED',
        message: `Failed to create transcription job: ${err.message}`,
      };
    }

    // 5. Kick off the worker (async — does not block the MCP response)
    runTranscription(fileDoc, job).catch(async (err) => {
      console.error(`[file.transcribe] worker failed for File ${fileDoc._id}:`, err.message);
      // Mark the job as failed so future calls can re-transcribe instead of
      // being stuck in an eternal "processing" state.
      try {
        await JobModel.findByIdAndUpdate(job._id, { status: 'failed', error: err.message });
      } catch (_) {
        console.error('[file.transcribe] failed to mark job as failed:', _.message);
      }
    });

    return {
      ok: true,
      data: {
        status: 'processing',
        message: 'Transcription job created. Poll file.transcription_status until done, then use file.get_transcript.',
        jobId: String(job._id),
      },
    };
  },
};

module.exports = file_transcribe;