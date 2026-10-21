// A member's background job runs under their rules (spec 0009, AC-147; spec
// 0008): the worker's own wiring (`createJobRunner`) enters the job's member
// again at every slice with the rule source their requests use, so a job that
// tries to read the records a record rule hides from its member reads none of
// them. Without rules the same job reads both, which is the hole this closes.
// Real Postgres, the worker's runner, a test kind that reads.
import {
  createRecord,
  createWorkspace,
  defineKind,
  getRecords,
  jobKinds,
  newId,
  NO_RULE_SOURCE,
  type AccessRules,
  type RuleSource,
} from '@crm/core';
import { startJobForTest, testScope } from '@crm/core/testing';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { log } from '../log.ts';
import { createJobRunner } from './runner.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-job-rules-tests', maxConnections: 8 });
});
afterAll(async () => {
  await db.close();
});

/** A member job that reads its items as records: one it may see is done, one it can't is refused NOT_FOUND. */
const readsRecords = defineKind({
  kind: 'test.read_records',
  lane: 'light',
  actor: 'member',
  mode: 'items',
  params: z.strictObject({}),
  cancellable: true,
  maxAttempts: 2,
  batchSize: 10,
  sample: {},
  async step(context, { items = [] }) {
    const seen = new Set((await getRecords(context.scope, { ids: items.map((item) => item.itemId) })).map((r) => r.id));
    return {
      finished: false,
      items: items.map((item) =>
        seen.has(item.itemId)
          ? { position: item.position, state: 'done' as const }
          : { position: item.position, state: 'refused' as const, code: 'NOT_FOUND', message: 'Hidden.' },
      ),
    };
  },
});
const registry = jobKinds({ environment: 'local', extra: [readsRecords] });

/** Each test workspace's rules, by workspace id, as #24's tables will hold them. */
const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? { levels: [], records: [] };
};

/**
 * A workspace with its owner, a member Bea, two people (one Bea owns, one she
 * doesn't) and an own rule on People for members, so Bea sees only hers.
 */
async function world() {
  const created = await createWorkspace(db, {
    name: 'Job rules',
    slug: `job-rules-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const bea = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, 'Bea', $3, 'member', 'system', 'system')`,
    [workspaceId, bea, `${bea}@example.com`],
  );
  const [people] = await testQuery<{ id: string }>(
    ownerUrl,
    "select id::text from objects where workspace_id = $1 and api_slug = 'people'",
    [workspaceId],
  );
  const attributes = await testQuery<{ id: string; api_slug: string }>(
    ownerUrl,
    'select id::text, api_slug from attributes where workspace_id = $1 and object_id = $2',
    [workspaceId, people?.id],
  );
  const attribute = (slug: string) => attributes.find((row) => row.api_slug === slug)?.id ?? '';
  const objectId = people?.id ?? '';
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const person = async (firstName: string, ownedBy?: string) =>
    (
      await createRecord(owner, {
        objectId,
        values: {
          [attribute('name')]: { firstName },
          ...(ownedBy === undefined ? {} : { [attribute('owner')]: { type: 'member', id: ownedBy } }),
        },
      })
    ).recordId;
  const hers = await person('Hers', bea);
  const theirs = await person('Theirs');
  rulesByWorkspace.set(workspaceId, {
    levels: [],
    records: [{ subject: { type: 'role', role: 'member' }, objectId, kind: 'own', attributeId: attribute('owner') }],
  });
  return { workspaceId, bea, hers, theirs };
}

/** Starts the reading job as Bea and runs it to its end with `runnerRules`; answers each item's state. */
async function readAs(w: Awaited<ReturnType<typeof world>>, runnerRules: RuleSource) {
  const scope = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'member', id: w.bea }, role: 'member' });
  const { jobId } = await startJobForTest(scope, registry, {
    kind: 'test.read_records',
    params: {},
    items: [w.hers, w.theirs],
  });
  const runner = createJobRunner({ db, registry, log, rules: runnerRules });
  for (let slice = 0; slice < 10; slice += 1) {
    const outcome = await runner.runSlice({ workspaceId: w.workspaceId, jobId });
    if (outcome === 'succeeded' || outcome === 'failed') break;
  }
  const rows = await testQuery<{ item_id: string; state: string }>(
    ownerUrl,
    'select item_id::text, state::text from job_items where workspace_id = $1 and job_id = $2',
    [w.workspaceId, jobId],
  );
  return new Map(rows.map((row) => [row.item_id, row.state]));
}

describe('a member’s job on the worker (spec 0009, AC-147)', () => {
  it('reads only what the member may see: a record their rule hides is refused, never read', async () => {
    const w = await world();
    const states = await readAs(w, rules);
    expect(states.get(w.hers)).toBe('done');
    expect(states.get(w.theirs)).toBe('refused');
  });

  it('would read the hidden one with no rules, which is why the worker must be given the member’s', async () => {
    const w = await world();
    const states = await readAs(w, NO_RULE_SOURCE);
    expect(states.get(w.theirs)).toBe('done');
  });
});
