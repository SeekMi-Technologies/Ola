const mongoose = require('mongoose');

// Throttled (≥60s/admin) writer for Admin.lastActivity. Fire-and-forget
// — a Mongo failure must not break the request since auth already passed.
const THROTTLE_MS = 60 * 1000;
const lastWriteByAdmin = new Map();

function trackActivity(req, res, next) {
  if (!req.admin || !req.admin._id) return next();

  const adminId = String(req.admin._id);
  const now = Date.now();
  const lastWrite = lastWriteByAdmin.get(adminId);
  if (lastWrite && now - lastWrite < THROTTLE_MS) return next();

  lastWriteByAdmin.set(adminId, now);

  const Admin = mongoose.model('Admin');
  Admin.findByIdAndUpdate(req.admin._id, { lastActivity: new Date(now) })
    .catch((err) => {
      console.error('[trackActivity] failed to update lastActivity:', err && err.message);
    });

  return next();
}

// Test hook — only attached outside production so the throttle Map can't
// be cleared at runtime by a misbehaving caller.
if (process.env.NODE_ENV !== 'production') {
  trackActivity._resetThrottle = () => lastWriteByAdmin.clear();
}

module.exports = trackActivity;
