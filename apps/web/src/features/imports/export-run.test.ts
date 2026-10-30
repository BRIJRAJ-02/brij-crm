import { describe, expect, it } from 'vitest';
import { exportOutcome } from './export-run.ts';

describe('exportOutcome', () => {
  it('is working until the job is held and ends', () => {
    expect(exportOutcome(undefined)).toBe('working');
    expect(exportOutcome({ status: 'running' })).toBe('working');
    expect(exportOutcome({ status: 'queued' })).toBe('working');
  });

  it('is ready once it succeeds, or changed when records moved under it', () => {
    expect(exportOutcome({ status: 'succeeded', result: { exportId: 'e' } })).toBe('ready');
    expect(exportOutcome({ status: 'succeeded', result: { changedWhileWritten: true } })).toBe('changed');
  });

  it('is failed when it fails or is cancelled', () => {
    expect(exportOutcome({ status: 'failed' })).toBe('failed');
    expect(exportOutcome({ status: 'cancelled' })).toBe('failed');
  });
});
