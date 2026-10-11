// Percentiles, verdicts, validity and exit codes (spec 0011, AC-199, AC-203,
// AC-212), and the rule that every time runs from the scheduled moment: a
// server that stalls for 2 seconds raises the p95 of the actions scheduled
// during the stall, even though the harness sent each one on time.
import { describe, expect, it } from 'vitest';
import { SCALE_BUDGET } from '@crm/core/scale-budget';
import { durationOf, errorCounts, exitCodeOf, formatReport, judgeValidity, reportLines } from './report.ts';
import type { LoadResult } from './result.ts';
import { percentile, summarize } from './stats.ts';
import type { Sample } from './user.ts';

const sample = (overrides: Partial<Sample> & Pick<Sample, 'metric' | 'scheduledAt' | 'answeredAt'>): Sample => ({
  user: 0,
  action: 'scroll',
  outcome: 'ok',
  measured: true,
  requests: 1,
  poolMs: [],
  appMs: [],
  ...overrides,
});

describe('percentile and summarize', () => {
  it('take the nearest rank, so every percentile is a time some action took', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([7], 95)).toBe(7);
    expect(summarize([3, 1, 2])).toEqual({ count: 3, p50: 2, p95: 3, p99: 3, max: 3 });
    expect(summarize([])).toBeUndefined();
  });
});

describe('measuring from the scheduled moment', () => {
  it('counts the time an action waited behind a stalled server, not just its own round trip', () => {
    // One read every 100 ms for 10 seconds; the server stalls from 3 to 5 seconds and then answers the queue at once.
    const samples = Array.from({ length: 100 }, (_, index) => {
      const scheduledAt = index * 100;
      const stalled = scheduledAt >= 3_000 && scheduledAt < 5_000;
      return sample({ metric: 'read', scheduledAt, answeredAt: stalled ? 5_020 : scheduledAt + 20 });
    });
    // Measured from when each was sent (on time, at its schedule) the stall would hide: every answer took 20 ms.
    const [read] = reportLines({ budget: SCALE_BUDGET, samples, poolerWaitMs: [], postgresCpuShares: [] });
    expect(read?.summary?.p50).toBe(20);
    expect(read?.summary?.p95).toBeGreaterThan(1_500);
    expect(read?.verdict).toBe('miss');
    expect(durationOf(sample({ metric: 'read', scheduledAt: 1_000, answeredAt: 1_250 }))).toBe(250);
  });
});

describe('reportLines', () => {
  const samples = [
    ...Array.from({ length: 20 }, (_, index) =>
      sample({
        metric: 'read',
        scheduledAt: 0,
        answeredAt: 100 + index,
        mode: index % 2 === 0 ? 'position' : 'cursor',
        poolMs: [1],
      }),
    ),
    sample({ metric: 'open', action: 'open', scheduledAt: 0, answeredAt: 250 }),
    sample({ metric: 'edit', action: 'edit', scheduledAt: 0, answeredAt: 90 }),
    // A refused edit is not timed as one that landed.
    sample({
      metric: 'edit',
      action: 'edit',
      scheduledAt: 0,
      answeredAt: 9_000,
      outcome: 'expected',
      reason: '409 UNIQUE_CONFLICT',
    }),
    sample({ metric: 'count', action: 'filterSort', scheduledAt: 0, answeredAt: 2_000 }),
  ];
  const lines = reportLines({
    budget: SCALE_BUDGET,
    samples,
    poolerWaitMs: [0, 0, 120],
    postgresCpuShares: [0.2, 0.3],
  });
  const line = (metric: string) => lines.find((each) => each.metric.startsWith(metric));

  it('judges read, open, edit and create at p95 against the budget', () => {
    expect(line('read (')?.verdict).toBe('pass');
    expect(line('open')?.verdict).toBe('miss');
    expect(line('open')?.target).toBe('p95 ≤ 200 ms');
    expect(line('edit')?.verdict).toBe('pass');
    expect(line('edit')?.summary?.count).toBe(1);
    expect(line('create')?.verdict).toBe('no samples');
  });

  it('notes a judged line resting on few samples, and never times a read that sent no request', () => {
    expect(line('open')?.note).toContain('only 1 samples');
    expect(line('read (')?.note).toContain('only 20 samples');
    const idle = reportLines({
      budget: SCALE_BUDGET,
      samples: [sample({ metric: 'read', scheduledAt: 0, answeredAt: 1, requests: 0 })],
      poolerWaitMs: [],
      postgresCpuShares: [],
    });
    expect(idle[0]?.verdict).toBe('no samples');
  });

  it('reports counts, and reads by mode, without judging them', () => {
    expect(line('count')).toMatchObject({ verdict: 'reported', judged: false });
    expect(line('count')?.summary?.p95).toBe(2_000);
    expect(line('read by position')?.summary?.count).toBe(10);
    expect(line('read by cursor')?.summary?.count).toBe(10);
  });

  it('judges the server: pool waits and Postgres CPU', () => {
    expect(line('API pool wait')?.verdict).toBe('pass');
    expect(line('pooler wait')?.verdict).toBe('miss');
    expect(line('Postgres CPU')).toMatchObject({ verdict: 'pass', target: 'p95 ≤ 70%' });
    expect(line('live delivery')?.verdict).toBe('not built yet');
    expect(line('relay lag')?.verdict).toBe('not built yet');
  });

  it('says why a server line has no number', () => {
    const off = reportLines({
      budget: SCALE_BUDGET,
      samples: [],
      poolerWaitMs: undefined,
      postgresCpuShares: undefined,
    });
    expect(off.find((each) => each.metric === 'Postgres CPU')?.verdict).toBe('not measured');
    expect(off.find((each) => each.metric === 'API pool wait')?.verdict).toBe('not measured');
  });
});

