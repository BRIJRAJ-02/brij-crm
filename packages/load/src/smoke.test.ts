// The weekly smoke's verdict (spec 0011, AC-211): budget misses are warnings,
// an invalid run or a crash fails the workflow.
import { describe, expect, it } from 'vitest';
import { SCALE_BUDGET } from '@crm/core/scale-budget';
import type { LoadResult, ReportLine } from './result.ts';
import { smokeSummary, smokeVerdict } from './smoke.ts';

const line = (metric: string, verdict: ReportLine['verdict'], judged = true): ReportLine => ({
  metric,
  target: 'p95 ≤ 300 ms',
  unit: 'ms',
  summary: { count: 400, p50: 40, p95: verdict === 'miss' ? 812.5 : 120, p99: 900, max: 1_000 },
  verdict,
  judged,
});

function result(lines: readonly ReportLine[], reasons: readonly string[] = []): LoadResult {
  return {
    scenario: 'steady',
    gate: true,
    users: 20,
    minutes: 2,
    warmupSeconds: 60,
    seed: 1,
    startedAt: '2026-10-12T00:00:00.000Z',
    endedAt: '2026-10-12T00:03:00.000Z',
    facts: {
      gitCommit: 'abc',
      hostModel: 'runner',
      hostCores: 4,
      hostMemoryBytes: 16 * 1024 ** 3,
      stackCaps: {},
      manifestCounts: {},
      manifestProfile: 'smoke',
      apiUrl: 'http://localhost:3100',
      threads: 1,
    },
    lines: [...lines],
    mix: { budget: SCALE_BUDGET.load.mix, achieved: SCALE_BUDGET.load.mix, deviationPoints: 0 },
    errors: {},
    validity: {
      valid: reasons.length === 0,
      reasons: [...reasons],
      plannedActions: 480,
      sentActions: 480,
      eventLoopDelayP99Ms: [10],
      unexpectedShare: 0,
    },
    exitCode: reasons.length === 0 ? 1 : 2,
  };
}

describe('smokeVerdict', () => {
  it('passes a valid run, with a warning for each judged miss', () => {
    const verdict = smokeVerdict(
      1,
      result([
        line('read (scroll, filter or sort windows)', 'miss'),
        line('edit', 'pass'),
        line('count', 'miss', false),
      ]),
    );
    expect(verdict.exitCode).toBe(0);
    expect(verdict.annotations).toEqual([
      '::warning title=Budget miss%3A read (scroll%2C filter or sort windows)::read (scroll, filter or sort windows): p95 812.5 against p95 ≤ 300 ms (shared runner times are a direction only)',
    ]);
    expect(smokeVerdict(0, result([line('edit', 'pass')]))).toEqual({ annotations: [], exitCode: 0 });
  });

  it('fails an invalid run with its reasons, and a crash or a refused setup with its code', () => {
    const invalid = smokeVerdict(2, result([], ['unexpected errors were 2.000% of actions']));
    expect(invalid.exitCode).toBe(2);
    expect(invalid.annotations[0]).toMatch(/^::error title=Load smoke invalid::unexpected errors/);
    expect(smokeVerdict(3, undefined).exitCode).toBe(3);
    expect(smokeVerdict(-1, undefined).exitCode).toBe(1);
    expect(smokeVerdict(0, undefined).exitCode).toBe(1);
  });
});

describe('smokeSummary', () => {
  it("writes the run's lines as a Markdown table", () => {
    const text = smokeSummary(result([line('edit', 'pass')]));
    expect(text).toContain('### Load smoke: steady, 20 users, 2 minutes');
    expect(text).toContain('| edit | p95 ≤ 300 ms | 40 | 120 | 400 | pass |');
  });
});
