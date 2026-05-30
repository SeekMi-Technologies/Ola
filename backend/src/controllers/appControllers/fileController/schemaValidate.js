const Joi = require('joi');

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const uploadSchema = Joi.object({
  originalname: Joi.string().min(1).max(512).required(),
  mimetype: Joi.string()
    .pattern(/^audio\/[a-zA-Z0-9.+-]+$/)
    .required()
    .messages({
      'string.pattern.base': '暂只支持音频文件 (audio/*)',
    }),
  size: Joi.number().integer().min(1).max(MAX_FILE_SIZE).required(),
});

module.exports = { uploadSchema, MAX_FILE_SIZE };
