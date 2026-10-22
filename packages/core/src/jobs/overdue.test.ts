// Which jobs a read calls overdue (spec 0008, The wake call; spec 0045): a
// queued job past its time, and a running job no slice holds, whether it was
// handed over at a turn's end or its slice's lease ran out. Pure, no database.
import { describe, expect, it } from 'vitest';
import { isOverdue, OVERDUE_MS } from './service.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms);
const row = (overrides: Partial<Parameters<typeof isOverdue>[0]>): Parameters<typeof isOverdue>[0] => ({
  status: 'queued',
  runAt: ago(0),
  leaseUntil: null,
  updatedAt: ago(0),
  ...overrides,
});

describe('isOverdue', () => {
  it('calls a queued job overdue only once it is OVERDUE_MS past its time', () => {
    expect(isOverdue(row({ runAt: ago(OVERDUE_MS - 1) }), NOW)).toBe(false);
    expect(isOverdue(row({ runAt: ago(OVERDUE_MS + 1) }), NOW)).toBe(true);
    // A future reminder isn't overdue.
    expect(isOverdue(row({ runAt: new Date(NOW + 60_000) }), NOW)).toBe(false);
  });

  it('calls a handed over running job overdue once nothing claimed it for OVERDUE_MS', () => {
    const handed = { status: 'running' as const, runAt: ago(60_000), leaseUntil: null };
    expect(isOverdue(row({ ...handed, updatedAt: ago(1_000) }), NOW)).toBe(false);
    expect(isOverdue(row({ ...handed, updatedAt: ago(OVERDUE_MS + 1) }), NOW)).toBe(true);
  });

  it('leaves a running job waiting for its retry alone until the retry is due', () => {
    const retrying = row({ status: 'running', runAt: new Date(NOW + 30_000), updatedAt: ago(60_000) });
    expect(isOverdue(retrying, NOW)).toBe(false);
  });

  it('calls a running job overdue when its lease ran out, and not while a slice holds it', () => {
    const running = { status: 'running' as const, runAt: ago(120_000), updatedAt: ago(120_000) };
    expect(isOverdue(row({ ...running, leaseUntil: new Date(NOW + 30_000) }), NOW)).toBe(false);
    expect(isOverdue(row({ ...running, leaseUntil: ago(1_000) }), NOW)).toBe(false);
    expect(isOverdue(row({ ...running, leaseUntil: ago(OVERDUE_MS + 1) }), NOW)).toBe(true);
  });

  it('never calls a finished or waiting job overdue', () => {
    for (const status of ['preparing', 'ready', 'succeeded', 'failed', 'cancelled'] as const) {
      expect(isOverdue(row({ status, runAt: ago(60_000), updatedAt: ago(60_000) }), NOW)).toBe(false);
    }
  });
});
