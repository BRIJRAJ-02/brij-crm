// Record merge at the API (spec 0049, AC-4914, AC-4917, AC-4919): the
// preview, the merge answering the kept record with its echoes, the merged
// address leading on through records.getTrashed, the statuses each refusal
// travels with, and a member who may only read the object refused before any
// record is looked up. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type AccessRules, type RuleSource } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>("select current_setting('app.workspace_id', true) as id");
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? { levels: [], records: [] };
};

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { rules }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

async function person(m: Member, firstName: string): Promise<string> {
  const id = newId();
  await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id,
    values: { [m.attribute('name')]: { firstName, lastName: 'Doe' } },
    mutationId: newId(),
  });
  return id;
}

describe('records.mergePreview and records.merge', () => {
  it('previews, merges into the kept record, and leads the merged address on (AC-4914, AC-4916)', async () => {
    const m = await memberWithWorkspace(app);
    const jane = await person(m, 'Jane');
    const janeD = await person(m, 'Jane D.');
    const pair = { workspace: m.slug, objectId: m.people.id, keepId: jane, mergeId: janeD };
    const preview = await m.client.records.mergePreview(pair);
    expect(preview.rows.map((row) => row.attributeId)).toEqual([m.attribute('name')]);
    expect(preview.moved).toEqual({ links: 0, entries: 0, items: 0, notes: 0 });
    const merged = await m.client.records.merge({
      ...pair,
      picks: { [m.attribute('name')]: 'merge' },
      revisions: { keep: preview.keep.revision, merge: preview.merge.revision },
      mutationId: newId(),
    });
    expect(merged.record.display.name).toBe('Jane D. Doe');
    expect(merged.mergedId).toBe(janeD);
    expect(merged.echoes).toBe(1);
    expect(await m.client.records.get({ workspace: m.slug, ids: [janeD] })).toEqual([]);
    const trashed = await m.client.records.getTrashed({ workspace: m.slug, recordId: janeD });
    expect(trashed.mergedInto).toMatchObject({ recordId: jane, display: { name: 'Jane D. Doe' } });
  });

  it('refuses a stale dialog 409, the same record 400, and a missing one 404 (AC-4917)', async () => {
    const m = await memberWithWorkspace(app);
    const jane = await person(m, 'Jane');
    const janeD = await person(m, 'Jane D.');
    const pair = { workspace: m.slug, objectId: m.people.id, keepId: jane, mergeId: janeD };
    const stale = await m.client.records.mergePreview(pair);
    await m.client.records.setValues({
      workspace: m.slug,
      recordId: janeD,
      values: { [m.attribute('job_title')]: { value: 'CTO' } },
      mutationId: newId(),
    });
    const revisions = { keep: stale.keep.revision, merge: stale.merge.revision };
    expect(await refusal(() => m.client.records.merge({ ...pair, revisions, mutationId: newId() }))).toEqual({
      code: 'CONFLICT',
      status: 409,
      message: 'Jane D. Doe changed while you were merging. Review it again.',
    });
    expect(
      await refusal(() => m.client.records.merge({ ...pair, mergeId: jane, revisions, mutationId: newId() })),
    ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(await refusal(() => m.client.records.mergePreview({ ...pair, mergeId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('refuses a member who may only read People 403, saying nothing of the records (AC-4919)', async () => {
    const m = await memberWithWorkspace(app);
    const jane = await person(m, 'Jane');
    const janeD = await person(m, 'Jane D.');
    rulesByWorkspace.set(m.workspace.id, {
      levels: [
        { subject: { type: 'role', role: 'owner' }, target: { type: 'object', objectId: m.people.id }, level: 'read' },
      ],
      records: [],
    });
    const pair = { workspace: m.slug, objectId: m.people.id, keepId: jane, mergeId: janeD };
    const forbidden = await refusal(() =>
      m.client.records.merge({ ...pair, revisions: { keep: 0, merge: 0 }, mutationId: newId() }),
    );
    expect(forbidden).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    // The same answer for a record that doesn't exist: the refusal comes before any record is read.
    expect(
      await refusal(() =>
        m.client.records.merge({ ...pair, mergeId: newId(), revisions: { keep: 0, merge: 0 }, mutationId: newId() }),
      ),
    ).toEqual(forbidden);
    rulesByWorkspace.delete(m.workspace.id);
  });
});
