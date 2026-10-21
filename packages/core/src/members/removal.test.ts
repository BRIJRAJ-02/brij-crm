// The removal guard (spec 0031, AC-814; spec 0037, AC-1440): every foreign
// key to `members` is looked after by a feature's removal effect or kept on
// purpose with a reason, so a new table that names a member can't be
// forgotten when that member is removed. Actor columns (who created, updated
// or removed a row) are history by their names and are excepted.
import { describe, expect, inject, it } from 'vitest';
import { testQuery } from '@crm/db/testing';
import { KEPT_ON_REMOVAL, REMOVAL_EFFECTS } from './removal.ts';

const { ownerUrl } = inject('testDatabase');

/** An actor column's key: who created, updated or removed a row, or an audit row's actor. */
const ACTOR_KEY = /(_created_by|_updated_by|_removed_by|_actor|_actor_member)$/;

async function memberKeys(): Promise<string[]> {
  const rows = await testQuery<{ key: string }>(
    ownerUrl,
    `select c.conname as key
     from pg_constraint c
     where c.contype = 'f' and c.confrelid = 'public.members'::regclass
     order by 1`,
  );
  return rows.map((row) => row.key);
}

describe('a removal looks after every foreign key to members', () => {
  it('has an effect or a kept reason for each one', async () => {
    const handled = new Set([
      ...REMOVAL_EFFECTS.flatMap((effect) => effect.constraints),
      ...Object.keys(KEPT_ON_REMOVAL),
    ]);
    const forgotten = (await memberKeys()).filter((key) => !ACTOR_KEY.test(key) && !handled.has(key));
    expect(forgotten).toEqual([]);
  });

  it('names no key that no longer exists', async () => {
    const keys = new Set(await memberKeys());
    const named = [...REMOVAL_EFFECTS.flatMap((effect) => effect.constraints), ...Object.keys(KEPT_ON_REMOVAL)];
    expect(named.filter((key) => !keys.has(key))).toEqual([]);
  });

  it('gives each effect a feature name, once', () => {
    const features = REMOVAL_EFFECTS.map((effect) => effect.feature);
    expect(new Set(features).size).toBe(features.length);
  });
});
