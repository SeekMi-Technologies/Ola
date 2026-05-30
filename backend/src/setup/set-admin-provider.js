// Toggle a single admin's transcribeProvider (#257).
//
// Usage from backend/ directory:
//   node src/setup/set-admin-provider.js <email> <openai|paraformer|null>
//
// Examples:
//   node src/setup/set-admin-provider.js admin@admin.com paraformer
//   node src/setup/set-admin-provider.js sales@gingersoft.com openai
//   node src/setup/set-admin-provider.js admin@admin.com null   # reset to env default
//
// Exit codes: 0 ok, 1 bad args / unknown admin / DB error.

require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');

const VALID_PROVIDERS = ['openai', 'paraformer', 'null'];

async function main() {
  const [, , email, providerArg] = process.argv;

  if (!email || !providerArg) {
    console.error('Usage: node src/setup/set-admin-provider.js <email> <openai|paraformer|null>');
    process.exit(1);
  }

  if (!VALID_PROVIDERS.includes(providerArg)) {
    console.error(`Invalid provider "${providerArg}". Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    process.exit(1);
  }

  if (!process.env.DATABASE) {
    console.error('DATABASE env var not set — make sure backend/.env exists and is sourced.');
    process.exit(1);
  }

  // Load Admin model.
  require('../models/coreModels/Admin');
  const Admin = mongoose.model('Admin');

  try {
    await mongoose.connect(process.env.DATABASE);
  } catch (err) {
    console.error('Mongo connect failed:', err.message);
    process.exit(1);
  }

  const provider = providerArg === 'null' ? null : providerArg;
  const result = await Admin.findOneAndUpdate(
    { email: email.toLowerCase(), removed: { $ne: true } },
    { transcribeProvider: provider },
    { new: true }
  );

  if (!result) {
    console.error(`No active admin found with email "${email}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const display = provider === null ? 'null (will fall back to env / openai)' : provider;
  console.log(`OK  ${result.email} → transcribeProvider=${display}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
