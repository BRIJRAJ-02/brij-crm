// The hub clear bench's pure parts (spec 0011, AC-214): times by the nearest
// rank, the writes beside the clear, and the refusals counted by code. The
// bench itself runs against the test seed in seed-crm.test.ts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatBench, summarizeWrites, timesOf } from './bench-hub-clear.ts';

describe('timesOf', () => {
  it('takes the nearest rank, so every percentile is a time some write took', () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(timesOf(values)).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(timesOf([])).toBeUndefined();
  });
});

describe('summarizeWrites', () => {
  it('times the writes that answered, picks those beside the clear, and counts the rest by code', () => {
    const clear = { start: 1_000, end: 2_000 };
    const summary = summarizeWrites(
      [
        { scheduledAt: 0, answeredAt: 50, outcome: 'ok' },
        { scheduledAt: 900, answeredAt: 1_500, outcome: 'ok' },
        { scheduledAt: 1_500, answeredAt: 2_600, outcome: 'ok' },
        { scheduledAt: 2_100, answeredAt: 2_150, outcome: 'ok' },
        { scheduledAt: 1_200, answeredAt: 3_000, outcome: 'QUERY_CANCELLED' },
        { scheduledAt: 1_300, answeredAt: 1_400, outcome: 'error' },
      ],
      clear,
    );
    expect(summary.writes).toMatchObject({ count: 4, max: 1_100 });
    expect(summary.beside).toMatchObject({ count: 2, p50: 600, max: 1_100 });
    expect(summary.outOfRetries).toBe(1);
    expect(summary.failed).toEqual({ QUERY_CANCELLED: 1, error: 1 });
    const printed = formatBench({
      team: 7_425,
      clearMs: 812,
      ...summary,
      walBytes: 3 * 1024 ** 2,
      clearLoopMs: { p99: 12.5, max: 40 },
      restoreMs: 4_000,
      restored: 7_431,
    });
    expect(printed).toContain("clear of the hub's Team (7,425 links, one write): 812 ms");
    expect(printed).toContain('out of retries (runWrite): 1');
    expect(printed).toContain('stalled up to 40.0 ms (p99 12.5 ms) during the clear');
    expect(printed).toContain('QUERY_CANCELLED ×1, error ×1');
  });
});

describe('pnpm load:bench-hub-clear', () => {
  it('refuses a remote owner database with exit 3, before it reads anything', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./bench-hub-clear.ts', import.meta.url))], {
      env: { PATH: process.env.PATH ?? '', LOAD_DATABASE_URL_OWNER: 'postgres://crm_owner:x@db.example.com:5434/crm' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(3);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing LOAD_DATABASE_URL_OWNER');
  });
});
