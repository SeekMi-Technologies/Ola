const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'Admin',
    required: true,
  },
  originalName: {
    type: String,
    required: true,
    trim: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  sizeBytes: {
    type: Number,
    required: true,
    min: 0,
  },
  // Path RELATIVE to UPLOADS_DIR (#266). Format: "<adminId>/YYYY/MM/<uuid>.ext".
  // Resolved to absolute via utils/uploadsPath.resolveUploadPath() at read time
  // so the doc stays host-portable across mac dev / Linux container / etc.
  // Job.result.sidecarPath follows the same invariant.
  sourcePath: {
    type: String,
    required: true,
  },
  contentHash: {
    type: String,
    index: true,
  },
  transcriptionJobId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Job',
  },
  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('File', fileSchema);
