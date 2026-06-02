// Mongoose connection options shared by the two long-running connects (server.js + mcp/bootstrap.js).
//
// Atlas (mongodb+srv://) implies TLS, so for prod we keep tls on. But a plain mongodb://
// host (local docker / CI mongo:7) does NOT speak TLS — forcing tls there fails the
// handshake outright (tlsAllowInvalidCertificates only relaxes cert *validation*, it does
// not make TLS optional). So only enable TLS for srv URIs, with MONGO_TLS=true as an
// escape hatch for a non-srv host that still requires TLS.
function mongoConnectOptions() {
  const uri = process.env.DATABASE || '';
  const useTls = uri.startsWith('mongodb+srv') || process.env.MONGO_TLS === 'true';
  return {
    ...(useTls ? { tls: true } : {}),
    serverSelectionTimeoutMS: 30000, // 30 seconds
    socketTimeoutMS: 45000, // 45 seconds
    family: 4, // Force IPv4
  };
}

module.exports = { mongoConnectOptions };
