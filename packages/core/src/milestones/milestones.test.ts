// The milestones a workspace reaches once (spec 0010, AC-175 to AC-177),
// against a real Postgres as the app role: the first record a member makes
// reaches `first_record_created` in its own transaction, once; the system's
// records, refused creates and later records reach nothing; and a rolled
// back write leaves no milestone behind.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { defineObject } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { milestoneHook, type ReachedMilestone } from './milestones.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-milestone-tests' });
});
afterAll(async () => {
  await db.close();
});

/** A workspace made the way seeds make one, its member's scope, and the system's. */
async function workspace() {
  const created = await createWorkspace(db, {
    name: 'Milestones',
    slug: `milestones-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const member = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const companies = created.objects.companies ?? '';
  return { ...created, member, system, companies };
}

/** The hook, and what it said on its last run. */
function listening() {
  const runs: (readonly ReachedMilestone[])[] = [];
  return { hook: milestoneHook((reached) => runs.push(reached)), runs, last: () => runs.at(-1) };
}

/** The milestones stored for a workspace, read inside it. */
async function stored(workspaceId: string) {
  const rows = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ milestone: string }>(sql`select milestone from workspace_milestones order by milestone`),
  );
  return rows.rows.map((row) => row.milestone);
}

describe('first_record_created', () => {
  it('is reached by the first record a member makes, once, with the kind of its object', async () => {
    const w = await workspace();
    const first = listening();
    await createRecord(w.member, { objectId: w.companies }, [first.hook]);
    expect(first.last()).toEqual([
      {
        milestone: 'first_record_created',
        workspaceId: w.workspaceId,
        reachedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) as string,
        objectKind: 'companies',
      },
    ]);
    const second = listening();
    await createRecord(w.member, { objectId: w.companies }, [second.hook]);
    expect(second.runs).toEqual([[]]);
    expect(await stored(w.workspaceId)).toEqual(['first_record_created']);
  });

  it('names a custom object custom', async () => {
    const w = await workspace();
    const { objectId } = await defineObject(w.member, {
      apiSlug: 'projects',
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'green',
    });
    const first = listening();
    await createRecord(w.member, { objectId }, [first.hook]);
    expect(first.last()?.[0]).toMatchObject({ milestone: 'first_record_created', objectKind: 'custom' });
  });

  it('is never reached by a record the system makes, nor by a write that creates no record', async () => {
    const w = await workspace();
    const bySystem = listening();
    await createRecord(w.system, { objectId: w.companies }, [bySystem.hook]);
    expect(bySystem.runs).toEqual([[]]);
    const noRecord = listening();
    await defineObject(
      w.member,
      { apiSlug: 'things', singularName: 'Thing', pluralName: 'Things', icon: 'box', hue: 'gray' },
      [noRecord.hook],
    );
    expect(noRecord.runs).toEqual([[]]);
    // Workspace setup made objects and no record: nothing reached.
    expect(await stored(w.workspaceId)).toEqual([]);
  });

  it('stores nothing for a refused create, or for a write a later step rolls back', async () => {
    const w = await workspace();
    const refused = listening();
    await expect(createRecord(w.member, { objectId: newId() }, [refused.hook])).rejects.toThrow();
    expect(refused.runs).toEqual([]);
    const rolledBack = listening();
    const failing = () => Promise.reject(new Error('forced'));
    await expect(createRecord(w.member, { objectId: w.companies }, [rolledBack.hook, failing])).rejects.toThrow(
      'forced',
    );
    expect(await stored(w.workspaceId)).toEqual([]);
    // So the next record is still the first.
    const next = listening();
    await createRecord(w.member, { objectId: w.companies }, [next.hook]);
    expect(next.last()).toHaveLength(1);
  });

  it('is reached once when three creates commit at the same moment', async () => {
    const w = await workspace();
    const listeners = [listening(), listening(), listening()];
    await Promise.all(listeners.map(({ hook }) => createRecord(w.member, { objectId: w.companies }, [hook])));
    expect(listeners.map(({ last }) => last()?.length).sort()).toEqual([0, 0, 1]);
    expect(await stored(w.workspaceId)).toEqual(['first_record_created']);
  });
});
