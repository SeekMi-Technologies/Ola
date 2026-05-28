const { RAW_JOB_STATUS, COLLAPSED_JOB_STATUS } = require('@/constants/jobStatus');

const collapseJobStatus = (job) => {
  if (!job) return COLLAPSED_JOB_STATUS.READY;
  switch (job.status) {
    case RAW_JOB_STATUS.DONE:
      return COLLAPSED_JOB_STATUS.DONE;
    case RAW_JOB_STATUS.FAILED:
      return COLLAPSED_JOB_STATUS.FAILED;
    case RAW_JOB_STATUS.PENDING:
    case RAW_JOB_STATUS.RUNNING:
      return COLLAPSED_JOB_STATUS.PROCESSING;
    default:
      console.warn(
        `[collapseJobStatus] unknown raw status "${job.status}" — defaulting to processing. ` +
          'A new status was likely added to the Job enum without updating collapseJobStatus.'
      );
      return COLLAPSED_JOB_STATUS.PROCESSING;
  }
};

module.exports = { collapseJobStatus };
