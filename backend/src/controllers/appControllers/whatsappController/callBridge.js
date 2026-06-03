const http = require('http');
const crypto = require('crypto');
const { readBridge } = require('@/utils/bridgePort');

// Per-admin bridge token: HMAC-SHA256(MCP_SERVICE_TOKEN, adminId). Same secret
// and algorithm as the bridge (Node) and nanobot (Python), so all three derive
// identical tokens with no shared table.
function tokenFor(adminId) {
  const secret = process.env.MCP_SERVICE_TOKEN;
  if (!secret) {
    // Misconfig — surface as "unavailable" to the user, log on the server.
    console.error('[whatsapp] MCP_SERVICE_TOKEN is missing');
    const err = new Error('WhatsApp bridge not running');
    err.code = 'BRIDGE_UNREACHABLE';
    throw err;
  }
  return crypto.createHmac('sha256', secret).update(adminId).digest('hex');
}

// Proxy one request to the bridge. Resolves the parsed JSON body on 2xx.
// Rejects with code BRIDGE_UNREACHABLE (network/no-portfile) or
// BRIDGE_BAD_STATUS (non-2xx, .upstreamStatus carries the code).
function callBridge(method, pathSuffix, adminId) {
  return new Promise((resolve, reject) => {
    let host, port, token;
    try {
      ({ host, port } = readBridge());
      token = tokenFor(adminId);
    } catch (err) {
      return reject(err);
    }

    const req = http.request(
      {
        host,
        port,
        path: `/wa/${adminId}${pathSuffix}`,
        method,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            let body = {};
            try {
              body = data ? JSON.parse(data) : {};
            } catch {
              body = {};
            }
            resolve(body);
          } else {
            const err = new Error(`bridge responded ${res.statusCode}`);
            err.code = 'BRIDGE_BAD_STATUS';
            err.upstreamStatus = res.statusCode;
            reject(err);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('WhatsApp bridge not running');
      err.code = 'BRIDGE_UNREACHABLE';
      reject(err);
    });
    req.on('error', () => {
      const err = new Error('WhatsApp bridge not running');
      err.code = 'BRIDGE_UNREACHABLE';
      reject(err);
    });
    req.end();
  });
}

// Translate a bridge error into an HTTP response. Returns true if it handled
// the error; false means the caller should rethrow (→ catchErrors → 500).
function sendBridgeError(res, err) {
  if (err.code === 'BRIDGE_UNREACHABLE') {
    res.status(503).json({ success: false, result: null, message: 'WhatsApp bridge not running' });
    return true;
  }
  if (err.code === 'BRIDGE_BAD_STATUS') {
    console.error(`[whatsapp] bridge bad status: ${err.upstreamStatus}`);
    res.status(502).json({ success: false, result: null, message: 'WhatsApp bridge error' });
    return true;
  }
  return false;
}

module.exports = { callBridge, sendBridgeError, tokenFor };
