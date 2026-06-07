const fs = require('fs');
const os = require('os');
const path = require('path');

function unreachable() {
  const err = new Error('WhatsApp bridge not running');
  err.code = 'BRIDGE_UNREACHABLE';
  return err;
}

// Locate the local WhatsApp bridge. Env wins for cross-host prod (Box1 CRM →
// Box2 bridge); dev falls back to the portfile the bridge writes on startup.
function readBridge() {
  const host = process.env.WA_BRIDGE_HOST || '127.0.0.1';

  if (process.env.WA_BRIDGE_PORT) {
    const port = parseInt(process.env.WA_BRIDGE_PORT, 10);
    if (!port) throw unreachable();
    return { host, port };
  }

  const portFile = path.join(os.homedir(), '.nanobot', 'wa', 'bridge.port');
  if (!fs.existsSync(portFile)) throw unreachable();
  const port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
  if (!port) throw unreachable();
  return { host, port };
}

module.exports = { readBridge };
