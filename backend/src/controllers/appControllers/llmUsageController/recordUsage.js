const mongoose = require('mongoose');

const { calcCost, PRICING, PRICING_VERSION } = require('@/constants/llmPricing');

// Resolved lazily so this module can be required at boot before
// models/utils/index.js has finished registering all mongoose models.
const lazyModel = () => mongoose.model('LlmUsage');

// Persist one LLMUsage document. Always returns a Promise so the caller can
// `.catch()` if they want, but never throws — internally fail-silent so SSE
// finalizers can fire-and-forget without risking the user's response.
//
// Skip rules (return without inserting):
//   - usage missing / not an object → nanobot didn't surface a frame at all
//   - usage.provider or usage.model missing → wire-contract violation; do NOT
//     fill defaults (would mask a nanobot rollback). Surfaced via console.error
//     so the missing field is visible in logs.
//   - totalTokens === 0 → no real LLM call (rare safety net)
//
// Errored row (insert with errored=true, costUsd=0):
//   - PRICING table has no entry for `${provider}:${model}` → token data is
//     still recorded for usage analytics, but cost is 0 and errored flag is
//     raised so the dashboard can surface a "needs pricing" signal.
async function recordUsage({
  userId,
  session,
  messageId = null,
  usage,
  latencyMs,
  requestId,
  errored = false,
  channel = 'ask-ola',
}) {
  if (!usage || typeof usage !== 'object') return;
  if (!session || !session._id) return;

  const provider = typeof usage.provider === 'string' && usage.provider ? usage.provider : null;
  const model = typeof usage.model === 'string' && usage.model ? usage.model : null;
  if (!provider || !model) {
    console.error('[LLMUsage] frame missing provider/model — skipping persist');
    return;
  }

  const inputTokens = Number(usage.prompt_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
  const cachedTokens = Number(usage.cached_tokens || 0);
  const iterations = Number(usage.iterations || 1);

  if (totalTokens === 0) return;

  const pricingKey = `${provider}:${model}`;
  const pricingKnown = Object.prototype.hasOwnProperty.call(PRICING, pricingKey);
  let unknownPricing = false;
  if (!pricingKnown) {
    console.error(
      `[LLMUsage] unknown pricing for ${pricingKey} — recorded with costUsd=0 errored=true`,
    );
    unknownPricing = true;
  }

  try {
    const costUsd = unknownPricing
      ? 0
      : calcCost(provider, model, { inputTokens, outputTokens, cachedTokens });

    const LlmUsage = lazyModel();
    await LlmUsage.create({
      userId,
      sessionId: session._id,
      messageId,
      nanobotSessionId: session.nanobotSessionId,
      requestId,
      channel,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      cachedTokens,
      iterations,
      costUsd,
      pricingVersion: PRICING_VERSION,
      latencyMs: Number(latencyMs) || 0,
      errored: !!errored || unknownPricing,
      createdBy: userId,
    });
  } catch (err) {
    // Never let cost-tracking failure poison the user request. Surface in
    // logs so we notice if writes start systematically dropping (e.g. mongo
    // connection pool exhausted under load).
    console.error('[LLMUsage] persist failed:', err.message);
  }
}

module.exports = recordUsage;
