// The one write composer (spec 0005, AC-39): the hooks every write procedure
// runs include the outbox hook, carrying the input's mutation id.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createRecord, createWorkspace, newId, type EngineScope } from '@crm/core';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { writeHooks } from './hooks.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-hooks-tests' });
});
afterAll(async () => {
  await db.close();
});

describe('writeHooks', () => {
  it('stores one outbox row per write, with the mutation id, and none for a refused one', async () => {
    const created = await createWorkspace(db, {
      name: 'Hooks',
      slug: `hooks-${newId().slice(-12)}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const scope: EngineScope = {
      db,
      workspaceId: created.workspaceId,
      actor: { type: 'member', id: created.memberId },
    };
    const people = created.objects.people ?? '';
    const mutationId = newId();
    const { recordId } = await createRecord(scope, { objectId: people }, writeHooks({ requestId: 'test' }, { mutationId }));
    await expect(
      createRecord(scope, { objectId: newId() }, writeHooks({ requestId: 'test' }, { mutationId: newId() })),
    ).rejects.toThrow();
    const rows = await testQuery<{ seq: number; record_ids: string[]; mutation_id: string }>(
      ownerUrl,
      'select seq::int as seq, record_ids, mutation_id from outbox where workspace_id = $1 order by seq',
      [created.workspaceId],
    );
    expect(rows).toEqual([{ seq: 1, record_ids: [recordId], mutation_id: mutationId }]);
  });
});
