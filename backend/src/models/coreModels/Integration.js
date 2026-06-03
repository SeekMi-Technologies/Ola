const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Per-admin × per-provider integration state. Row-per-integration so new
// channels (email/wechat/...) extend the `provider` enum, not the Admin schema.
const integrationSchema = new Schema({
  removed: { type: Boolean, default: false },
  // intent: did this admin turn the integration on (distinct from observed `status`)
  enabled: { type: Boolean, default: false },

  createdBy: { type: Schema.ObjectId, ref: 'Admin', required: true },

  provider: { type: String, required: true, enum: ['whatsapp'] },

  // observed connection snapshot, pulled from the bridge (the live source of truth).
  // String, not enum: keeps this table provider-neutral — the value set is
  // validated per-provider in the controller.
  status: { type: String, default: 'disconnected' },

  // provider-specific data, e.g. whatsapp → { phoneNumber }
  meta: { type: Schema.Types.Mixed, default: {} },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

// One integration row per (admin, provider)
integrationSchema.index({ createdBy: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('Integration', integrationSchema);
