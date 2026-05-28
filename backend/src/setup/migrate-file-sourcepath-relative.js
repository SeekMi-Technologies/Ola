// One-shot migration for #266: convert absolute File.sourcePath and
// Job.result.sidecarPath values to paths relative to UPLOADS_DIR.
//
// Usage (from backend/ working directory):
//   node src/setup/migrate-file-sourcepath-relative.js              # dry-run (default, safe)
//   node src/setup/migrate-file-sourcepath-relative.js --commit     # actually write
//
// Idempotent: already-relative docs are skipped. Unknown absolute prefixes
// (paths neither under a known mac dev tree nor `/usr/src/app/uploads/`)
// trigger WARN logs and are left untouched — human decision required.
//
// Prefixes recognized + stripped:
//   /Users/<user>/.+/backend/uploads/   → mac dev (zyd / ziyue)
//   /Users/<user>/.+/uploads/           → mac dev fallback
//   /usr/src/app/uploads/               → Linux container

require('module-alias/register');
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

const MODE = process.argv.includes('--commit') ? 'commit' : 'dry-run';

const PREFIX_PATTERNS = [
  /^\/Users\/[^/]+\/.*?\/backend\/uploads\//,
  /^\/Users\/[^/]+\/.*?\/uploads\//,
  /^\/usr\/src\/app\/uploads\//,
];

function toRelative(absPath) {
  if (!absPath || typeof absPath !== 'string') return { kind: 'invalid', value: absPath };
  if (!path.isAbsolute(absPath)) return { kind: 'already-relative', value: absPath };
  for (const pattern of PREFIX_PATTERNS) {
    if (pattern.test(absPath)) {
      return { kind: 'converted', value: absPath.replace(pattern, '') };
    }
  }
  return { kind: 'unknown-prefix', value: absPath };
}

async function main() {
  if (!process.env.DATABASE) {
    console.error('CRITICAL: DATABASE env var not set. Run from backend/ with .env present.');
    process.exit(1);
  }
  console.log(`[migrate] mode=${MODE} DATABASE=${process.env.DATABASE.replace(/:[^@]+@/, ':***@')}`);

  await mongoose.connect(process.env.DATABASE);

  // Autoload all models so File / Job are registered before we use them.
  const BACKEND_ROOT = path.resolve(__dirname, '..');
  globSync('models/**/*.js', { cwd: BACKEND_ROOT }).forEach((f) =>
    require(path.join(BACKEND_ROOT, f))
  );

  const FileModel = mongoose.model('File');
  const JobModel = mongoose.model('Job');

  const stats = {
    file: { total: 0, converted: 0, alreadyRelative: 0, unknownPrefix: 0, invalid: 0 },
    job: { total: 0, converted: 0, alreadyRelative: 0, unknownPrefix: 0, invalid: 0 },
  };

  // --- File.sourcePath ---
  const files = await FileModel.find({}).select('_id sourcePath').lean();
  stats.file.total = files.length;
  for (const f of files) {
    const result = toRelative(f.sourcePath);
    if (result.kind === 'already-relative') {
      stats.file.alreadyRelative += 1;
      continue;
    }
    if (result.kind === 'invalid') {
      stats.file.invalid += 1;
      console.warn(`[migrate] File ${f._id}: invalid sourcePath value:`, f.sourcePath);
      continue;
    }
    if (result.kind === 'unknown-prefix') {
      stats.file.unknownPrefix += 1;
      console.warn(`[migrate] File ${f._id}: unknown absolute prefix, SKIPPED: ${f.sourcePath}`);
      continue;
    }
    // converted
    stats.file.converted += 1;
    console.log(`[migrate] File ${f._id}: ${f.sourcePath} -> ${result.value}`);
    if (MODE === 'commit') {
      await FileModel.updateOne({ _id: f._id }, { $set: { sourcePath: result.value } });
    }
  }

  // --- Job.result.sidecarPath (only transcription jobs have it) ---
  const jobs = await JobModel.find({
    type: 'transcription',
    'result.sidecarPath': { $exists: true, $ne: null },
  })
    .select('_id result.sidecarPath')
    .lean();
  stats.job.total = jobs.length;
  for (const j of jobs) {
    const current = j.result?.sidecarPath;
    const result = toRelative(current);
    if (result.kind === 'already-relative') {
      stats.job.alreadyRelative += 1;
      continue;
    }
    if (result.kind === 'invalid') {
      stats.job.invalid += 1;
      console.warn(`[migrate] Job ${j._id}: invalid sidecarPath value:`, current);
      continue;
    }
    if (result.kind === 'unknown-prefix') {
      stats.job.unknownPrefix += 1;
      console.warn(`[migrate] Job ${j._id}: unknown absolute prefix, SKIPPED: ${current}`);
      continue;
    }
    stats.job.converted += 1;
    console.log(`[migrate] Job ${j._id}: ${current} -> ${result.value}`);
    if (MODE === 'commit') {
      await JobModel.updateOne(
        { _id: j._id },
        { $set: { 'result.sidecarPath': result.value } }
      );
    }
  }

  console.log('');
  console.log(`[migrate] === summary (mode=${MODE}) ===`);
  console.log(`[migrate] File:  total=${stats.file.total} converted=${stats.file.converted} alreadyRelative=${stats.file.alreadyRelative} unknownPrefix=${stats.file.unknownPrefix} invalid=${stats.file.invalid}`);
  console.log(`[migrate] Job:   total=${stats.job.total} converted=${stats.job.converted} alreadyRelative=${stats.job.alreadyRelative} unknownPrefix=${stats.job.unknownPrefix} invalid=${stats.job.invalid}`);
  if (MODE === 'dry-run') {
    console.log('[migrate] DRY-RUN — no writes performed. Re-run with --commit to apply.');
  } else {
    console.log('[migrate] COMMIT complete.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

// Only run if invoked directly via `node src/setup/migrate-...js`; export
// pure helpers so jest can exercise them without touching DB.
if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { toRelative, PREFIX_PATTERNS };
