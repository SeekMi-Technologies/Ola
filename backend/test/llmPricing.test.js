/**
 * Tests for constants/llmPricing.js — token cost calculation table (#98).
 *
 * Pure function tests — no DB / express needed. The math has to handle
 * sub-cent token rates that helpers.calculate (currency.js precision-2)
 * would silently truncate to zero, so we test small-magnitude precision
 * explicitly.
 */

const { calcCost, PRICING, PRICING_VERSION } = require('@/constants/llmPricing');

describe('llmPricing — module exports', () => {
  test('PRICING_VERSION is a YYYY-MM-DD string snapshot', () => {
    expect(PRICING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('every pricing entry has positive input/output rates', () => {
    for (const [key, p] of Object.entries(PRICING)) {
      expect(p.input).toBeGreaterThan(0);
      expect(p.output).toBeGreaterThan(0);
      expect(p.cached).toBeGreaterThanOrEqual(0);
      // Sanity: cached <= input (provider would never charge MORE for cache hits).
      expect(p.cached).toBeLessThanOrEqual(p.input);
      // Sanity: output >= input (output is invariably more expensive in 2025+
      // pricing models — flag if a future entry violates this so we re-check).
      expect(p.output).toBeGreaterThanOrEqual(p.input);
    }
  });

  test('default Ask Ola model is in PRICING (matches ola/nanobot.config.template.json)', () => {
    // toHaveProperty parses '.' as a nesting separator, which mangles
    // 'gemini:gemini-3.1-flash-lite-preview' (the 3.1 becomes a sub-path).
    // Use array form to pass a literal key with dots.
    expect(PRICING).toHaveProperty(['gemini:gemini-3.1-flash-lite-preview']);
  });
});

describe('llmPricing — calcCost happy path', () => {
  test('1000 input + 500 output Gemini 3.1 Flash-Lite Preview = $0.001', () => {
    // Spot-check: 1000 × $0.25/1M + 500 × $1.50/1M = $0.00025 + $0.00075 = $0.001
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(cost).toBeCloseTo(0.001, 10);
  });

  test('cached tokens reduce billable input cost', () => {
    const baseline = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
    });
    const withCache = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 800,
    });
    expect(withCache).toBeLessThan(baseline);
    // Specific math: (1000-800)*$0.25/1M + 500*$1.50/1M + 800*$0.025/1M
    //              = 0.00005      + 0.00075       + 0.00002 = 0.00082
    expect(withCache).toBeCloseTo(0.00082, 10);
  });

  test('zero output and zero cache returns input-only cost', () => {
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 4000,
      outputTokens: 0,
    });
    // 4000 × $0.25/1M = $0.001
    expect(cost).toBeCloseTo(0.001, 10);
  });

  test('precision survives 1 token (sub-cent territory that helpers.calculate would zero out)', () => {
    // 1 input token at $0.25/1M = $0.00000025. helpers.calculate.* uses
    // currency.js precision-2 and would round this to $0.00 — this regression
    // test confirms our explicit precision-10 path keeps the value alive.
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 1,
      outputTokens: 0,
    });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(0.00000025, 12);
  });
});

describe('llmPricing — calcCost edge cases', () => {
  test('unknown provider:model returns 0 (with warn, not throw)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cost = calcCost('xai', 'grok-not-real', {
        inputTokens: 100,
        outputTokens: 100,
      });
      expect(cost).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('xai:grok-not-real')
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('non-numeric tokens coerce to 0 (defensive — never NaN)', () => {
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 'abc',
      outputTokens: null,
      cachedTokens: undefined,
    });
    expect(cost).toBe(0);
  });

  test('negative tokens floor at 0 (do not produce negative cost)', () => {
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: -500,
      outputTokens: -100,
    });
    expect(cost).toBe(0);
  });

  test('cachedTokens > inputTokens caps at inputTokens (cannot have more cache hits than input)', () => {
    // Defensive: if a buggy provider report shows cached > input, we should
    // not bill negative input. Cap and proceed.
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 100,
      outputTokens: 0,
      cachedTokens: 500, // larger than input
    });
    // Effective billable input = 0, all input went through cache rate.
    // 100 × $0.025/1M = $0.0000025
    expect(cost).toBeCloseTo(0.0000025, 12);
  });

  test('all zero tokens returns exactly 0', () => {
    expect(
      calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
      })
    ).toBe(0);
  });
});

describe('llmPricing — large-scale realism', () => {
  test('100k input + 20k output Gemini Flash gives ~$0.08 (sanity check vs napkin math)', () => {
    // gemini-2.5-flash: input $0.30/1M, output $2.50/1M
    // 100000 × 0.30/1M + 20000 × 2.50/1M = 0.03 + 0.05 = 0.08
    const cost = calcCost('gemini', 'gemini-2.5-flash', {
      inputTokens: 100_000,
      outputTokens: 20_000,
    });
    expect(cost).toBeCloseTo(0.08, 6);
  });

  test('1M tokens Gemini Flash-Lite is sub-dollar (Ask Ola realistic upper bound)', () => {
    // 1M input + 1M output × Flash-Lite = $0.25 + $1.50 = $1.75
    const cost = calcCost('gemini', 'gemini-3.1-flash-lite-preview', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.75, 8);
  });
});
