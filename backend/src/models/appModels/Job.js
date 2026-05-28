const mongoose = require('mongoose');
const { RAW_JOB_STATUS_VALUES, RAW_JOB_STATUS } = require('@/constants/jobStatus');

const jobSchema = new mongoose.Schema({
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
  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
  type: {
    type: String,
    required: true,
    enum: ['transcription'],
  },
  refModel: {
    type: String,
    required: true,
    enum: ['File'],
  },
  refId: {
    type: mongoose.Schema.ObjectId,
    required: true,
  },
  status: {
    type: String,
    required: true,
    enum: RAW_JOB_STATUS_VALUES,
    default: RAW_JOB_STATUS.PENDING,
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  error: {
    type: String,
    default: '',
  },
  attempts: {
    type: Number,
    default: 0,
  },
});

module.exports = mongoose.model('Job', jobSchema);
