const Integration = require('@/models/coreModels/Integration');
const { callBridge, sendBridgeError } = require('./callBridge');

const PROVIDER = 'whatsapp';

// POST /api/whatsapp/login — trigger the bridge to start a Baileys client for
// this admin (QR is fetched by the subsequent /status polls), and record intent.
const login = async (req, res) => {
  const adminId = req.admin._id; // identity from the auth token only — never body/param

  let bridge;
  try {
    bridge = await callBridge('POST', '/login', adminId.toString());
  } catch (err) {
    if (sendBridgeError(res, err)) return;
    throw err;
  }

  const status = bridge.status || 'qr_pending';
  await Integration.findOneAndUpdate(
    { createdBy: adminId, provider: PROVIDER },
    { enabled: true, status, updated: Date.now() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return res.status(200).json({
    success: true,
    result: { status },
    message: 'WhatsApp login initiated',
  });
};

module.exports = login;
