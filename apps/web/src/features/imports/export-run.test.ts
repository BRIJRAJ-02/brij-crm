import { describe, expect, it } from 'vitest';
import { exportOutcome, isOverExportLimit } from './export-run.ts';

describe('isOverExportLimit', () => {
  it('blocks only an exact count past 100,000', () => {
    expect(isOverExportLimit(undefined)).toBe(false);
    expect(isOverExportLimit({ count: 100_000, atLeast: false })).toBe(false);
    expect(isOverExportLimit({ count: 100_001, atLeast: false })).toBe(true);
    // A floor ("10,000+") can't say: the server refuses with the count.
    expect(isOverExportLimit({ count: 10_000, atLeast: true })).toBe(false);
  });
});

describe('exportOutcome', () => {
  it('is working until the job is held and ends', () => {
    expect(exportOutcome(undefined)).toBe('working');
    expect(exportOutcome({ status: 'running' })).toBe('working');
    expect(exportOutcome({ status: 'queued' })).toBe('working');
  });

  it('is ready once it succeeds', () => {
    expect(exportOutcome({ status: 'succeeded', result: { exportId: 'e' } })).toBe('ready');
  });

  it('is failed when it fails or is cancelled', () => {
    expect(exportOutcome({ status: 'failed' })).toBe('failed');
    expect(exportOutcome({ status: 'cancelled' })).toBe('failed');
  });
});
