// Public-no-auth audio fetch endpoint for STT providers that pull (Paraformer).
// Mounted at /public/audio in app.js, so the externally visible URL is
//   GET /public/audio/<adminId>/<yyyy>/<mm>/<uuid>.<ext>
// which mirrors File.sourcePath exactly (per #266 relative path scheme).
//
// Security model: <uuid> in the path is a UUID v4 generated at upload time
// (see fileController/upload.js — 122 bits of entropy). That UUID is the
// unguessable secret. No token, no expiry, no DB lookup. Same posture as the
// spike Box1 nginx random-slug serve (#257 spike notes).
//
// Strict regex on each segment + path traversal defense via startsWith
// guarantees no escape out of UPLOADS_DIR even with a crafted URL.

const express = require('express');
const path = require('path');

const { UPLOADS_DIR, resolveUploadPath } = require('@/utils/uploadsPath');

const router = express.Router();

// Format constraints come from upload.js:106-109 — anything that deviates
// is rejected at 400 before touching the filesystem.
const ADMIN_ID_RE = /^[a-f0-9]{24}$/;            // Mongo ObjectId hex
const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^\d{2}$/;
const FILENAME_RE = /^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/; // uuid v4 + ext (upload.js always writes lowercase)

router.route('/:adminId/:year/:month/:filename').get(function (req, res) {
  try {
    const { adminId, year, month, filename } = req.params;

    if (!ADMIN_ID_RE.test(adminId)) {
      return res.status(400).json({ success: false, message: 'invalid adminId' });
    }
    if (!YEAR_RE.test(year)) {
      return res.status(400).json({ success: false, message: 'invalid year' });
    }
    if (!MONTH_RE.test(month)) {
      return res.status(400).json({ success: false, message: 'invalid month' });
    }
    if (!FILENAME_RE.test(filename)) {
      return res.status(400).json({ success: false, message: 'invalid filename' });
    }

    const relativePath = path.join(adminId, year, month, filename);
    const absolutePath = resolveUploadPath(relativePath);

    // Belt-and-suspenders: even if regex misses something, the resolved
    // absolute path MUST stay inside UPLOADS_DIR.
    if (!absolutePath.startsWith(UPLOADS_DIR + path.sep)) {
      return res.status(403).json({ success: false, message: 'forbidden' });
    }

    return res.sendFile(absolutePath, function (err) {
      // sendFile fires the callback twice-shaped: pre-send miss (headers not
      // yet sent → 404 ok) OR mid-stream client drop (headers + partial body
      // already on the wire → res.status would throw ERR_HTTP_HEADERS_SENT).
      // headersSent guard distinguishes the two.
      if (err && !res.headersSent) {
        return res.status(404).json({ success: false, message: 'file not found' });
      }
    });
  } catch (error) {
    return res.status(503).json({ success: false, message: error.message });
  }
});

module.exports = router;
