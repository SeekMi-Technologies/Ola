const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const adminSchema = new Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true, // MVP: 注册即启用
  },

  email: {
    type: String,
    lowercase: true,
    trim: true,
    required: true,
  },
  name: { type: String, required: true },
  surname: { type: String },
  photo: {
    type: String,
    trim: true,
  },
  phone: { type: String },     // 个人电话（上车时收集）
  jobTitle: { type: String },  // 职位（上车时收集）

  role: {
    type: String,
    default: 'user',
    enum: ['owner', 'admin', 'user'],
  },

  // 上车状态（注册时 false，完成上车表单后 true）
  onboarded: { type: Boolean, default: false },

  // Per-salesperson Ask Ola language preference. Drives the SESSION_LANG
  // directive prepended to NanoBot user content (see olaController/chat.js).
  // Existing docs without this field read undefined; consumers fall back to
  // 'zh' via `|| 'zh'`. No migration needed.
  language: { type: String, enum: ['zh', 'en'], default: 'zh' },

  // Per-admin STT engine selection (#257). null = fall back to env
  // TRANSCRIPTION_PROVIDER or hardcoded 'openai'. paraformer = DashScope
  // Paraformer-v2 (HK Cantonese first-class + 9× cheaper). Existing docs
  // without this field read null and route to openai unchanged.
  transcribeProvider: {
    type: String,
    enum: ['openai', 'paraformer'],
    // null = fall back to TRANSCRIPTION_PROVIDER env, then to 'openai'.
    // Mongoose bypasses enum validation for null/undefined, which is the
    // sentinel we rely on — do NOT add null to the enum list.
    default: null,
  },

  // Updated by trackActivity middleware (≥60s throttle); read by Ola_devboard.
  lastActivity: { type: Date, default: null, index: true },

  created: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Admin', adminSchema);
