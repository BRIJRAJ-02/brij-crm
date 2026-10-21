// Bulk changes as jobs (spec 0022, milestone 3) against a real Postgres as the
// app login, driven slice by slice as Graphile Worker would: the snapshot of
// "all matching" (filter, `asOf`, the records left out), the confirm, the
// batches through the engine with the job's id on the outbox, undo of a delete
// job by its batch, a snapshot of zero ending at once, and the start's limits
// and access refusals.
import { sql } from 'drizzle-orm';
import type { FilterGroup } from '@crm/contracts/values';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import type { RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { deleteRecords } from '../engine/trash.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { confirmJob, getJob } from '../jobs/service.ts';
import { rescope } from '../testing.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { BULK_START_WORDS, startBulk, undoDelete } from './start.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-bulk-jobs-tests' });
afterAll(async () => {
  await db.close();
});

/** Each test workspace's rules, by workspace id, as #24 will store them: the kit's runner enters jobs with them. */
const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};

const { team, runnerFor, drive, itemStates } = jobTestKit(db, ownerUrl, { rules });

/**
 * Now by the database's clock, as an ISO time with microseconds: an `asOf` a
 * test compares with `created_at` or `deleted_at`, which the database stamps,
 * so a clock a millisecond apart from this machine's never moves a record
 * across it.
 */
const databaseNow = async (): Promise<string> =>
  (
    await testQuery<{ now: string }>(
      ownerUrl,
      `select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
    )
  )[0]?.now ?? '';
const registry = jobKinds({ environment: 'local' });

async function world() {
  const t = await team();
  const rows = await db.withWorkspace(t.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select a.id::text, a.api_slug, a.object_id::text from attributes a join objects o on o.id = a.object_id where o.api_slug = 'people'`,
    ),
  );
  const people = rows.rows[0]?.object_id ?? '';
  const attribute = (slug: string) => rows.rows.find((row) => row.api_slug === slug)?.id ?? '';
  const person = async (firstName: string, jobTitle?: string) =>
    (
      await createRecord(t.owner, {
        objectId: people,
        values: {
          [attribute('name')]: { firstName },
          ...(jobTitle === undefined ? {} : { [attribute('job_title')]: jobTitle }),
        },
      })
    ).recordId;
  /** A person whose Owner is `memberId`, so an own rule lets that member see them. */
  const owned = async (firstName: string, memberId: string) =>
    (
      await createRecord(t.owner, {
        objectId: people,
        values: { [attribute('name')]: { firstName }, [attribute('owner')]: { type: 'member', id: memberId } },
      })
    ).recordId;
  return { ...t, people, attribute, person, owned };
}

const live = async (w: Awaited<ReturnType<typeof world>>, ids: readonly string[]) =>
  (await getRecords(w.owner, { ids })).map((view) => view.id).sort();

