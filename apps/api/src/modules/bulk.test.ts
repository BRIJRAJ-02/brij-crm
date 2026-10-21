// Bulk edit at the API (spec 0022, milestone 2): one write's outcomes with
// `before` only for records it changed, a retry carrying none (AC-540), the
// statuses each refusal travels with, and a member who may only read the
// object refused. Real session, real Postgres.
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

async function people(m: Member, names: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const firstName of names) {
    const id = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id,
      values: { [m.attribute('name')]: { firstName } },
      mutationId: newId(),
    });
    ids.push(id);
  }
  return ids;
}

describe('records.updateMany', () => {
  it('edits, answers before only for records it changed, and a retry changes nothing (AC-530, AC-540)', async () => {
    const m = await memberWithWorkspace(app);
    const ids = await people(m, ['Ada', 'Bob']);
    const jobTitle = m.attribute('job_title');
    const input = {
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: ids,
      edit: { attributeId: jobTitle, op: 'set' as const, value: 'Founder' },
    };
    const first = await m.client.records.updateMany({ ...input, mutationId: newId() });
    expect(first.echoes).toBe(1);
    expect(first.results.map((result) => result.record?.values[jobTitle])).toEqual(['Founder', 'Founder']);
    expect(first.results.map((result) => Object.keys(result.written ?? {}))).toEqual([[jobTitle], [jobTitle]]);
    expect(first.results.every((result) => 'before' in result && result.before === null)).toBe(true);
    const again = await m.client.records.updateMany({ ...input, mutationId: newId() });
    expect(again.echoes).toBe(0);
    expect(again.results.map((result) => result.written)).toEqual([undefined, undefined]);
    expect(again.results.map((result) => result.before)).toEqual([undefined, undefined]);
  });

  it('refuses the primary attribute 422 and a read only object 403 (AC-529, AC-538)', async () => {
    const m = await memberWithWorkspace(app);
    const [ada] = await people(m, ['Ada']);
    expect(
      await refusal(() =>
        m.client.records.updateMany({
          workspace: m.slug,
          objectId: m.people.id,
          recordIds: [ada ?? ''],
          edit: { attributeId: m.attribute('name'), op: 'clear' },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', status: 422 });
    rulesByWorkspace.set(m.workspace.id, {
      levels: [
        { subject: { type: 'role', role: 'owner' }, target: { type: 'object', objectId: m.people.id }, level: 'read' },
      ],
      records: [],
    });
    expect(
      await refusal(() =>
        m.client.records.updateMany({
          workspace: m.slug,
          objectId: m.people.id,
          recordIds: [ada ?? ''],
          edit: { attributeId: m.attribute('job_title'), op: 'set', value: 'CTO' },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    rulesByWorkspace.delete(m.workspace.id);
  });
});

describe('records.startBulk', () => {
  it('answers a selection a little over the limits 422 CONFIG_INVALID with the engine’s words (AC-539)', async () => {
    const m = await memberWithWorkspace(app);
    const ids = Array.from({ length: 10_001 }, () => newId());
    expect(
      await refusal(() =>
        m.client.records.startBulk({
          workspace: m.slug,
          id: newId(),
          action: 'delete',
          target: { kind: 'ids', objectId: m.people.id, recordIds: ids },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({
      code: 'CONFIG_INVALID',
      status: 422,
      message: 'Select at most 10,000 records one by one, or select all matching.',
    });
    expect(
      await refusal(() =>
        m.client.records.startBulk({
          workspace: m.slug,
          id: newId(),
          action: 'delete',
          target: {
            kind: 'matching',
            objectId: m.people.id,
            except: ids.slice(0, 1_001),
            asOf: new Date().toISOString(),
          },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', status: 422 });
  });
});
