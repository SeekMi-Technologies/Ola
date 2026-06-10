const multer = require('multer');

const { uploadSchema, MAX_FILE_SIZE } = require('./schemaValidate');
const processUpload = require('./processUpload');

const multerHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
}).single('file');

function parseMultipart(req, res) {
  return new Promise((resolve, reject) => {
    multerHandler(req, res, (err) => (err ? reject(err) : resolve()));
  });
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

  try {
    const result = await processUpload(req.file, req.admin, { transcribeVideo: false });

    return res.status(200).json({
      success: true,
      result: {
        _id: result.fileDoc._id,
        originalName: result.fileDoc.originalName,
        sizeBytes: result.fileDoc.sizeBytes,
        mimeType: result.fileDoc.mimeType,
        transcriptionJobId: result.transcriptionJobId,
        contentHash: result.fileDoc.contentHash,
        deduped: result.deduped,
      },
      message: result.deduped ? '该文件之前已上传, 复用已转写结果' : '上传成功',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      result: null,
      message: `文件处理失败: ${err.message}`,
    });
  }
};

module.exports = upload;