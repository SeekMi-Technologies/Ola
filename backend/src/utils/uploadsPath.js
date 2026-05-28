// Single source of truth for the audio uploads root + relative-path resolver.
// Used by fileController/upload.js (write), jobs/transcriptionWorker.js (read +
// sidecar write), and fileController/getTranscript.js (read).
//
// #266 architectural fix: File.sourcePath and Job.result.sidecarPath are now
// stored as paths *relative to UPLOADS_DIR* (e.g. "<adminId>/2026/05/<uuid>.ext")
// — never absolute. Previous design stored absolute paths in Mongo, which broke
// the moment Atlas was shared between hosts (mac dev vs Linux container).
//
// UPLOADS_DIR resolution:
//   - process.env.UPLOADS_DIR if set (prod containers can override)
//   - otherwise repo-relative `<backend>/uploads`, computed from this file's
//     location (`backend/src/utils/uploadsPath.js` → up 3 = `backend/`)
//
// docker-compose.yml mounts `crm-audio-uploads` named volume at
// /usr/src/app/uploads in both backend + mcp containers, which matches the
// default UPLOADS_DIR inside the container (no env override needed there).

const path = require('path');

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads');

function resolveUploadPath(relative) {
  if (!relative || typeof relative !== 'string') {
    throw new Error(`resolveUploadPath: relative path required, got ${relative}`);
  }
  if (path.isAbsolute(relative)) {
    throw new Error(
      `resolveUploadPath: expected relative path, got absolute "${relative}". ` +
        `File.sourcePath / Job.result.sidecarPath must be relative to UPLOADS_DIR.`
    );
  }
  return path.join(UPLOADS_DIR, relative);
}

module.exports = { UPLOADS_DIR, resolveUploadPath };
