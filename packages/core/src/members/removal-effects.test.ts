// A member's removal, feature by feature (spec 0031, AC-814, AC-815, AC-816),
// against a real Postgres as the app role: the remove dialog's counts, the
// booking pages that pause or stay, and the job that hands their records and
// open tasks to someone else.
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '@crm/db';
import { createBookingPage } from '../booking/pages.ts';
import { defineAttribute } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { createTask } from '../tasks/tasks.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { leaveWorkspace, previewRemoval, removeMember, setMemberRole } from './members.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-removal-effects-tests' });
afterAll(async () => {
  await db.close();
});

const { team, runnerFor, drive, jobRow } = jobTestKit(db, ownerUrl);
const registry = jobKinds({ environment: 'local' });
const NOW = new Date('2026-11-01T00:00:00.000Z');
const leaveOrRemoveSelf = (scope: Parameters<typeof removeMember>[0], self: string, heir: string) =>
  removeMember(scope, { memberId: self, reassignTo: heir }, [], { jobs: registry });

/** A workspace with Ada (owner), Gus (leaving) and Hal (taking over), and People's Owner attribute. */
async function world() {
  const t = await team(['member', 'member', 'admin']);
  const [gus = '', hal = '', ann = ''] = t.ids;
  const read = <T extends Record<string, unknown>>(statement: ReturnType<typeof sql>) =>
    db.withWorkspace(t.workspaceId, async (tx) => (await tx.execute<T>(statement)).rows);
  const [people] = await read<{ object_id: string; name: string; owner: string }>(sql`
    select o.id::text as object_id,
      (select id::text from attributes where object_id = o.id and api_slug = 'name') as name,
      (select id::text from attributes where object_id = o.id and api_slug = 'owner') as owner
    from objects o where o.api_slug = 'people'
  `);
  if (people === undefined) throw new Error('No People object.');
  const ownedBy = async (firstName: string, memberId: string) =>
    (
      await createRecord(t.owner, {
        objectId: people.object_id,
        values: { [people.name]: { firstName }, [people.owner]: { type: 'member', id: memberId } },
      })
    ).recordId;
  const ownerOf = async (recordId: string) =>
    (
      await read<{ member: string | null }>(sql`
        select actor_member_id::text as member from "values"
        where owner_id = ${recordId}::uuid and attribute_id = ${people.owner}::uuid
          and active_until is null and not is_cleared
      `)
    ).map((row) => row.member);
  const task = async (title: string, memberId: string) =>
    (await createTask(t.owner, { id: newId(), title, assigneeMemberId: memberId })).id;
  const assigneeOf = async (taskId: string) =>
    (
      await read<{ member: string | null }>(
        sql`select assignee_member_id::text as member from tasks where id = ${taskId}::uuid`,
      )
    )[0]?.member;
  return {
    ...t,
    people,
    gus,
    hal,
    ann,
    annScope: t.as(ann, 'admin'),
    gusScope: t.as(gus, 'member'),
    halScope: t.as(hal, 'member'),
    read,
    ownedBy,
    ownerOf,
    task,
    assigneeOf,
  };
}

