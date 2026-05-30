// Soft-delete ZYD test data (askola e2e + email harness + deploy smoke).
// Usage:
//   cd backend && node scripts/cleanup_zyd_e2e_data.js [--dry-run]
//
// Matches: clients.name / merches.serialNumber containing
//   ZYD-E2E-*, ZYD-EMAIL-* (incl. ZYD-EMAIL-FULL-VERIFY-*), or ZYD-DEPLOY-*
//   prefix. Plus quotes whose client._id is in the matched-client set.
// Sets removed:true (soft delete only — never physical delete).

require('module-alias/register');
require('dotenv').config({ path: '.env' });
const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');

globSync('./src/models/**/*.js').forEach((f) => require(path.resolve(f)));

const DRY = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(process.env.DATABASE);
  const Client = mongoose.model('Client');
  const Merch = mongoose.model('Merch');
  const Quote = mongoose.model('Quote');

  // Match every ZYD-test prefix used across the harness + deploy suite:
  //   ZYD-E2E-              askola_acting_as_e2e.py
  //   ZYD-EMAIL-E2E-        early email harness ad-hoc
  //   ZYD-EMAIL-FULL-VERIFY- full-verify email run
  //   ZYD-DEPLOY-           deploy skill Phase 4 / 4b smoke
  const re = /^ZYD-(E2E-|EMAIL-|DEPLOY-)/;

  const clientHits = await Client.find({ name: re, removed: false }).select('name createdBy').lean();
  const merchHits = await Merch.find({ serialNumber: re, removed: false }).select('serialNumber createdBy').lean();
  // Quotes don't carry the marker in `name`; match by quotes that reference a
  // ZYD-E2E client OR have the marker in notes. Conservative: only quotes
  // pointing at the ZYD-E2E clients we just found.
  const e2eClientIds = clientHits.map((c) => c._id);
  const quoteHits = await Quote.find({
    client: { $in: e2eClientIds },
    removed: false,
  }).select('number client').lean();

  console.log(`clients   matched: ${clientHits.length}`);
  clientHits.forEach((c) => console.log(`  ${c.name}  createdBy=${c.createdBy}`));
  console.log(`merches   matched: ${merchHits.length}`);
  merchHits.forEach((m) => console.log(`  ${m.serialNumber}  createdBy=${m.createdBy}`));
  console.log(`quotes    matched (refs ZYD-E2E client): ${quoteHits.length}`);
  quoteHits.forEach((q) => console.log(`  ${q.number}  client=${q.client}`));

  if (DRY) {
    console.log('\n[dry-run] no changes written');
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const cr = await Client.updateMany({ name: re, removed: false }, { $set: { removed: true, updated: now } });
  const mr = await Merch.updateMany({ serialNumber: re, removed: false }, { $set: { removed: true, updated: now } });
  const qr = await Quote.updateMany(
    { client: { $in: e2eClientIds }, removed: false },
    { $set: { removed: true, updated: now } },
  );
  console.log(`\nsoft-deleted: clients=${cr.modifiedCount}  merches=${mr.modifiedCount}  quotes=${qr.modifiedCount}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
