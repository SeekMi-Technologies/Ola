/**
 * Pure-function tests for #266 migration helper (toRelative). The full DB
 * sweep is exercised manually via `node src/setup/migrate-...js --dry-run`
 * against Atlas. Here we verify the classification + prefix stripping logic
 * is idempotent and covers all known absolute-path shapes.
 */

const { toRelative } = require('../src/setup/migrate-file-sourcepath-relative');

describe('migrate.toRelative — #266 idempotent prefix stripping', () => {
  test('already-relative path is returned untouched', () => {
    const r = toRelative('6a03e003dcaca7e136b3fc03/2026/05/e488f9b8.wav');
    expect(r.kind).toBe('already-relative');
    expect(r.value).toBe('6a03e003dcaca7e136b3fc03/2026/05/e488f9b8.wav');
  });

  test('mac dev absolute /Users/.../backend/uploads/ is stripped', () => {
    const r = toRelative(
      '/Users/duke/Documents/GitHub/crm/backend/uploads/abc123/2026/05/9168fffc.m4a'
    );
    expect(r.kind).toBe('converted');
    expect(r.value).toBe('abc123/2026/05/9168fffc.m4a');
  });

  test('mac dev absolute /Users/.../uploads/ (no backend/) is stripped', () => {
    const r = toRelative('/Users/ziyue/work/proj/uploads/aaa/2026/05/bbb.mp3');
    expect(r.kind).toBe('converted');
    expect(r.value).toBe('aaa/2026/05/bbb.mp3');
  });

  test('Linux container absolute /usr/src/app/uploads/ is stripped', () => {
    const r = toRelative(
      '/usr/src/app/uploads/6a03e003dcaca7e136b3fc03/2026/05/e488f9b8-7798.wav.txt'
    );
    expect(r.kind).toBe('converted');
    expect(r.value).toBe('6a03e003dcaca7e136b3fc03/2026/05/e488f9b8-7798.wav.txt');
  });

  test('unknown absolute prefix is left untouched + flagged', () => {
    const r = toRelative('/mnt/some/other/path/file.mp3');
    expect(r.kind).toBe('unknown-prefix');
    expect(r.value).toBe('/mnt/some/other/path/file.mp3');
  });

  test('idempotent — running on the output of a conversion is a no-op', () => {
    const first = toRelative(
      '/Users/duke/Documents/GitHub/crm/backend/uploads/abc/2026/05/x.wav'
    );
    expect(first.kind).toBe('converted');
    const second = toRelative(first.value);
    expect(second.kind).toBe('already-relative');
    expect(second.value).toBe(first.value);
  });

  test('invalid (null / undefined / non-string) → invalid kind', () => {
    expect(toRelative(null).kind).toBe('invalid');
    expect(toRelative(undefined).kind).toBe('invalid');
    expect(toRelative(123).kind).toBe('invalid');
  });
});