describe('the remove dialog’s counts (AC-816)', () => {
  it('counts the pages that pause, the calendars, the open tasks and the records naming them', async () => {
    const w = await world();
    await createBookingPage(w.gusScope, { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    await w.ownedBy('Ann', w.gus);
    await w.ownedBy('Ben', w.gus);
    await w.ownedBy('Cat', w.hal);
    await w.task('Call Ann', w.gus);
    const done = await w.task('Done already', w.gus);
    await w.read(
      sql`update tasks set is_done = true, done_at = now(), done_by_type = 'system' where id = ${done}::uuid`,
    );
    expect(await previewRemoval(w.owner, { memberId: w.gus })).toEqual({
      pausedPages: 1,
      calendars: 0,
      openTasks: 1,
      records: 2,
      defaults: 0,
      requiredDefaults: 0,
    });
    // About themself before leaving, yes; about anyone else, only with members.manage.
    expect(await previewRemoval(w.gusScope, { memberId: w.gus })).toMatchObject({ records: 2 });
    expect(await refusalOf(previewRemoval(w.halScope, { memberId: w.gus }))).toMatchObject({ code: 'FORBIDDEN' });
    // Someone no longer here is not found.
    await removeMember(w.owner, { memberId: w.gus });
    expect(await refusalOf(previewRemoval(w.owner, { memberId: w.gus }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a field default naming them (late trap #70)', () => {
  it('counts the fields beforehand, the required ones left empty apart, then takes them out of every default', async () => {
    const w = await world();
    const single = await defineAttribute(w.owner, {
      objectId: w.people.object_id,
      apiSlug: 'account_manager',
      title: 'Account manager',
      type: 'actor_reference',
      isRequired: true,
      defaultValue: { kind: 'static', value: { type: 'member', id: w.gus } },
    });
    const several = await defineAttribute(w.owner, {
      objectId: w.people.object_id,
      apiSlug: 'watchers',
      title: 'Watchers',
      type: 'actor_reference',
      isMulti: true,
      isRequired: true,
      defaultValue: {
        kind: 'static',
        value: [
          { type: 'member', id: w.gus },
          { type: 'member', id: w.hal },
        ],
      },
    });
    expect(await previewRemoval(w.owner, { memberId: w.gus })).toMatchObject({ defaults: 2, requiredDefaults: 1 });
    await removeMember(w.owner, { memberId: w.gus });
    const stored = await w.read<{ id: string; value: unknown }>(sql`
      select id::text, default_value as value from attributes
      where id in (${single.attributeId}::uuid, ${several.attributeId}::uuid)
    `);
    const byId = new Map(stored.map((row) => [row.id, row.value]));
    expect(byId.get(single.attributeId)).toBeNull();
    expect(byId.get(several.attributeId)).toEqual({ kind: 'static', value: [{ type: 'member', id: w.hal }] });
  });
});

describe('booking pages on removal (AC-814)', () => {
  it('pauses a page nobody is left to host, keeps one others still host, and drops them from every pool', async () => {
    const w = await world();
    const own = await createBookingPage(w.gusScope, { id: newId(), title: 'Gus alone', timeZone: 'UTC' }, NOW);
    const shared = await createBookingPage(w.halScope, { id: newId(), title: 'Hal and Gus', timeZone: 'UTC' }, NOW);
    await w.read(sql`
      insert into booking_page_members (workspace_id, page_id, member_id, position)
      values (${w.workspaceId}::uuid, ${shared.id}::uuid, ${w.gus}::uuid, 1)
    `);
    await removeMember(w.owner, { memberId: w.gus });
    expect(
      await w.read(sql`select title, status::text as status, paused_reason from booking_pages order by title`),
    ).toEqual([
      { title: 'Gus alone', status: 'paused', paused_reason: 'host_removed' },
      { title: 'Hal and Gus', status: 'live', paused_reason: null },
    ]);
    expect(
      await w.read(sql`select page_id::text as page from booking_page_members where member_id = ${w.gus}::uuid`),
    ).toEqual([]);
    expect(own.id).not.toBe(shared.id);
  });
});

describe('handing their work on (AC-816)', () => {
  it('moves the records naming them and their open tasks to the chosen member, as the remover’s job', async () => {
    const w = await world();
    const records = [await w.ownedBy('Ann', w.gus), await w.ownedBy('Ben', w.gus)];
    const others = await w.ownedBy('Cat', w.ownerId);
    const open = await w.task('Call Ann', w.gus);
    const { jobId } = await removeMember(w.owner, { memberId: w.gus, reassignTo: w.hal }, [], { jobs: registry });
    expect(jobId).toBeDefined();
    const run = runnerFor(registry);
    expect((await drive(run, w.workspaceId, jobId ?? '')).at(-1)).toBe('succeeded');
    for (const recordId of records) expect(await w.ownerOf(recordId)).toEqual([w.hal]);
    expect(await w.ownerOf(others)).toEqual([w.ownerId]);
    expect(await w.assigneeOf(open)).toBe(w.hal);
    // The old value is kept in its history.
    const history = await w.read<{ n: number }>(sql`
      select count(*)::int as n from "values" where owner_id = ${records[0] ?? ''}::uuid
        and actor_member_id = ${w.gus}::uuid and active_until is not null
    `);
    expect(history[0]?.n).toBe(1);
  });

  it('hands nothing more on once the remover no longer manages members, and nothing when someone leaves', async () => {
    const w = await world();
    const record = await w.ownedBy('Ann', w.gus);
    const open = await w.task('Call Ann', w.gus);
    const { jobId = '' } = await removeMember(w.annScope, { memberId: w.gus, reassignTo: w.hal }, [], {
      jobs: registry,
    });
    await setMemberRole(w.owner, { memberId: w.ann, role: 'member' });
    await drive(runnerFor(registry), w.workspaceId, jobId);
    expect(await w.ownerOf(record)).toEqual([w.gus]);
    expect(await w.assigneeOf(open)).toBe(w.gus);
    // Leaving with someone named is refused: the job would run as someone no longer here.
    await expect(leaveOrRemoveSelf(w.halScope, w.hal, w.ownerId)).rejects.toMatchObject({
      inputProblem: { field: 'reassignTo' },
    });
  });

  it('refuses handing their work to themself or to someone not here, and hands nothing to someone gone since', async () => {
    const w = await world();
    expect(
      await refusalOf(removeMember(w.owner, { memberId: w.gus, reassignTo: w.gus }, [], { jobs: registry })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await refusalOf(removeMember(w.owner, { memberId: w.gus, reassignTo: newId() }, [], { jobs: registry })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    const record = await w.ownedBy('Ann', w.gus);
    const { jobId = '' } = await removeMember(w.owner, { memberId: w.gus, reassignTo: w.hal }, [], { jobs: registry });
    await leaveWorkspace(w.halScope);
    await drive(runnerFor(registry), w.workspaceId, jobId);
    expect((await jobRow(jobId))?.status).toBe('succeeded');
    expect(await w.ownerOf(record)).toEqual([w.gus]);
  });
});
