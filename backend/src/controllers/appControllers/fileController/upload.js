const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const mongoose = require('mongoose');

const { uploadSchema, MAX_FILE_SIZE } = require('./schemaValidate');
const runTranscription = require('@/jobs/transcriptionWorker');
const { UPLOADS_DIR, resolveUploadPath } = require('@/utils/uploadsPath');

const FileModel = mongoose.model('File');
const JobModel = mongoose.model('Job');

const multerHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
}).single('file');

function parseMultipart(req, res) {
  return new Promise((resolve, reject) => {
    multerHandler(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

function safeExt(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return '';
  return ext;
}

const upload = async (req, res) => {
  try {
    await parseMultipart(req, res);
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        result: null,
        message: `文件超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 上限`,
      });
    }
    return res.status(400).json({
      success: false,
      result: null,
      message: `上传解析失败: ${err && err.message ? err.message : 'unknown'}`,
    });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      result: null,
      message: '缺少 file 字段 (multipart/form-data，单文件 field name 必须为 file)',
    });
  }

  const { error } = uploadSchema.validate({
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
  if (error) {
    const status = error.details.some((d) => d.path.includes('mimetype')) ? 415 : 400;
    return res.status(status).json({
      success: false,
      result: null,
      message: error.details.map((d) => d.message).join('; '),
    });
  }

  // SHA256 hash + per-admin dedup. Buffer is already in memory (multer
  // memoryStorage), so hashing is in-process and fast (~200ms for 50MB).
  // Hit → reuse existing File + transcriptionJobId; skip disk write + worker.
  const contentHash = crypto
    .createHash('sha256')
    .update(req.file.buffer)
    .digest('hex');

  const existing = await FileModel.findOne({
    createdBy: req.admin._id,
    contentHash,
    removed: false,
  });
  if (existing) {
    return res.status(200).json({
      success: true,
      result: {
        _id: existing._id,
        originalName: existing.originalName,
        sizeBytes: existing.sizeBytes,
        mimeType: existing.mimeType,
        transcriptionJobId: existing.transcriptionJobId,
        contentHash,
        deduped: true,
      },
      message: '该文件之前已上传, 复用已转写结果',
    });
  }

  const adminId = req.admin._id.toString();
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ext = safeExt(req.file.originalname);
  const uniqueName = `${uuidv4()}${ext}`;
  // #266: sourcePath stored RELATIVE to UPLOADS_DIR; absolute path resolved
  // at read time via resolveUploadPath() so the doc stays host-portable.
  const relativeSourcePath = path.join(adminId, yyyy, mm, uniqueName);
  const absoluteSourcePath = resolveUploadPath(relativeSourcePath);
  const targetDir = path.dirname(absoluteSourcePath);

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(absoluteSourcePath, req.file.buffer);
  } catch (err) {
    return res.status(500).json({
      success: false,
      result: null,
      message: `文件落盘失败: ${err.message}`,
    });
  }

  const fileDoc = await FileModel.create({
    createdBy: req.admin._id,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    sourcePath: relativeSourcePath,
    contentHash,
  });

  let transcriptionJobId = null;
  if (req.file.mimetype.startsWith('audio/')) {
    let job;
    try {
      job = await JobModel.create({
        createdBy: req.admin._id,
        type: 'transcription',
        refModel: 'File',
        refId: fileDoc._id,
      });
      await FileModel.findByIdAndUpdate(fileDoc._id, { transcriptionJobId: job._id });
      transcriptionJobId = job._id;
    } catch (err) {
      return res.status(500).json({
        success: false,
        result: null,
        message: `转写任务创建失败: ${err.message}`,
      });
    }
    runTranscription(fileDoc, job).catch((err) => {
      console.error(`[transcribe] worker failed for File ${fileDoc._id}:`, err.message);
    });
  }

  return res.status(200).json({
    success: true,
    result: {
      _id: fileDoc._id,
      originalName: fileDoc.originalName,
      sizeBytes: fileDoc.sizeBytes,
      mimeType: fileDoc.mimeType,
      transcriptionJobId,
      contentHash,
      deduped: false,
    },
    message: '上传成功',
  });
};

module.exports = upload;
module.exports.UPLOADS_DIR = UPLOADS_DIR;
