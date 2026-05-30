// Hardcoded LLM provider pricing table for cost estimation in LLMUsage records
// (Ola issue #98). Update PRICING_VERSION whenever any number here changes;
// historical LLMUsage rows snapshot the version that was active when they
// were written so we never silently re-cost old records.
//
// Re-verify quarterly. TODO(ziyue): re-verify pricing 2026-Q3, by 2026-08-01
//
// Money math here intentionally bypasses helpers.calculate.* because that
// helper hard-codes currency.js precision-2 (USD cents) — fine for invoice
// line items but it truncates token-rate values like $0.25/1M to zero.
// We use currency.js directly with precision 10 to keep the spirit of the
// "no native + - * for money" project rule while preserving sub-cent
// precision needed for token costs.

const currency = require('currency.js');

const COST_PRECISION = 10;
const cur = (v) => currency(v, { precision: COST_PRECISION });

const PRICING_VERSION = '2026-04-28';

// USD per 1,000,000 tokens. Prices are Standard tier, paid (text input).
// Source: https://ai.google.dev/gemini-api/docs/pricing (fetched 2026-04-28)
//
// `cached` is the context-caching read rate when the provider reports cache
// hits in usage.cached_tokens. Set to 0 for providers/models without caching
// — calcCost() will then bill cached tokens at the regular input rate via
// the (input - cached) split.
const PRICING = {
  // The current default Ask Ola model — see ola/nanobot.config.template.json.
  'gemini:gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50, cached: 0.025 },
  'gemini:gemini-2.5-flash':              { input: 0.30, output: 2.50, cached: 0.03 },
  'gemini:gemini-2.5-flash-lite':         { input: 0.10, output: 0.40, cached: 0.01 },

  // Likely-future-tested models — verify these against the provider's pricing
  // page before relying on the costUsd they produce. Marked here so an
  // unexpected provider/model combo at least produces a non-zero estimate
  // instead of silently falling through to costUsd=0.
  'openai:gpt-4o-mini':                   { input: 0.15, output: 0.60, cached: 0.075 },
  'openai:gpt-4o':                        { input: 2.50, output: 10.00, cached: 1.25 },
  'anthropic:claude-3-5-haiku-latest':    { input: 0.80, output: 4.00, cached: 0.08 },
  'anthropic:claude-sonnet-4-5':          { input: 3.00, output: 15.00, cached: 0.30 },
};

// Compute USD cost for one LLM turn given token counts.
//   provider/model — keys into PRICING via `${provider}:${model}`
//   inputTokens   — sum of provider-reported prompt_tokens across the turn
//   outputTokens  — sum of provider-reported completion_tokens across the turn
//   cachedTokens  — sum of cache-hit input tokens (default 0)
// Returns Number (USD), 0 when the model is not in PRICING (with a one-shot
// console.warn so the gap is visible in logs but doesn't blow up the request).
function calcCost(provider, model, { inputTokens, outputTokens, cachedTokens = 0 }) {
  const key = `${provider}:${model}`;
  const p = PRICING[key];
  if (!p) {
    console.warn(`[LLMPricing] unknown model ${key}, costUsd=0; add to llmPricing.js`);
    return 0;
  }
  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  const cachedTok = Math.max(0, Math.min(Number(cachedTokens) || 0, inTok));
  const billableInTok = inTok - cachedTok;

  // perToken rates: dollar / 1M tokens.
  const perInputToken = cur(p.input).divide(1_000_000);
  const perOutputToken = cur(p.output).divide(1_000_000);
  const perCachedToken = cur(p.cached || 0).divide(1_000_000);

  const inCost = perInputToken.multiply(billableInTok);
  const outCost = perOutputToken.multiply(outTok);
  const cacheCost = perCachedToken.multiply(cachedTok);

  return inCost.add(outCost).add(cacheCost).value;
}

module.exports = { PRICING_VERSION, PRICING, calcCost };
