const mongoose = require('mongoose');
const runTranscription = require('./transcriptionWorker');

const ORPHAN_THRESHOLD_MS = 30 * 1000;
const MAX_ATTEMPTS = 3;

const resumeOrphanJobs = async () => {
  const Job = mongoose.model('Job');
  const File = mongoose.model('File');

  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
  const orphans = await Job.find({
    type: 'transcription',
    status: { $in: ['pending', 'running'] },
    updated: { $lt: cutoff },
    removed: false,
  });

  if (orphans.length === 0) {
    console.log('[resume-orphan-jobs] no orphans');
    return { resumed: 0, failed: 0 };
  }

  console.log(`[resume-orphan-jobs] found ${orphans.length} orphan transcription Job(s)`);

  let resumed = 0;
  let failed = 0;

  for (const job of orphans) {
    const file = await File.findById(job.refId);
    if (!file || file.removed) {
      await Job.findByIdAndUpdate(job._id, {
        status: 'failed',
        error: 'Source file missing on backend restart',
        updated: Date.now(),
      });
      console.log(`[resume-orphan-jobs] job=${job._id} → failed (file missing)`);
      failed += 1;
      continue;
    }

    if (job.attempts >= MAX_ATTEMPTS) {
      await Job.findByIdAndUpdate(job._id, {
        status: 'failed',
        error: `Exceeded ${MAX_ATTEMPTS} resume attempts (likely crash-loop)`,
        updated: Date.now(),
      });
      console.log(
        `[resume-orphan-jobs] job=${job._id} → failed (attempts=${job.attempts} ≥ ${MAX_ATTEMPTS})`
      );
      failed += 1;
      continue;
    }

    const prevStatus = job.status;
    await Job.findByIdAndUpdate(job._id, {
      status: 'pending',
      attempts: job.attempts + 1,
      updated: Date.now(),
    });
    console.log(
      `[resume-orphan-jobs] job=${job._id} file=${file._id} ${prevStatus}→pending attempts=${job.attempts + 1}`
    );

    runTranscription(file, job).catch((err) => {
      console.error(`[resume-orphan-jobs] worker failed for Job ${job._id}: ${err.message}`);
    });
    resumed += 1;
  }

  return { resumed, failed };
};

module.exports = resumeOrphanJobs;
