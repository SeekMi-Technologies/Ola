// Tests for thinkingLabels.js — friendly label dictionary for Ask Ola
// thinking panel (Issue #131, backlog L2).
//
// No DB / express needed — pure dictionary + helper logic.

const {
  TOOL_LABELS,
  SKIP_TOOLS,
  STAGE_LABELS,
  MCP_PREFIX,
  rawToolName,
  labelFor,
} = require('@/controllers/appControllers/olaController/thinkingLabels');

describe('thinkingLabels — TOOL_LABELS dictionary', () => {
  test('covers all v1 user-facing MCP tools + forward-looking entries (#170)', () => {
    const expected = [
      'customer.search', 'customer.read', 'customer.create', 'customer.update',
      'merch.search', 'merch.read', 'merch.create', 'merch.update',
      'quote.search', 'quote.read', 'quote.create', 'quote.update',
      // Forward-looking: tools live on ZYD_FEAT, will activate when merged to dev
      'quote.generate_pdf_url',
      'salesperson.lookup_by_email',
      // File / transcript (Plan B v3 phase D)
      'file.search', 'file.get_transcript', 'file.transcription_status',
    ];
    expect(Object.keys(TOOL_LABELS).sort()).toEqual(expected.sort());
  });

  test('forward-looking entries resolve to specific labels (not __unknown__ fallback)', () => {
    expect(labelFor('mcp_ola_crm_quote.generate_pdf_url')).toBe('Ola is preparing the PDF link...');
    expect(labelFor('mcp_ola_crm_salesperson.lookup_by_email')).toBe('Ola is identifying the salesperson...');
  });

  test('transcribe_audio is unregistered — falls back to tool-name-aware label', () => {
    expect(labelFor('transcribe_audio')).toBe('Ola is calling transcribe_audio...');
  });

  test('does NOT include health.ping (it is in SKIP_TOOLS)', () => {
    expect(TOOL_LABELS).not.toHaveProperty('health.ping');
    expect(SKIP_TOOLS.has('health.ping')).toBe(true);
  });

  test('every value is a non-empty string ending with ellipsis-style "..."', () => {
    for (const [key, value] of Object.entries(TOOL_LABELS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(value).toMatch(/\.\.\.$/);  // visual signal of in-progress
    }
  });
});

describe('thinkingLabels — STAGE_LABELS', () => {
  test('has __init__, __compose__, __unknown__ (all carry Ola subject)', () => {
    expect(STAGE_LABELS.__init__).toBe('Ola is thinking...');
    expect(STAGE_LABELS.__compose__).toBe('Ola is composing the reply...');
    expect(STAGE_LABELS.__unknown__).toBe('Ola is working on it...');
  });
});

describe('thinkingLabels — rawToolName()', () => {
  test('strips mcp_ola_crm_ prefix when present', () => {
    expect(rawToolName('mcp_ola_crm_merch.search')).toBe('merch.search');
    expect(rawToolName('mcp_ola_crm_quote.create')).toBe('quote.create');
  });

  test('returns input unchanged when prefix absent', () => {
    expect(rawToolName('merch.search')).toBe('merch.search');
    expect(rawToolName('something.else')).toBe('something.else');
  });

  test('returns empty string for non-string input', () => {
    expect(rawToolName(null)).toBe('');
    expect(rawToolName(undefined)).toBe('');
    expect(rawToolName(42)).toBe('');
    expect(rawToolName({})).toBe('');
  });
});

describe('thinkingLabels — labelFor()', () => {
  test('resolves a known raw tool name (with Ola subject)', () => {
    expect(labelFor('merch.search')).toBe('Ola is searching your products...');
    expect(labelFor('quote.create')).toBe('Ola is drafting your quote...');
  });

  test('resolves a prefixed tool name (mcp_ola_crm_*)', () => {
    expect(labelFor('mcp_ola_crm_customer.search')).toBe('Ola is searching customers...');
    expect(labelFor('mcp_ola_crm_merch.update')).toBe('Ola is updating product info...');
  });

  test('returns null for skip-list tools (caller should suppress)', () => {
    expect(labelFor('health.ping')).toBeNull();
    expect(labelFor('mcp_ola_crm_health.ping')).toBeNull();
  });

  test('falls back to tool-name-aware label for unregistered tools (Plan B v3 phase D)', () => {
    expect(labelFor('compute.profitMargin')).toBe('Ola is calling compute.profitMargin...');
    expect(labelFor('mcp_ola_crm_factory.list')).toBe('Ola is calling factory.list...');
    expect(labelFor('totally_made_up_tool')).toBe('Ola is calling totally_made_up_tool...');
  });

  test('falls back to __unknown__ stage label for empty / non-string input', () => {
    expect(labelFor('')).toBe('Ola is working on it...');
    expect(labelFor(null)).toBe('Ola is working on it...');
    expect(labelFor(undefined)).toBe('Ola is working on it...');
  });
});

describe('thinkingLabels — MCP_PREFIX constant', () => {
  test('matches toolResultToBlocks.js convention exactly', () => {
    // toolResultToBlocks.js hardcodes MCP_SERVER_NAME = 'ola_crm';
    // both must agree or label resolution silently breaks for prefixed names.
    expect(MCP_PREFIX).toBe('mcp_ola_crm_');
  });
});
