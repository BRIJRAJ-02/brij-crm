// Saved reports on real Postgres (the reports lane): create with its checks and replay, the list a reader sees
// (an object or a field hidden from them makes the report absent, never locked), who changes or deletes one (its
// maker, or a holder of `views.manage`), Undo (a delete then the same create), and the limit. A report holds a
// definition only, so nothing here reads a record.
import { sql } from 'drizzle-orm';
import type { ReportConfig } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { defineAttribute } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import type { AccessRules } from '../access/policy.ts';
import { rescope, testScope } from '../testing.ts';
import { createReport, deleteReport, listReports, REPORT_NOT_FOUND, updateReport } from './reports.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-reports-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace (its owner Ada), members Bea and Cy, a Stage status and a Score number on People, and their ids. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Reports',
    slug: `reports-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    return { id, scope: testScope({ db, workspaceId, actor: { type: 'member', id }, role: 'member' }) };
  };
  const bea = await addMember('Bea Ruiz');
  const cy = await addMember('Cy Young');
  const people = created.objects.people ?? '';
  const stage = (await defineAttribute(owner, { objectId: people, apiSlug: 'stage', title: 'Stage', type: 'status' }))
    .attributeId;
  const score = (await defineAttribute(owner, { objectId: people, apiSlug: 'score', title: 'Score', type: 'number' }))
    .attributeId;
  const jobTitle =
    (
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute<{ id: string }>(
          sql`select id::text from attributes where object_id = ${people} and api_slug = 'job_title'`,
        ),
      )
    ).rows[0]?.id ?? '';
  return { ...created, owner, bea, cy, people, stage, score, jobTitle };
}
type World = Awaited<ReturnType<typeof workspace>>;

const byStage = (w: World): ReportConfig => ({
  measure: { fn: 'count' },
  groupBy: { attributeId: w.stage },
  chart: 'bar',
});

const make = (scope: World['owner'], w: World, over: { id?: string; name?: string; config?: ReportConfig } = {}) =>
  createReport(scope, {
    id: over.id ?? newId(),
    objectId: w.people,
    name: over.name ?? 'People by stage',
    config: over.config ?? byStage(w),
  });

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('create and list', () => {
  it('saves a report and shows it to every member, oldest first', async () => {
    const w = await workspace();
    const first = await make(w.owner, w, { name: 'First' });
    const second = await make(w.bea.scope, w, { name: 'Second' });
    expect(first).toMatchObject({ objectId: w.people, name: 'First', config: byStage(w), creatorMemberId: w.memberId });
    expect(second.creatorMemberId).toBe(w.bea.id);
    const seenByCy = await listReports(w.cy.scope);
    expect(seenByCy.reports.map((report) => report.name)).toEqual(['First', 'Second']);
  });

  it('stores a filter snapshot and the win chances, and drops an empty filter', async () => {
    const w = await workspace();
    const filter = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: w.score, operator: 'gt' as const, value: 3 }],
    };
    const config: ReportConfig = {
      measure: { fn: 'sum', attributeId: w.score },
      groupBy: { attributeId: w.stage },
      filter,
      filterName: 'Big ones',
      chart: 'bar',
      weights: { [newId()]: 40 },
    };
    const saved = await make(w.owner, w, { config });
    expect(saved.config).toEqual(config);
    const plain = await make(w.owner, w, {
      config: { ...byStage(w), filter: { conjunction: 'and', conditions: [] } },
    });
    expect(plain.config.filter).toBeUndefined();
  });

  it('answers the same create again with the report already made, and refuses another member’s id', async () => {
    const w = await workspace();
    const id = newId();
    const first = await make(w.owner, w, { id });
    const again = await make(w.owner, w, { id });
    expect(again).toEqual(first);
    expect((await listReports(w.owner)).reports).toHaveLength(1);
    expect(await refusalOf(make(w.bea.scope, w, { id }))).toMatchObject({ code: 'ID_TAKEN' });
  });

  it('refuses settings the object can’t run, and names that are empty or too long', async () => {
    const w = await workspace();
    const text = w.jobTitle;
    expect(
      await refusalOf(make(w.owner, w, { config: { measure: { fn: 'sum', attributeId: text }, chart: 'number' } })),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(make(w.owner, w, { config: { measure: { fn: 'count' }, chart: 'bar' } }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect(
      await refusalOf(
        make(w.owner, w, { config: { ...byStage(w), groupBy: { attributeId: w.stage, bucket: 'month' } } }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(make(w.owner, w, { name: '   ' }))).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(make(w.owner, w, { name: 'x'.repeat(101) }))).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(await refusalOf(make(w.owner, w, { id: '00000000-0000-4000-8000-000000000000' }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect((await listReports(w.owner)).reports).toEqual([]);
  });

  it('refuses a filter naming a field the object doesn’t have', async () => {
    const w = await workspace();
    const config: ReportConfig = {
      ...byStage(w),
      filter: { conjunction: 'and', conditions: [{ attributeId: newId(), operator: 'is_empty' }] },
    };
    expect(await refusalOf(make(w.owner, w, { config }))).toMatchObject({ code: 'FILTER_INVALID' });
  });

  it('stops at the workspace’s limit with LIMIT_REACHED', async () => {
    const w = await workspace();
    const limited = rescope(w.owner, { limits: { reportsPerWorkspace: 2 } });
    await make(limited, w);
    await make(limited, w);
    expect(await refusalOf(make(limited, w))).toMatchObject({ code: 'LIMIT_REACHED' });
  });
});

describe('what a reader may see', () => {
  it('leaves out a report on an object hidden from them, and answers it as absent', async () => {
    const w = await workspace();
    const report = await make(w.owner, w);
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'none' },
      ],
      records: [],
    };
    const hidden = rescope(w.bea.scope, { rules });
    expect((await listReports(hidden)).reports).toEqual([]);
    expect(await refusalOf(updateReport(hidden, { reportId: report.id, name: 'X' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(make(hidden, w))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listReports(w.cy.scope)).reports).toHaveLength(1);
  });

  it('leaves out a report naming a field hidden from them, in its measure, group by or filter', async () => {
    const w = await workspace();
    const byScore = await make(w.owner, w, {
      name: 'Total score',
      config: { measure: { fn: 'sum', attributeId: w.score }, chart: 'number' },
    });
    const filtered = await make(w.owner, w, {
      name: 'By stage, scored',
      config: {
        ...byStage(w),
        filter: { conjunction: 'and', conditions: [{ attributeId: w.score, operator: 'gt', value: 1 }] },
      },
    });
    const plain = await make(w.owner, w, { name: 'By stage' });
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.people, attributeId: w.score },
          level: 'hidden',
        },
      ],
      records: [],
    };
    const restricted = rescope(w.bea.scope, { rules });
    const seen = (await listReports(restricted)).reports.map((report) => report.id);
    expect(seen).toEqual([plain.id]);
    expect(seen).not.toContain(byScore.id);
    expect(seen).not.toContain(filtered.id);
    expect(await refusalOf(updateReport(restricted, { reportId: byScore.id, name: 'X' }))).toMatchObject({
      code: 'NOT_FOUND',
      message: REPORT_NOT_FOUND,
    });
  });
});

describe('who changes a report', () => {
  it('lets its maker rename it and replace its settings', async () => {
    const w = await workspace();
    const report = await make(w.bea.scope, w);
    const renamed = await updateReport(w.bea.scope, { reportId: report.id, name: '  Pipeline  ' });
    expect(renamed.name).toBe('Pipeline');
    expect(renamed.config).toEqual(report.config);
    const next: ReportConfig = { measure: { fn: 'sum', attributeId: w.score }, chart: 'number' };
    const replaced = await updateReport(w.bea.scope, { reportId: report.id, config: next });
    expect(replaced.config).toEqual(next);
    expect(replaced.name).toBe('Pipeline');
  });

  it('refuses a settings change the object can’t run, leaving the report as it was', async () => {
    const w = await workspace();
    const report = await make(w.owner, w);
    expect(
      await refusalOf(
        updateReport(w.owner, { reportId: report.id, config: { measure: { fn: 'count' }, chart: 'line' } }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect((await listReports(w.owner)).reports[0]?.config).toEqual(byStage(w));
  });

  it('refuses another member (FORBIDDEN) but lets a holder of views.manage change or delete it', async () => {
    const w = await workspace();
    const report = await make(w.bea.scope, w);
    expect(await refusalOf(updateReport(w.cy.scope, { reportId: report.id, name: 'Mine now' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(deleteReport(w.cy.scope, { reportId: report.id }))).toMatchObject({ code: 'FORBIDDEN' });
    const renamed = await updateReport(w.owner, { reportId: report.id, name: 'Owner’s edit' });
    expect(renamed.name).toBe('Owner’s edit');
    await deleteReport(w.owner, { reportId: report.id });
    expect((await listReports(w.cy.scope)).reports).toEqual([]);
  });

  it('answers an unknown report as absent', async () => {
    const w = await workspace();
    expect(await refusalOf(deleteReport(w.owner, { reportId: newId() }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(deleteReport(w.owner, { reportId: 'not-an-id' }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('puts a deleted report back under the same id (Undo)', async () => {
    const w = await workspace();
    const report = await make(w.owner, w);
    await deleteReport(w.owner, { reportId: report.id });
    expect((await listReports(w.owner)).reports).toEqual([]);
    const back = await createReport(w.owner, {
      id: report.id,
      objectId: report.objectId,
      name: report.name,
      config: report.config,
    });
    expect(back).toMatchObject({ id: report.id, name: report.name, config: report.config });
  });
});
