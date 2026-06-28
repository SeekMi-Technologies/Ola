// Friendly in-progress labels for the Ask Ola thinking panel (Issue #131).
//
// Maps NanoBot MCP tool names → user-facing English strings. Lives in the
// CRM proxy (not in NanoBot) so UIUX (Will / Angel) can edit copy without
// redeploying NanoBot, and so new MCP tools auto-fallback to "Working on
// it..." instead of breaking when added before a label is registered.
//
// v1 is English-only; i18n / Chinese is tracked as a separate follow-up
// (idurar_app_language is application-level not user-level — tech debt).
//
// labelFor() handles prefix stripping + skip-list + fallback in one call.
// Naming constants + rawToolName() are shared with toolResultToBlocks.js
// via mcpUtils.js (single source of truth for MCP naming).

const { MCP_SERVER_NAME, MCP_PREFIX, rawToolName } = require('./mcpUtils');

// Raw tool name (after stripping mcp_ola_crm_ prefix) → in-progress label.
// All labels carry an "Ola is X..." subject for warmth + clarity (zyd).
// Future v1.1: search-type tools should also surface the query argument
// (see follow-up issue for "Ola is searching for 'stainless steel'...").
const TOOL_LABELS = {
  // Customer
  'customer.search': 'Ola is searching customers...',
  'customer.read':   'Ola is loading customer details...',
  'customer.create': 'Ola is creating customer record...',
  'customer.update': 'Ola is updating customer info...',

  // Merchandise
  'merch.search':    'Ola is searching your products...',
  'merch.read':      'Ola is loading product details...',
  'merch.create':    'Ola is adding product to catalog...',
  'merch.update':    'Ola is updating product info...',

  // Quote
  'quote.search':           'Ola is searching quotes...',
  'quote.read':             'Ola is loading quote...',
  'quote.create':           'Ola is drafting your quote...',
  'quote.update':           'Ola is updating quote...',
  'quote.generate_pdf_url': 'Ola is preparing the PDF link...',

  // Salesperson (system-scope; mainly invoked by email channel)
  'salesperson.lookup_by_email': 'Ola is identifying the salesperson...',

  // File / transcript (Plan B v3 phase D — agent-driven MCP fetch)
  'file.search':                'Ola is searching your files...',
  'file.get_transcript':        'Ola is reading the transcript...',
  'file.transcription_status':  'Ola is checking transcription status...',
};

// Tools that should NOT surface a thinking step to the end user.
// System-level / health-check tools belong here.
const SKIP_TOOLS = new Set([
  'health.ping',
]);

// Non-tool stages — used by chat.js / frontend when the agent is between
// tool calls (e.g. before first tool fires, while composing final response,
// or for unknown / unregistered tools).
const STAGE_LABELS = {
  __init__:    'Ola is thinking...',           // pre-tool / generic placeholder
  __compose__: 'Ola is composing the reply...',
  __unknown__: 'Ola is working on it...',      // fallback for unregistered tools
};

// Resolve a NanoBot tool event name (with or without mcp_ola_crm_ prefix)
// to the user-facing label. Returns null for skip-list tools (caller should
// suppress the SSE thinking_step entirely). Falls back to a tool-name-aware
// label like "Ola is calling <tool>..." so the user (and dev console) can
// see which unregistered tool is firing — beats the old opaque
// "Ola is working on it...".
function labelFor(toolName) {
  const raw = rawToolName(toolName);
  if (!raw) return STAGE_LABELS.__unknown__;
  if (SKIP_TOOLS.has(raw)) return null;
  if (TOOL_LABELS[raw]) return TOOL_LABELS[raw];
  return `Ola is calling ${raw}...`;
}

module.exports = {
  TOOL_LABELS,
  SKIP_TOOLS,
  STAGE_LABELS,
  MCP_SERVER_NAME,
  MCP_PREFIX,
  rawToolName,
  labelFor,
};
