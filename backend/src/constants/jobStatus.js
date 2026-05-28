const RAW_JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
};

const COLLAPSED_JOB_STATUS = {
  READY: 'ready',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
};

const RAW_JOB_STATUS_VALUES = Object.values(RAW_JOB_STATUS);
const COLLAPSED_JOB_STATUS_VALUES = Object.values(COLLAPSED_JOB_STATUS);

module.exports = {
  RAW_JOB_STATUS,
  COLLAPSED_JOB_STATUS,
  RAW_JOB_STATUS_VALUES,
  COLLAPSED_JOB_STATUS_VALUES,
};
