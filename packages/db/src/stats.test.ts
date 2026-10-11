// The server's own numbers for the load harness (spec 0011, AC-201, AC-204):
// the clock, the WAL written, and statements, which answer "unavailable"
// rather than failing where pg_stat_statements isn't loaded (as on the dev
// Postgres; the load stack preloads it).
import { describe, expect, inject, it } from 'vitest';
import { openServerStats } from './stats.ts';

const { ownerUrl } = inject('testDatabase');

describe('openServerStats', () => {
  it('reads the database clock, the WAL written, and statements where they are kept', async () => {
    const stats = await openServerStats({ url: ownerUrl, applicationName: 'crm-stats-tests' });
    try {
      const before = Date.now();
      const clock = await stats.clock();
      // The same machine: within a second of ours.
      expect(Math.abs(clock - before)).toBeLessThan(1_000);
      expect(await stats.walBytes()).toBeGreaterThan(0);
      const reset = await stats.resetStatements();
      const top = await stats.topStatements(10);
      if (reset) expect(top).toBeDefined();
      else expect(top === undefined || Array.isArray(top)).toBe(true);
    } finally {
      await stats.close();
    }
  });
});
