// The one write path (spec 0005, AC-39): `commitWrite` hands the engine the
// outbox hook with the mutation id, and pokes the relay only once the write
// has committed, never for a refused one.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createRecord, createWorkspace, newId } from '@crm/core';
import { testScope } from '@crm/core/testing';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { commitWrite } from './hooks.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-hooks-tests' });
});
afterAll(async () => {
  await db.close();
});

describe('commitWrite', () => {
  it('stores one outbox row per write with the mutation id, pokes after the commit, and neither for a refused one', async () => {
    const created = await createWorkspace(db, {
      name: 'Hooks',
      slug: `hooks-${newId().slice(-12)}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
    const people = created.objects.people ?? '';
    const stored = () =>
      testQuery<{ seq: number; record_ids: string[]; mutation_id: string }>(
        ownerUrl,
        'select seq::int as seq, record_ids, mutation_id from outbox where workspace_id = $1 order by seq',
        [created.workspaceId],
      );
    // What another connection sees at the moment of each poke: the poke must come after the commit.
    const seenAtPoke: number[] = [];
    let pokes = 0;
    const context = {
      wakeRelay: () => {
        pokes += 1;
        void stored().then((rows) => seenAtPoke.push(rows.length));
      },
    };
    const mutationId = newId();
    const { recordId } = await commitWrite(context, { mutationId }, (hooks) =>
      createRecord(scope, { objectId: people }, hooks),
    );
    await expect(
      commitWrite(context, { mutationId: newId() }, (hooks) => createRecord(scope, { objectId: newId() }, hooks)),
    ).rejects.toThrow();
    expect(await stored()).toEqual([{ seq: 1, record_ids: [recordId], mutation_id: mutationId }]);
    expect(pokes).toBe(1);
    await expect.poll(() => seenAtPoke).toEqual([1]);
  });
});
