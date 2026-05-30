const { resolveActingAdmin, getSystemAdmin } = require('./bootstrap');

// Whitelisted JSON-RPC labels may proceed without X-Acting-As: protocol
// methods (no business state) + salesperson.lookup_by_email (chicken-and-egg:
// email channel uses this very tool to resolve sender → admin._id). The
// notifications/* entries are MCP client→server protocol messages — omitting
// any of them 401-gates the SDK handshake and kills the session before any
// tool can run.
const SYSTEM_TOOLS = new Set([
  'initialize',
  'tools/list',
  'resources/list',
  'prompts/list',
  'ping',
  'salesperson.lookup_by_email',
  'notifications/initialized',
  'notifications/cancelled',
  'notifications/progress',
  'notifications/roots/list_changed',
]);

async function decideActingAdmin(rawHeader, toolLabel) {
  const headerPresent =
    typeof rawHeader === 'string' && rawHeader.trim().length > 0;

  if (!headerPresent) {
    if (typeof toolLabel === 'string' && SYSTEM_TOOLS.has(toolLabel)) {
      return { ok: true, actingAdmin: getSystemAdmin(), isSystemFallback: true };
    }
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'X-Acting-As header is required',
    };
  }

  const result = await resolveActingAdmin(rawHeader.trim());
  if (!result.ok) {
    const status = result.code === 'VALIDATION' ? 400 : 403;
    return { ok: false, status, code: result.code, message: result.message };
  }
  return { ok: true, actingAdmin: result.admin, isSystemFallback: false };
}

module.exports = { decideActingAdmin, SYSTEM_TOOLS };
