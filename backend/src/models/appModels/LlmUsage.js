const mongoose = require('mongoose');

// Per-turn LLM call telemetry — populated by olaController/chat.js after each
// Ask Ola SSE stream completes (Ola issue #98). One document per user message
// → assistant response cycle, regardless of how many internal LLM calls
// nanobot needed (tool dispatch + finalization etc.) — those are summed into
// inputTokens/outputTokens and counted in `iterations`.
//
// Writes are fire-and-forget from the SSE finalizer; never block the user
// response on persistence here.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  // Who asked. Required because the dashboard segments by user.
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  // Which Ask Ola conversation this turn belongs to.
  sessionId: {
    type: mongoose.Schema.ObjectId,
    ref: 'ChatSession',
    required: true,
  },
  // Optional pointer to the assistant ChatMessage that this usage covers.
  // Set when olaController/chat.js can plumb the inserted message _id back;
  // null when the message persist failed or hasn't completed yet.
  messageId: {
    type: mongoose.Schema.ObjectId,
    ref: 'ChatMessage',
    default: null,
  },
  // Cross-repo trace key (matches NanoBot's session_key). Useful when
  // diagnosing a cost spike — lets us correlate to nanobot logs.
  nanobotSessionId: { type: String, required: true },
  // Per-request UUID generated in olaController/chat.js — drops into
  // application logs so we can match a record to a specific HTTP request.
  requestId: { type: String, required: true },

  // Channel where the turn originated. Indexed because the dashboard splits
  // cost by channel. Allowed values (no enum constraint — additive over time):
  //   'ask-ola'             — user-facing Ask Ola web chat (the main path)
  //   'ask-ola-autotitle'   — incidental non-streaming LLM call that
  //                           generates the conversation title at turn 4+
  //                           (#98 C5; usually small Gemini-flash-lite spend)
  //   'whatsapp' / 'wechat' / 'email'  — planned channels (not wired yet)
  channel: { type: String, default: 'ask-ola', index: true },
  // LLM provider as nanobot reports it ('gemini' / 'openai' / 'anthropic').
  provider: { type: String, required: true },
  // Model identifier as nanobot reports it.
  model: { type: String, required: true },

  // Token counts as reported by the provider's usage field, summed across
  // all internal LLM calls in this one Ask Ola turn.
  inputTokens: { type: Number, required: true },
  outputTokens: { type: Number, required: true },
  totalTokens: { type: Number, required: true },
  // Cached input tokens (provider-reported cache hits — reduce billable
  // input). Stored separately so we can show savings on the dashboard.
  cachedTokens: { type: Number, default: 0 },
  // Number of LLM provider calls in this turn (1 = direct answer; >=2 means
  // tool calls + finalization). Sourced from runner.AgentRunResult.
  iterations: { type: Number, default: 1 },

  // Estimated cost in USD using the pricing snapshot recorded in
  // pricingVersion. Float math is acceptable here because token rates are
  // sub-cent per token (currency.js precision-2 truncates these to 0); the
  // pricing module uses currency.js with explicit precision-10 internally.
  costUsd: { type: Number, required: true },
  // Pricing table version that was active when costUsd was computed (e.g.
  // '2026-04-28'). When prices change, we bump PRICING_VERSION rather than
  // back-fill historical records.
  pricingVersion: { type: String, required: true },

  latencyMs: { type: Number, required: true },
  // True when the SSE upstream errored — keep the record so we still see
  // wasted token spend on failed turns.
  errored: { type: Boolean, default: false },

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
}, {
  // Pin the collection to a single canonical name (no mongoose pluralization)
  // so the verification command from issue #98 — `db.llmusage.find(...)` —
  // works as written, and so future Atlas dashboards don't have to guess.
  collection: 'llmusage',
});

// Per-user latest-first lookup — the dashboard's primary access pattern.
schema.index({ userId: 1, created: -1 });
// Time-bucketed aggregation across all users (cost over time, etc.).
schema.index({ created: -1 });
// Per-channel slice for breaking out Ask Ola vs WhatsApp vs Email cost.
schema.index({ channel: 1, created: -1 });

module.exports = mongoose.model('LlmUsage', schema);
