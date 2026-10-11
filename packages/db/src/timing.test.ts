// The checkout timing behind the API's load header (spec 0011, AC-202): each
// checkout reports its wait and its hold to the sink named when it started,
// a wait behind a busy pool shows as a wait, and no timing function leaves
// the pool alone.
import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDatabase } from './client.ts';
import type { PoolTimingSink } from './timing.ts';

const { appUrl } = inject('testDatabase');

/** A sink that keeps what it hears. */
function recorder() {
  const waits: number[] = [];
  const holds: number[] = [];
  const sink: PoolTimingSink = { waited: (ms) => waits.push(ms), held: (ms) => holds.push(ms) };
  return { sink, waits, holds };
}

describe('a timed pool', () => {
  it('reports each checkout’s wait and hold to the sink current when it started', async () => {
    const first = recorder();
    const second = recorder();
    let current: PoolTimingSink | undefined = first.sink;
    const db = createDatabase({ url: appUrl, applicationName: 'crm-timing-tests', timing: () => current });
    try {
      await db.checkHealth();
      await db.withWorkspace('00000000-0000-7000-8000-000000000000', (tx) => tx.execute(sql`select pg_sleep(0.05)`));
      current = second.sink;
      await db.checkHealth();
      current = undefined;
      await db.checkHealth();
      expect(first.waits).toHaveLength(2);
      expect(first.holds).toHaveLength(2);
      // The transaction held its client through its 50 ms statement.
      expect(first.holds[1]).toBeGreaterThanOrEqual(45);
      expect(second.waits).toHaveLength(1);
      expect(second.holds).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it('counts the time a checkout queued behind a full pool as its wait', async () => {
    const queued = recorder();
    const db = createDatabase({
      url: appUrl,
      applicationName: 'crm-timing-tests',
      maxConnections: 1,
      timing: () => queued.sink,
    });
    try {
      const busy = db.withWorkspace('00000000-0000-7000-8000-000000000000', (tx) =>
        tx.execute(sql`select pg_sleep(0.2)`),
      );
      // Give the first checkout the one client before the second asks.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await Promise.all([busy, db.checkHealth()]);
      expect(Math.max(...queued.waits)).toBeGreaterThanOrEqual(120);
    } finally {
      await db.close();
    }
  });
});