describe('judgeValidity and exitCodeOf', () => {
  const ok = Array.from({ length: 2_000 }, () => sample({ metric: 'read', scheduledAt: 0, answeredAt: 10 }));
  const base = { budget: SCALE_BUDGET, plannedActions: 2_000, sentActions: 2_000, eventLoopDelayP99Ms: [12, 20] };

  it('passes a run that kept up with few errors', () => {
    const validity = judgeValidity({ ...base, samples: ok });
    expect(validity).toMatchObject({ valid: true, reasons: [] });
    expect(
      exitCodeOf(
        validity,
        reportLines({ budget: SCALE_BUDGET, samples: ok, poolerWaitMs: [], postgresCpuShares: [] }),
        true,
      ),
    ).toBe(0);
  });

  it('is invalid when a harness thread stalls, or it sends under 95% of its plan', () => {
    expect(judgeValidity({ ...base, samples: ok, eventLoopDelayP99Ms: [12, 80] }).reasons.join()).toContain(
      "couldn't keep up",
    );
    expect(judgeValidity({ ...base, samples: ok, sentActions: 1_800 }).valid).toBe(false);
  });

  it('is invalid past 0.1% unexpected errors, never for expected refusals or counts it aborted', () => {
    const failing = [
      ...ok,
      sample({ metric: 'read', scheduledAt: 0, answeredAt: 10, outcome: 'unexpected', reason: '500 INTERNAL' }),
      sample({ metric: 'read', scheduledAt: 0, answeredAt: 10, outcome: 'unexpected', reason: 'timeout' }),
      sample({
        metric: 'read',
        scheduledAt: 0,
        answeredAt: 10,
        outcome: 'unexpected',
        reason: '429 TOO_MANY_REQUESTS',
      }),
    ];
    const invalid = judgeValidity({ ...base, samples: failing });
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons[0]).toContain('500 INTERNAL ×1');
    expect(exitCodeOf(invalid, [], true)).toBe(2);
    const refused = [
      ...ok,
      ...Array.from({ length: 50 }, () =>
        sample({ metric: 'edit', scheduledAt: 0, answeredAt: 10, outcome: 'expected', reason: '409 UNIQUE_CONFLICT' }),
      ),
      ...Array.from({ length: 50 }, () =>
        sample({ metric: 'count', scheduledAt: 0, answeredAt: 10, outcome: 'aborted', reason: 'aborted' }),
      ),
    ];
    expect(judgeValidity({ ...base, samples: refused }).valid).toBe(true);
    expect(errorCounts(refused)).toMatchObject({ expected: 50, abortedCounts: 50, unexpected: 0 });
    expect(errorCounts(failing).tooMany).toBe(1);
  });

  it('exits 1 on a judged miss only in a gate scenario', () => {
    const slow = [sample({ metric: 'read', scheduledAt: 0, answeredAt: 900 })];
    const lines = reportLines({ budget: SCALE_BUDGET, samples: slow, poolerWaitMs: [], postgresCpuShares: [] });
    const validity = judgeValidity({ ...base, samples: slow, plannedActions: 1, sentActions: 1 });
    expect(exitCodeOf(validity, lines, true)).toBe(1);
    expect(exitCodeOf(validity, lines, false)).toBe(0);
  });
});

describe('formatReport', () => {
  it('prints the table, the facts and the verdict', () => {
    const samples = [sample({ metric: 'read', scheduledAt: 0, answeredAt: 120 })];
    const lines = reportLines({ budget: SCALE_BUDGET, samples, poolerWaitMs: undefined, postgresCpuShares: undefined });
    const validity = judgeValidity({
      budget: SCALE_BUDGET,
      samples,
      plannedActions: 1,
      sentActions: 1,
      eventLoopDelayP99Ms: [10],
    });
    const result: LoadResult = {
      scenario: 'steady',
      gate: true,
      users: 100,
      minutes: 10,
      warmupSeconds: 60,
      seed: 1,
      startedAt: '2026-10-12T00:00:00.000Z',
      endedAt: '2026-10-12T00:11:00.000Z',
      facts: {
        gitCommit: 'abc',
        hostModel: 'MacBookPro18,3',
        hostCores: 8,
        hostMemoryBytes: 16 * 1024 ** 3,
        stackCaps: { postgres: { cpus: 2, memoryBytes: 8 * 1024 ** 3 } },
        manifestCounts: { people: { stored: 600_000, live: 594_000 } },
        manifestProfile: 'crm',
        apiUrl: 'http://localhost:3100',
        threads: 1,
      },
      lines: [...lines],
      mix: { budget: SCALE_BUDGET.load.mix, achieved: SCALE_BUDGET.load.mix, deviationPoints: 0 },
      errors: {},
      validity,
      exitCode: exitCodeOf(validity, lines, true),
    };
    const text = formatReport(result);
    expect(text).toContain('metric');
    expect(text).toMatch(
      /read \(scroll, filter or sort windows\)\s+p95 ≤ 300 ms\s+120\.0\s+120\.0\s+120\.0\s+120\.0\s+1\s+PASS/,
    );
    expect(text).toContain('NOT BUILT YET');
    expect(text).toContain('postgres 2 CPU/8.0 GB');
    expect(text).toContain('VALID. Exit 0');
  });
});
