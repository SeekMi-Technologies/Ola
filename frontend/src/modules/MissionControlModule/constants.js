// Mission Control — shared metadata for the lead-to-quote command center.
//
// UI-only prototype constants. The real values are the *contract* the backend
// Mission model will mirror once it exists (stage + channel enums, agentState).
// Keep this list as the single source of truth for the board so columns,
// chips and the detail stepper never drift apart.

// ── Business pipeline (the lead-to-quote funnel) ─────────────────────────────
// `won` is shown as the terminal column; `lost` is a terminal state too but is
// filtered out of the default board (surfaced via a filter later).
export const STAGES = [
  { key: 'inquiry', label: 'Lead Inquiry', short: 'Inquiry', color: '#1890ff' },
  { key: 'negotiation', label: 'Negotiation', short: 'Negotiation', color: '#13c2c2' },
  { key: 'quote_drafting', label: 'Quote Drafting', short: 'Drafting', color: '#722ed1' },
  { key: 'quote_finalization', label: 'Quote Finalization', short: 'Finalizing', color: '#ffa940' },
  { key: 'won', label: 'Won', short: 'Won', color: '#95de64' },
];

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s]));

export function stageIndex(key) {
  return STAGES.findIndex((s) => s.key === key);
}

// ── Agent execution state (Palantir's Processing / Approval / Completed) ──────
export const AGENT_STATES = {
  processing: { key: 'processing', label: 'Processing', color: '#1890ff' },
  awaiting_approval: { key: 'awaiting_approval', label: 'Awaiting Approval', color: '#ffa940' },
  idle: { key: 'idle', label: 'Idle', color: '#595959' },
  done: { key: 'done', label: 'Completed', color: '#95de64' },
};

// The 3 status columns of the Palantir-style matrix view. `idle` folds into
// Processing so every mission lands in exactly one cell.
export const MATRIX_COLUMNS = [
  { key: 'processing', label: 'Agent Active', desc: 'Ola is working on this', states: ['processing', 'idle'] },
  { key: 'awaiting_approval', label: 'Needs Review', desc: 'Waiting for your input', states: ['awaiting_approval'] },
  { key: 'done', label: 'Done', desc: 'Mission completed', states: ['done'] },
];

// ── Inbound/outbound channels — generic, never hardcode whatsapp as the only
// source (CLAUDE.md MVP rule). WeChat / Email are first-class peers.
export const CHANNELS = {
  whatsapp: { key: 'whatsapp', label: 'WhatsApp', color: '#25d366' },
  email: { key: 'email', label: 'Email', color: '#3b82f6' },
  wechat: { key: 'wechat', label: 'WeChat', color: '#07c160' },
};

// ── Small relative-time helper for card timestamps ("12m ago"). ──────────────
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
