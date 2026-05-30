import { describe, test, expect } from 'vitest';
import en from '../en';
import zh from '../zh';

describe('translation dict parity (en ↔ zh)', () => {
  test('zh contains every key in en (no missing translations)', () => {
    const missing = Object.keys(en).filter((k) => !(k in zh));
    expect(missing).toEqual([]);
  });

  test('zh has no keys absent from en (no orphan translations)', () => {
    const orphans = Object.keys(zh).filter((k) => !(k in en));
    expect(orphans).toEqual([]);
  });

  test('all zh values are non-empty strings', () => {
    const bad = Object.entries(zh).filter(
      ([, v]) => typeof v !== 'string' || v.length === 0
    );
    expect(bad).toEqual([]);
  });

  test('all en values are non-empty strings', () => {
    const bad = Object.entries(en).filter(
      ([, v]) => typeof v !== 'string' || v.length === 0
    );
    expect(bad).toEqual([]);
  });

  test('zh values must not be identical to en values for the same key (anti-skeleton drift)', () => {
    // Allowed exceptions: pure math expressions / brand symbols that read
    // identically across languages. If this fires for a real key, either
    // translate it or add it here with a one-line WHY.
    const ALLOWED = new Set([
      'TRSell + TTB - TExp',   // math formula (Expected Gross Profit)
      'EGP / TRSell',          // math formula (Expected GP Margin)
      'file_kind_pdf',         // brand acronym, universally PDF in both languages
    ]);
    const stillEnglish = Object.keys(en).filter(
      (k) => !ALLOWED.has(k) && zh[k] === en[k]
    );
    expect(stillEnglish).toEqual([]);
  });
});
