// The relay's delivery numbers (spec 0007, AC-77): lag percentiles over a
// rolling 5 minute window, and what workspaces still hold unpublished.
import { describe, expect, it } from 'vitest';
import { createRelayStats } from './stats.ts';

describe('the relay stats', () => {
  it('reports nothing before anything is published or waiting', () => {
    expect(createRelayStats({ now: () => 0 }).snapshot()).toEqual({
      published: 0,
      lagMs: undefined,
      pending: 0,
      oldestPendingMs: undefined,
    });
  });

  it('gives p50, p95 and max over the window, forgetting what is older', () => {
    let time = 0;
    const stats = createRelayStats({ now: () => time });
    stats.published(Array.from({ length: 100 }, (_, n) => n + 1));
    expect(stats.snapshot()).toMatchObject({ published: 100, lagMs: { p50: 50, p95: 95, max: 100 } });
    time = 4 * 60_000;
    stats.published([1_000]);
    expect(stats.snapshot()).toMatchObject({ published: 101, lagMs: { max: 1_000 } });
    time = 5 * 60_000 + 1;
    expect(stats.snapshot()).toMatchObject({ published: 1, lagMs: { p50: 1_000, p95: 1_000, max: 1_000 } });
  });

  it('keeps at most the newest samples it is allowed', () => {
    const stats = createRelayStats({ now: () => 0, maxSamples: 10 });
    stats.published(Array.from({ length: 25 }, (_, n) => n));
    expect(stats.snapshot()).toMatchObject({ published: 10, lagMs: { p50: 19, max: 24 } });
  });

  it('adds up what workspaces still hold, and the oldest commit’s age', () => {
    const now = Date.parse('2026-10-08T09:00:10.000Z');
    const stats = createRelayStats({ now: () => now });
    stats.pending('a', 100, '2026-10-08T09:00:00.000Z');
    stats.pending('b', 5, '2026-10-08T09:00:08.000Z');
    expect(stats.snapshot()).toMatchObject({ pending: 105, oldestPendingMs: 10_000 });
    stats.pending('a', 0);
    expect(stats.snapshot()).toMatchObject({ pending: 5, oldestPendingMs: 2_000 });
  });
});
