const Integration = require('@/models/coreModels/Integration');
const { callBridge, sendBridgeError } = require('./callBridge');

const PROVIDER = 'whatsapp';

// DELETE /api/whatsapp — tell the bridge to disconnect + wipe authDir, and
// record that this admin turned WhatsApp off.
const logout = async (req, res) => {
  const adminId = req.admin._id;

  try {
    await callBridge('DELETE', '', adminId.toString());
  } catch (err) {
    if (sendBridgeError(res, err)) return;
    throw err;
  }

  await Integration.findOneAndUpdate(
    { createdBy: adminId, provider: PROVIDER },
    { enabled: false, status: 'logged_out', updated: Date.now() },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return res.status(200).json({
    success: true,
    result: { status: 'logged_out' },
    message: 'WhatsApp disconnected',
  });
};

module.exports = logout;