describe('bulk jobs (AC-528, AC-531)', () => {
  it('deletes all matching after a count and a confirm, leaving out the excepted and the newer, then undoes it', async () => {
    const w = await world();
    const eng = [await w.person('Ada', 'Eng'), await w.person('Bob', 'Eng'), await w.person('Cy', 'Eng')];
    const other = await w.person('Di', 'Ops');
    const filter = {
      conjunction: 'and',
      conditions: [{ attributeId: w.attribute('job_title'), operator: 'is', value: 'Eng' }],
    } as FilterGroup;
    const asOf = await databaseNow();
    const later = await w.person('Ed', 'Eng');
    const [kept = '', ...gone] = eng;
    const id = newId();
    const job = await startBulk(
      w.owner,
      registry,
      { id, action: 'delete', target: { kind: 'matching', objectId: w.people, filter, except: [kept], asOf } },
      [outboxHook()],
    );
    expect(job).toMatchObject({ status: 'preparing', kind: 'records.bulk_delete', subject: { id: w.people } });
    // A retry with the same id answers the same job (AC-540).
    expect(
      (
        await startBulk(w.owner, registry, {
          id,
          action: 'delete',
          target: { kind: 'matching', objectId: w.people, filter, except: [kept], asOf },
        })
      ).id,
    ).toBe(id);
    const run = runnerFor(registry);
    expect(await drive(run, w.workspaceId, id)).toContain('ready');
    // The exact number, fixed by the snapshot: the excepted one and the one made after "Select all" are out.
    expect((await getJob(w.owner, registry, id)).total).toBe(2);
    await confirmJob(w.owner, registry, id, [outboxHook()]);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect(await live(w, [...eng, other, later])).toEqual([kept, other, later].sort());
    // Each deleted record carries the job's id as its batch, and the batch's outbox row names the job, never published.
    const stored = await testQuery<{ batch: string }>(
      ownerUrl,
      'select deleted_batch_id::text as batch from records where id = any($1::uuid[])',
      [gone],
    );
    expect(stored.map((row) => row.batch)).toEqual([id, id]);
    const rows = await testQuery<{ coarse: boolean }>(
      ownerUrl,
      "select coarse from outbox where workspace_id = $1 and kind = 'records' and job_id = $2",
      [w.workspaceId, id],
    );
    expect(rows).toEqual([{ coarse: true }]);
    // Undo from the finish toast: its batch is the job's id, small enough to come back at once.
    const undone = await undoDelete(w.owner, registry, { batchId: id, jobId: newId() });
    expect(undone.mode).toBe('inline');
    expect(await live(w, [...eng, other, later])).toEqual([...eng, other, later].sort());
  });

  it('edits records by id, skipping one trashed since the count and refusing none', async () => {
    const w = await world();
    const ids = [await w.person('Ada'), await w.person('Bob'), await w.person('Cy')];
    const id = newId();
    await startBulk(w.owner, registry, {
      id,
      action: 'edit',
      target: { kind: 'ids', objectId: w.people, recordIds: ids },
      edit: { attributeId: w.attribute('job_title'), op: 'set', value: 'Founder' },
    });
    const run = runnerFor(registry);
    await drive(run, w.workspaceId, id);
    await deleteRecords(w.owner, { objectId: w.people, recordIds: [ids[2] ?? ''], batchId: newId() });
    await confirmJob(w.owner, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect(await itemStates(w.workspaceId, id)).toEqual([
      { state: 'done', n: 2 },
      { state: 'skipped', n: 1 },
    ]);
    const views = await getRecords(w.owner, { ids });
    expect(views.map((view) => view.values[w.attribute('job_title')])).toEqual(['Founder', 'Founder']);
  });

  it('ends a snapshot of zero at once, succeeded with nothing to change', async () => {
    const w = await world();
    const ada = await w.person('Ada');
    const id = newId();
    await startBulk(w.owner, registry, {
      id,
      action: 'delete',
      target: { kind: 'matching', objectId: w.people, except: [ada], asOf: new Date().toISOString() },
    });
    expect((await drive(runnerFor(registry), w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect(await getJob(w.owner, registry, id)).toMatchObject({ status: 'succeeded', total: 0 });
  });

  it('restores the trash of one object as a job', async () => {
    const w = await world();
    const ids = [await w.person('Ada'), await w.person('Bob')];
    await deleteRecords(w.owner, { objectId: w.people, recordIds: ids, batchId: newId() });
    const id = newId();
    await startBulk(w.owner, registry, {
      id,
      action: 'restore',
      target: { kind: 'trash', objectId: w.people, except: [], asOf: await databaseNow() },
    });
    const run = runnerFor(registry);
    await drive(run, w.workspaceId, id);
    await confirmJob(w.owner, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect(await live(w, ids)).toEqual([...ids].sort());
  });

  it('refuses past its limits, a target the action doesn’t take, and a member who may only read (AC-538, AC-539)', async () => {
    const w = await world();
    const many = Array.from({ length: 10_001 }, () => newId());
    expect(
      await refusalOf(
        startBulk(w.owner, registry, {
          id: newId(),
          action: 'delete',
          target: { kind: 'ids', objectId: w.people, recordIds: many },
        }),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', message: BULK_START_WORDS.tooManyIds });
    expect(
      await refusalOf(
        startBulk(w.owner, registry, {
          id: newId(),
          action: 'delete',
          target: {
            kind: 'matching',
            objectId: w.people,
            except: many.slice(0, 1_001),
            asOf: new Date().toISOString(),
          },
        }),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', message: BULK_START_WORDS.tooManyExcept });
    expect(
      await refusalOf(
        startBulk(w.owner, registry, {
          id: newId(),
          action: 'edit',
          target: { kind: 'trash', except: [], asOf: new Date().toISOString() },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    const readOnly = rescope(w.member, {
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'read' },
        ],
        records: [],
      },
    });
    expect(
      await refusalOf(
        startBulk(readOnly, registry, {
          id: newId(),
          action: 'delete',
          target: { kind: 'matching', objectId: w.people, except: [], asOf: new Date().toISOString() },
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('access in a bulk job (AC-538)', () => {
  it('never counts a record the starter’s record rule hides: all matching, ids, the trash or a batch', async () => {
    const w = await world();
    const mine = await w.owned('Ada', w.memberId);
    const theirs = await w.person('Bob');
    const own: AccessRules = {
      levels: [],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: w.people,
          kind: 'own',
          attributeId: w.attribute('owner'),
        },
      ],
    };
    rulesByWorkspace.set(w.workspaceId, own);
    const member = rescope(w.member, { rules: own });
    const run = runnerFor(registry);
    const counted = async (input: Omit<Parameters<typeof startBulk>[2], 'id'>) => {
      const id = newId();
      await startBulk(member, registry, { id, ...input });
      expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('ready');
      return (await getJob(member, registry, id)).total;
    };
    expect(
      await counted({
        action: 'delete',
        target: { kind: 'matching', objectId: w.people, except: [], asOf: await databaseNow() },
      }),
    ).toBe(1);
    expect(
      await counted({ action: 'delete', target: { kind: 'ids', objectId: w.people, recordIds: [mine, theirs] } }),
    ).toBe(1);
    // Both deleted by the owner in one batch: the trash and the batch show the member only theirs.
    const batchId = newId();
    await deleteRecords(w.owner, { objectId: w.people, recordIds: [mine, theirs], batchId });
    expect(
      await counted({
        action: 'restore',
        target: { kind: 'trash', objectId: w.people, except: [], asOf: await databaseNow() },
      }),
    ).toBe(1);
    expect(await counted({ action: 'restore', target: { kind: 'batch', batchId } })).toBe(1);
  });

  it('undoes a delete whose first 501 records are hidden from the member, bringing back the ones they see', async () => {
    const w = await world();
    // Made first, so they come first in id order: the 501 a lock of the batch used to take, none of them hers.
    const theirs: string[] = [];
    for (let n = 0; n < 501; n += 1) theirs.push(await w.person(`Them ${String(n)}`));
    const mine = [await w.owned('Ada', w.memberId), await w.owned('Bea', w.memberId)];
    const jobId = newId();
    await startBulk(w.owner, registry, {
      id: jobId,
      action: 'delete',
      target: { kind: 'ids', objectId: w.people, recordIds: [...theirs, ...mine] },
    });
    const run = runnerFor(registry);
    await drive(run, w.workspaceId, jobId);
    await confirmJob(w.owner, registry, jobId);
    expect((await drive(run, w.workspaceId, jobId)).at(-1)).toBe('succeeded');
    const own: AccessRules = {
      levels: [],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: w.people,
          kind: 'own',
          attributeId: w.attribute('owner'),
        },
      ],
    };
    rulesByWorkspace.set(w.workspaceId, own);
    const undone = await undoDelete(rescope(w.member, { rules: own }), registry, { batchId: jobId, jobId: newId() });
    expect(undone.mode).toBe('inline');
    const back = await testQuery<{ id: string }>(
      ownerUrl,
      'select id::text from records where id = any($1::uuid[]) and deleted_at is null order by id',
      [[...theirs, ...mine]],
    );
    expect(back.map((row) => row.id)).toEqual([...mine].sort());
  });

  it('stops at its next slice when the starter loses write on the object, changing nothing more', async () => {
    const w = await world();
    const ids = [await w.person('Ada'), await w.person('Bob'), await w.person('Cy')];
    const id = newId();
    await startBulk(w.member, registry, {
      id,
      action: 'delete',
      target: { kind: 'ids', objectId: w.people, recordIds: ids },
    });
    const run = runnerFor(registry);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('ready');
    await confirmJob(w.member, registry, id);
    // Demoted to read only on People before the first batch runs: the slice enters them again as they are now.
    rulesByWorkspace.set(w.workspaceId, {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'read' },
      ],
      records: [],
    });
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('failed');
    expect(await getJob(w.owner, registry, id)).toMatchObject({
      status: 'failed',
      done: 0,
      error: { code: 'FORBIDDEN' },
    });
    expect(await live(w, ids)).toEqual([...ids].sort());
  });
});
