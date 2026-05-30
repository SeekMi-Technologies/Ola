const fs = require('fs').promises;
const mongoose = require('mongoose');

const { resolveUploadPath } = require('@/utils/uploadsPath');

const FileModel = mongoose.model('File');
const JobModel = mongoose.model('Job');

const getTranscript = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({
      success: false,
      result: null,
      message: '文件不存在或无权访问',
    });
  }

  const file = await FileModel.findOne({
    _id: id,
    createdBy: req.admin._id,
    removed: false,
  });
  if (!file) {
    return res.status(404).json({
      success: false,
      result: null,
      message: '文件不存在或无权访问',
    });
  }

  if (!file.transcriptionJobId) {
    return res.status(422).json({
      success: false,
      result: null,
      message: `文件 "${file.originalName}" 无关联转写任务`,
    });
  }

  // Defense-in-depth: createdBy filter closes a cross-admin read path where an
  // admin PATCHes File.transcriptionJobId to point at another admin's Job
  // (createCRUDController/update has no field whitelist). Same handler backs
  // the MCP file.get_transcript tool, so this also closes the agent-driven path.
  const job = await JobModel.findOne({
    _id: file.transcriptionJobId,
    createdBy: req.admin._id,
  });
  if (!job) {
    return res.status(500).json({
      success: false,
      result: null,
      message: `文件 "${file.originalName}" 关联的转写任务记录缺失`,
    });
  }
  if (job.status === 'pending' || job.status === 'running') {
    return res.status(409).json({
      success: false,
      result: null,
      message: `文件 "${file.originalName}" 转写中`,
    });
  }
  if (job.status === 'failed') {
    return res.status(422).json({
      success: false,
      result: null,
      message: `文件 "${file.originalName}" 转写失败: ${job.error || 'unknown'}`,
    });
  }

  const relativeSidecarPath = job.result?.sidecarPath;
  if (!relativeSidecarPath) {
    return res.status(500).json({
      success: false,
      result: null,
      message: `Sidecar transcript 路径缺失 (${file.originalName}): job.result.sidecarPath empty`,
    });
  }
  // #266: Job.result.sidecarPath stored as relative path; resolve to absolute
  // for fs.readFile. resolveUploadPath() throws if the stored value is still
  // absolute (un-migrated legacy doc) — that's intentional fail-fast, surfaces
  // as a clear 500 instead of silently ENOENT on a wrong host's path.
  let sidecarPath;
  try {
    sidecarPath = resolveUploadPath(relativeSidecarPath);
  } catch (err) {
    return res.status(500).json({
      success: false,
      result: null,
      message: `Sidecar transcript 路径无效 (${file.originalName}): ${err.message}`,
    });
  }
  let transcript;
  try {
    transcript = await fs.readFile(sidecarPath, 'utf-8');
  } catch (err) {
    return res.status(500).json({
      success: false,
      result: null,
      message: `Sidecar transcript 读取失败 (${file.originalName}): ${err.message}`,
    });
  }

  return res.status(200).json({
    success: true,
    result: {
      fileId: file._id,
      originalName: file.originalName,
      transcript,
      sizeBytes: Buffer.byteLength(transcript, 'utf-8'),
      durationMs: job.result?.durationMs,
      jobStatus: job.status,
    },
    message: 'transcript loaded',
  });
};

module.exports = getTranscript;
