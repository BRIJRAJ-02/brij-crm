// The global lock order (spec 0066, Rules settled: Locks): rotation, then place, then person locks sorted, where a
// linked staff member's person lock is the host key meetings take. Held two ways: the keys `lockVisit` takes, in the
// order it takes them; and a scan of the source, so no path takes a visit lock another way, or a rotation lock
// after one.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { WorkspaceTx } from '@crm/db';
import { describe, expect, it } from 'vitest';
import { hostLockKey } from '../booking/locks.ts';
import { lockVisit, personLockKeys, placeLockKey, staffLockKey } from './locks.ts';

const WS = '01a1a2f2-0000-7000-8000-000000000001';
const PLACE = '01a1a2f2-0000-7000-8000-0000000000aa';

/** A transaction that records each advisory lock key it is asked for, in order. */
function recordingTx(): { readonly tx: WorkspaceTx; readonly keys: string[] } {
  const keys: string[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: (query: SQL) => {
      const { params } = dialect.sqlToQuery(query);
      for (const param of params) if (typeof param === 'string') keys.push(param);
      return Promise.resolve({ rows: [] });
    },
  } as unknown as WorkspaceTx;
  return { tx, keys };
}

describe('lockVisit', () => {
  it('takes the place lock, then each person once, sorted; a linked staff member by their member’s host key', async () => {
    const { tx, keys } = recordingTx();
    await lockVisit(tx, WS, PLACE, [
      { id: 'staff-b' },
      { id: 'staff-a', memberId: 'member-z' },
      { id: 'staff-b' },
      { id: 'staff-c', memberId: 'member-a' },
    ]);
    expect(keys).toEqual([
      placeLockKey(WS, PLACE),
      hostLockKey(WS, 'member-a'),
      hostLockKey(WS, 'member-z'),
      staffLockKey(WS, 'staff-b'),
    ]);
    expect(keys).toEqual([keys[0], ...[...keys.slice(1)].sort()]);
  });

  it('names one person lock per person, the one meetings take for a linked member', () => {
    expect(personLockKeys(WS, [{ id: 's1', memberId: 'm1' }])).toEqual([`booking:host:${WS}:m1`]);
    expect(personLockKeys(WS, [{ id: 's1', memberId: null }])).toEqual([`visits:staff:${WS}:s1`]);
  });
});

/** Every TypeScript source file under `src`, tests left out. */
async function sources(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return Promise.resolve(entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

describe('no path takes the visit locks another way (a guards test)', () => {
  it('builds the place and staff keys only in visits/locks.ts, and takes them only through lockVisit', async () => {
    const root = join(import.meta.dirname, '..');
    const files = await sources(root);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const relative = file.slice(root.length + 1);
      if (relative === join('visits', 'locks.ts')) continue;
      if (/visits:(place|staff):/.test(text)) offenders.push(`${relative}: builds a visit lock key`);
      if (/\b(placeLockKey|staffLockKey)\b/.test(text))
        offenders.push(`${relative}: takes a visit lock outside lockVisit`);
      // A file that takes the visit locks never takes a rotation lock (always before) or a host lock on its own.
      if (/\blockVisit\(/.test(text) && /\b(lockRotations?|lockHosts)\(|hostLockKey\(/.test(text)) {
        offenders.push(`${relative}: mixes the visit locks with rotation or host locks`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
