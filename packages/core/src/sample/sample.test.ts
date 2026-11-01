// Sample data and the Sales template, against a real Postgres as the app role: the template's stages and Pipeline
// board, the job writing the set as the member through the engine, Remove taking exactly those (tasks too) in one
// batch, its Undo bringing exactly those back, and owners and admins only. The seed's planner is pure, tested first.
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { addSampleData, getSampleData, removeSampleData, SAMPLE_FORBIDDEN, undoRemoveSampleData } from './sample.ts';
import { dayFrom, planStages, SAMPLE_COMPANIES, SAMPLE_DEALS, SAMPLE_PEOPLE, sampleEmail } from './seed.ts';

describe('the Sales template’s stage plan', () => {
  it('fills an empty stage list, upgrades the seeded four, and keeps a workspace’s own', () => {
    expect(planStages([])).toEqual({
      kind: 'create',
      add: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
    });
    expect(planStages(['Lead', 'In progress', 'Won', 'Lost'])).toEqual({
      kind: 'upgrade',
      rename: { from: 'In progress', to: 'Qualified' },
      add: ['Proposal', 'Negotiation'],
    });
    expect(planStages(['Lead', 'Demo', 'Won', 'Lost'])).toEqual({ kind: 'keep' });
    expect(planStages(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'])).toEqual({ kind: 'keep' });
  });

  it('builds addresses on reserved domains, and days from a UTC date', () => {
    const ines = SAMPLE_PEOPLE.find((person) => person.key === 'ines');
    if (ines === undefined) throw new Error('No Inês.');
    expect(sampleEmail(ines, SAMPLE_COMPANIES)).toBe('ines@lumen.example.com');
    expect(SAMPLE_COMPANIES.every((company) => company.domain.endsWith('.example.com'))).toBe(true);
    expect(dayFrom(new Date('2026-12-30T12:00:00Z'), 3)).toBe('2027-01-02');
    expect(SAMPLE_DEALS.every((deal) => SAMPLE_COMPANIES.some((company) => company.key === deal.company))).toBe(true);
  });
});

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-sample-data-tests' });
afterAll(async () => {
  await db.close();
});
const { team, runnerFor, drive } = jobTestKit(db, ownerUrl);
const registry = jobKinds({ environment: 'local' });

describe('sample data', () => {
  it('adds the template and the set as the member, removes exactly it with Undo, and only for owners and admins', async () => {
    const w = await team(['member', 'admin']);
    expect(await refusalOf(addSampleData(w.member, registry))).toMatchObject({
      code: 'FORBIDDEN',
      message: SAMPLE_FORBIDDEN,
    });
    expect(await getSampleData(w.member)).toMatchObject({ present: false, canManage: false });
    for (const call of [removeSampleData, undoRemoveSampleData]) {
      expect(await refusalOf(call(w.member, { batchId: newId() }))).toMatchObject({ code: 'FORBIDDEN' });
    }

    const started = await addSampleData(w.admin, registry);
    expect(await getSampleData(w.admin)).toMatchObject({ present: false, canManage: true, jobId: started.jobId });
    // A second press while it runs answers the same job.
    expect(await addSampleData(w.admin, registry)).toEqual(started);
    expect((await drive(runnerFor(registry), w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    expect(await getSampleData(w.admin)).toEqual({ present: true, canManage: true });

    const read = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
      db.withWorkspace(w.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
    // Deals' stages are the Sales six, in order, and a Pipeline board groups by them.
    const stages = await read<{ label: string }>(sql`
      select o.label from attribute_options o join attributes a on a.id = o.attribute_id
      join objects ob on ob.id = a.object_id
      where ob.standard_key = 'deals' and a.api_slug = 'stage' and o.archived_at is null order by o.position
    `);
    expect(stages.map((row) => row.label)).toEqual(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
    const boards = await read<{ name: string; kind: string }>(sql`
      select v.name, v.kind::text as kind from views v join objects ob on ob.id = v.object_id
      where ob.standard_key = 'deals' and v.name = 'Pipeline'
    `);
    expect(boards).toEqual([{ name: 'Pipeline', kind: 'board' }]);
    // The set, made by the admin, every record and task marked, deals spread across the stages.
    const made = await read<{ key: string; n: number; by_admin: boolean }>(sql`
      select ob.standard_key as key, count(*)::int as n, bool_and(r.created_by_member_id = ${w.ids[1]}::uuid) as by_admin
      from records r join objects ob on ob.id = r.object_id
      join sample_data s on s.record_id = r.id
      group by ob.standard_key order by 1
    `);
    expect(made).toEqual([
      { key: 'companies', n: 8, by_admin: true },
      { key: 'deals', n: 10, by_admin: true },
      { key: 'people', n: 15, by_admin: true },
    ]);
    const [extra] = await read<{ notes: number; tasks: number; stages: number }>(sql`
      select (select count(*)::int from notes) as notes,
        (select count(*)::int from sample_data where task_id is not null) as tasks,
        (select count(distinct v.option_id)::int from "values" v join attributes a on a.id = v.attribute_id
          where a.api_slug = 'stage' and v.active_until is null) as stages
    `);
    expect(extra).toEqual({ notes: 4, tasks: 4, stages: 6 });
    // A record of the workspace's own stays when the sample goes.
    const [own] = await read<{ id: string }>(sql`
      insert into records (workspace_id, object_id, created_by_type, updated_by_type)
      select ${w.workspaceId}::uuid, id, 'system', 'system' from objects where standard_key = 'companies'
      returning id::text as id
    `);

    const batchId = newId();
    expect(await removeSampleData(w.admin, { batchId })).toEqual({ records: 33 });
    expect(await getSampleData(w.admin)).toMatchObject({ present: false });
    const [after] = await read<{ live: number; tasks: number; own: boolean }>(sql`
      select (select count(*)::int from records r join sample_data s on s.record_id = r.id
          where r.deleted_at is null) as live,
        (select count(*)::int from tasks t join sample_data s on s.task_id = t.id where t.deleted_at is null) as tasks,
        (select deleted_at is null from records where id = ${own?.id ?? ''}::uuid) as own
    `);
    expect(after).toEqual({ live: 0, tasks: 0, own: true });
    expect(await refusalOf(removeSampleData(w.admin, { batchId: newId() }))).toMatchObject({ code: 'NOT_FOUND' });

    expect(await undoRemoveSampleData(w.admin, { batchId })).toEqual({ records: 33 });
    expect(await getSampleData(w.admin)).toMatchObject({ present: true });
    const [back] = await read<{ tasks: number }>(sql`
      select count(*)::int as tasks from tasks t join sample_data s on s.task_id = t.id where t.deleted_at is null
    `);
    expect(back).toEqual({ tasks: 4 });
    // Present again, so a second add is refused rather than doubling the set.
    expect(await refusalOf(addSampleData(w.owner, registry))).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('leaves Deals’ stages alone once the workspace made its own', async () => {
    const w = await team([]);
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        update attribute_options o set label = 'Discovery' from attributes a, objects ob
        where a.id = o.attribute_id and ob.id = a.object_id and ob.standard_key = 'deals' and a.api_slug = 'stage'
          and o.label = 'In progress'
      `),
    );
    const started = await addSampleData(w.owner, registry);
    expect((await drive(runnerFor(registry), w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    const stages = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ label: string }>(sql`
        select o.label from attribute_options o join attributes a on a.id = o.attribute_id
        join objects ob on ob.id = a.object_id
        where ob.standard_key = 'deals' and a.api_slug = 'stage' and o.archived_at is null order by o.position
      `),
    );
    expect(stages.rows.map((row) => row.label)).toEqual(['Lead', 'Discovery', 'Won', 'Lost']);
  });
});
