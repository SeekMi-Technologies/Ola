const Integration = require('@/models/coreModels/Integration');
const { callBridge, sendBridgeError } = require('./callBridge');

const PROVIDER = 'whatsapp';

// GET /api/whatsapp/status — pass through the bridge's live snapshot ({status, qr?})
// and refresh the cached row only when the observed status actually changed.
const status = async (req, res) => {
  const adminId = req.admin._id;

  let bridge;
  try {
    bridge = await callBridge('GET', '/status', adminId.toString());
  } catch (err) {
    if (sendBridgeError(res, err)) return;
    throw err;
  }

  const result = { status: bridge.status || 'disconnected' };
  if (bridge.qr) result.qr = bridge.qr;

  // Cache refresh: write only on change, and never create a row here — login
  // owns row creation (intent). $ne makes a no-op when status is unchanged.
  await Integration.updateOne(
    { createdBy: adminId, provider: PROVIDER, status: { $ne: result.status } },
    { status: result.status, updated: Date.now() }
  );

  return res.status(200).json({ success: true, result, message: 'WhatsApp status' });
};

module.exports = status;
