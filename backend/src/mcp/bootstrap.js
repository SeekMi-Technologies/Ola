// Ola CRM MCP — Bootstrap (mongo + models + system admin)
//
// MCP server is a separate Node process from the main backend, so it must
// open its own mongoose connection and load the same model files. We also
// resolve a "system admin" once at startup — every CRM controller gates
// reads/writes by `req.admin._id`, so MCP needs a stable identity to
// impersonate. We pick the first non-removed `owner`, falling back to the
// first non-removed admin/user. The cached admin is exposed via
// getSystemAdmin() to all tools.
//
// Fail-fast: any connect / model-load / admin-lookup error throws and the
// MCP process exits — never silently boot in a half-broken state.

const mongoose = require('mongoose');
const { globSync } = require('glob');
const path = require('path');
const { mongoConnectOptions } = require('@/utils/dbOptions');

let systemAdmin = null;

// ISO1 (issue #185): per-request acting-as admin cache. Maps admin._id (string)
// to { admin, expiresAt } — TTL-bound so admin disable/remove takes effect
// without requiring an MCP restart. Default TTL 5 minutes balances DB load
// (cache hit on every chat turn) against staleness on admin status changes.
// Capped to 100 entries; admin set is small in practice (~5-10 salespeople).
//
// MCP_ACTING_AS_CACHE_TTL_MS env var overrides for dev/test (e.g. 5000 for
// quick E2E verification of stale-admin rejection).
const ACTING_AS_CACHE = new Map();
const ACTING_AS_CACHE_MAX = 100;
const ACTING_AS_CACHE_TTL_MS = Number(process.env.MCP_ACTING_AS_CACHE_TTL_MS) || 5 * 60 * 1000;

async function loadModels() {
  // Same glob the main backend uses (src/server.js).
  const modelsFiles = globSync('./src/models/**/*.js');
  if (modelsFiles.length === 0) {
    throw new Error('[mcp bootstrap] no model files found — wrong cwd?');
  }
  for (const filePath of modelsFiles) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(path.resolve(filePath));
  }
}

async function connectMongo() {
  if (!process.env.DATABASE) {
    throw new Error('[mcp bootstrap] DATABASE env not set');
  }
  // TLS is conditional (srv → on, plain → off); see @/utils/dbOptions.
  await mongoose.connect(process.env.DATABASE, mongoConnectOptions());
}

async function resolveSystemAdmin() {
  const Admin = mongoose.model('Admin');
  // Prefer owner, then admin, then user. Stable order so re-boots pick the same actor.
  const candidate =
    (await Admin.findOne({ removed: false, enabled: true, role: 'owner' }).sort({ created: 1 }).exec()) ||
    (await Admin.findOne({ removed: false, enabled: true, role: 'admin' }).sort({ created: 1 }).exec()) ||
    (await Admin.findOne({ removed: false, enabled: true }).sort({ created: 1 }).exec());
  if (!candidate) {
    throw new Error('[mcp bootstrap] no enabled Admin found — cannot impersonate');
  }
  systemAdmin = candidate;
  return candidate;
}

async function bootstrap() {
  await loadModels();
  await connectMongo();
  await resolveSystemAdmin();
  return {
    admin: { _id: systemAdmin._id, email: systemAdmin.email, role: systemAdmin.role },
  };
}

function getSystemAdmin() {
  if (!systemAdmin) {
    throw new Error('[mcp bootstrap] getSystemAdmin called before bootstrap()');
  }
  return systemAdmin;
}

/**
 * Resolve an X-Acting-As admin id into a full Admin doc.
 *
 * Returns one of:
 *   { ok: true, admin }                   admin exists, enabled, !removed
 *   { ok: false, code: 'VALIDATION', message }  bad format / not ObjectId
 *   { ok: false, code: 'NOT_FOUND', message }   admin id does not exist
 *   { ok: false, code: 'PERMISSION', message }  admin removed or disabled
 *
 * Throws only on infrastructure errors (mongo down). Callers map to HTTP:
 *   VALIDATION → 400, PERMISSION → 403, NOT_FOUND → 403 (treat as no-perm
 *   to avoid admin id enumeration).
 *
 * @param {string} adminId  raw value from X-Acting-As header
 */
async function resolveActingAdmin(adminId) {
  if (!adminId || typeof adminId !== 'string') {
    return { ok: false, code: 'VALIDATION', message: 'X-Acting-As must be a non-empty string' };
  }
  const trimmed = adminId.trim();
  if (!mongoose.isValidObjectId(trimmed)) {
    return { ok: false, code: 'VALIDATION', message: `X-Acting-As is not a valid ObjectId: ${trimmed}` };
  }

  const cached = ACTING_AS_CACHE.get(trimmed);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return { ok: true, admin: cached.admin };
    }
    // Expired — drop and fall through to DB lookup. Lazy eviction means
    // expired entries that nobody asks about linger until the size cap
    // evicts them, which is fine.
    ACTING_AS_CACHE.delete(trimmed);
  }

  // PR #193 follow-up: project to a minimal safe shape — controllers only
  // ever need _id (createdBy filter), and we keep email/role for audit log
  // surface area. Anything else (incl. any future sensitive field added to
  // Admin schema) stays out of the in-memory cache by construction.
  const Admin = mongoose.model('Admin');
  const admin = await Admin.findById(trimmed)
    .select('_id email role enabled removed')
    .lean()
    .exec();
  if (!admin) {
    return { ok: false, code: 'NOT_FOUND', message: `admin not found: ${trimmed}` };
  }
  if (admin.removed === true) {
    return { ok: false, code: 'PERMISSION', message: `admin removed: ${trimmed}` };
  }
  if (admin.enabled === false) {
    return { ok: false, code: 'PERMISSION', message: `admin disabled: ${trimmed}` };
  }

  if (ACTING_AS_CACHE.size >= ACTING_AS_CACHE_MAX) {
    // Evict oldest (Map preserves insertion order)
    const firstKey = ACTING_AS_CACHE.keys().next().value;
    ACTING_AS_CACHE.delete(firstKey);
  }
  ACTING_AS_CACHE.set(trimmed, {
    admin,
    expiresAt: Date.now() + ACTING_AS_CACHE_TTL_MS,
  });
  return { ok: true, admin };
}

/**
 * Drop the acting-as cache. With no arg clears all entries; with an
 * adminId only that entry. Call after admin update/disable/remove flows.
 */
function invalidateActingAsCache(adminId) {
  if (adminId === undefined) {
    ACTING_AS_CACHE.clear();
    return;
  }
  ACTING_AS_CACHE.delete(adminId);
}

module.exports = {
  bootstrap,
  getSystemAdmin,
  resolveActingAdmin,
  invalidateActingAsCache,
  // exported for tests that already manage their own mongo connection
  resolveSystemAdmin,
};
