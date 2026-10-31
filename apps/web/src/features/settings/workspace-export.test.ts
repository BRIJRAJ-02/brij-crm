import type { JobView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { exportState, HOUR_MS } from './workspace-export.ts';

const at = Date.parse('2026-10-31T10:00:00.000Z');

/** A job as the jobs store holds it. */
const job = (changes: Partial<JobView>): JobView => ({
  id: '0199f0a0-0000-7000-8000-00000000000a',
  kind: 'workspace.export',
  label: 'Export everything',
  status: 'running',
  done: 0,
  refused: 0,
  skipped: 0,
  startedBy: { type: 'member' },
  createdAt: new Date(at).toISOString(),
  cancellable: true,
  ...changes,
});

describe('exportState', () => {
  it('is none with no export job, or a cancelled one', () => {
    expect(exportState([job({ kind: 'records.export' })], at)).toEqual({ kind: 'none' });
    expect(exportState([job({ status: 'cancelled' })], at)).toEqual({ kind: 'none' });
  });

  it('runs while unfinished, and says a failure', () => {
    expect(exportState([job({ status: 'queued' })], at).kind).toBe('running');
    expect(exportState([job({ status: 'failed' })], at).kind).toBe('failed');
  });

  it('is ready for 24 hours after it finished, with its export', () => {
    const done = job({
      status: 'succeeded',
      finishedAt: new Date(at).toISOString(),
      result: { exportId: '0199f0a0-0000-7000-8000-00000000000b', rows: 3 },
    });
    expect(exportState([done], at + HOUR_MS)).toMatchObject({
      kind: 'ready',
      exportId: '0199f0a0-0000-7000-8000-00000000000b',
      expiresAt: at + 24 * HOUR_MS,
    });
    expect(exportState([done], at + 24 * HOUR_MS)).toEqual({ kind: 'none' });
  });

  it('reads the newest export job first', () => {
    const running = job({ id: '0199f0a0-0000-7000-8000-00000000000c' });
    expect(exportState([running, job({ status: 'failed' })], at)).toMatchObject({ kind: 'running', job: running });
  });
});
