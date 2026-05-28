const { collapseJobStatus } = require('@/utils/collapseJobStatus');

describe('collapseJobStatus', () => {
  test('null (no Job) → ready (file has no transcription job)', () => {
    expect(collapseJobStatus(null)).toBe('ready');
    expect(collapseJobStatus(undefined)).toBe('ready');
  });

  test("status='done' → done", () => {
    expect(collapseJobStatus({ status: 'done' })).toBe('done');
  });

  test("status='failed' → failed", () => {
    expect(collapseJobStatus({ status: 'failed' })).toBe('failed');
  });

  test("status='pending' → processing", () => {
    expect(collapseJobStatus({ status: 'pending' })).toBe('processing');
  });

  test("status='running' → processing", () => {
    expect(collapseJobStatus({ status: 'running' })).toBe('processing');
  });

  test('unknown status defensive fallback → processing', () => {
    expect(collapseJobStatus({ status: 'mystery' })).toBe('processing');
  });
});
