/**
 * Shared upload+transcribe logic for audio files.
 *
 * Used by:
 *  - fileController/upload.js  (askola PaperClip UI upload, response format: { success, result, message })
 *  - mcp/server.js /internal/upload-audio (nanobot WhatsApp channel, response format: { ok, fileId, ... })
 *
 * Both endpoints differ in multer middleware, admin resolution, and response
 * envelope — but the core pipeline (dedup → disk write → File doc → Job doc →
 * worker kick) is identical, so it lives here once.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const runTranscription = require('@/jobs/transcriptionWorker');
const { resolveUploadPath } = require('@/utils/uploadsPath');

const FileModel = mongoose.model('File');
const JobModel = mongoose.model('Job');

function safeExt(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return '';
  return ext;
}

/**
 * Process an in-memory file upload: dedup, write to disk, create File doc,
 * and auto-trigger transcription for audio/video MIME types.
 *
 * @param {object} file — multer file object { buffer, originalname, mimetype, size }
 * @param {import('mongoose').Document} admin — the acting admin Mongoose document
 * @param {object} [options]
 * @param {boolean} [options.transcribeVideo=false] — also trigger transcription for video/* MIME types
 * @returns {Promise<{ fileDoc: object, transcriptionJobId: object|null, deduped: boolean }>}
 */
async function processUpload(file, admin, options = {}) {
  const { transcribeVideo = false } = options;
  const adminId = admin._id.toString();

  // SHA256 content hash + per-admin dedup
  const contentHash = crypto
    .createHash('sha256')
    .update(file.buffer)
    .digest('hex');

  const existing = await FileModel.findOne({
    createdBy: adminId,
    contentHash,
    removed: false,
  });
  if (existing) {
    return {
      fileDoc: existing,
      transcriptionJobId: existing.transcriptionJobId,
      deduped: true,
    };
  }

  // Write to disk
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ext = safeExt(file.originalname) || path.extname(file.originalname || '.ogg').toLowerCase().slice(0, 9) || '.ogg';
  const uniqueName = `${uuidv4()}${ext}`;
  const relativeSourcePath = path.join(adminId, yyyy, mm, uniqueName);
  const absoluteSourcePath = resolveUploadPath(relativeSourcePath);
  await fs.mkdir(path.dirname(absoluteSourcePath), { recursive: true });
  await fs.writeFile(absoluteSourcePath, file.buffer);

  // Create File doc
  const fileDoc = await FileModel.create({
    createdBy: adminId,
    originalName: file.originalname || `whatsapp_audio_${Date.now()}${ext}`,
    mimeType: file.mimetype || 'audio/ogg',
    sizeBytes: file.size,
    sourcePath: relativeSourcePath,
    contentHash,
  });

  // Auto-trigger transcription for audio (and optionally video)
  let transcriptionJobId = null;
  const mime = file.mimetype || 'audio/ogg';
  const shouldTranscribe = mime.startsWith('audio/') || (transcribeVideo && mime.startsWith('video/'));
  if (shouldTranscribe) {
    const job = await JobModel.create({
      createdBy: adminId,
      type: 'transcription',
      refModel: 'File',
      refId: fileDoc._id,
    });
    await FileModel.findByIdAndUpdate(fileDoc._id, { transcriptionJobId: job._id });
    transcriptionJobId = job._id;
    runTranscription(fileDoc, job).catch((err) => {
      console.error(`[processUpload] transcription worker failed for File ${fileDoc._id}:`, err.message);
    });
  }

  return { fileDoc, transcriptionJobId, deduped: false };
}

module.exports = processUpload;
module.exports.safeExt = safeExt;