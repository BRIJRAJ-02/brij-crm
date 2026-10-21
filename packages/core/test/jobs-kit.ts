// What the jobs tests share (spec 0008): a clock they move, a workspace with
// members of each role, the runner as the worker builds it, and reads of the
// queue, the job events and the item states as the owner sees them. Tests
// only: it lives outside src, and only `ensureTestTables` reaches the
// package's testing entry (`@crm/core/testing`, tests and scripts).
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import type { Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterAsActor, NO_RULE_SOURCE, systemScope, type RuleSource } from '../src/access/door.ts';
import { newId } from '../src/engine/ids.ts';
import { outboxHook } from '../src/engine/outbox.ts';
import { isRefusal } from '../src/engine/refusals.ts';
import { createWorkspace } from '../src/engine/workspaces.ts';
import { testScope } from '../src/testing.ts';
import { jobKinds } from '../src/jobs/kinds/index.ts';
import type { JobRegistry } from '../src/jobs/registry.ts';
import { createRunner, type RunnerDeps } from '../src/jobs/runner.ts';

/** A clock the tests move: the test kind's waits move it, so nothing sleeps. */
export function fakeClock(start = Date.now()) {
  let at = start;
  return {
    now: () => at,
    sleep: (ms: number) => {
      at += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      at += ms;
    },
  };
}

/** A clock the tests move. */
export type FakeClock = ReturnType<typeof fakeClock>;

/** The refusal a call ended with; throws when it was let through or failed some other way. */
export async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

/**
 * The test only tables the jobs tests write through: `test_job_effects` (one
 * row per item a test kind handled, to count effects exactly once),
 * `test_job_hooks` (one row per `onFailed` call) and `test_job_targets` (what a
 * test kind snapshots). Tenant tables like any other: forced row level
 * security with the standard policy, reached by the app login. Made once per
 * test database, as the owner.
 */
export async function ensureTestTables(ownerUrl: string): Promise<void> {
  const policy = "workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid";
  for (const [table, columns] of [
    [
      'test_job_effects',
      'workspace_id uuid not null, job_id uuid not null, item_id uuid not null, at timestamptz not null default clock_timestamp()',
    ],
    [
      'test_job_hooks',
      'workspace_id uuid not null, job_id uuid not null, code text not null, has_params boolean not null, actor text not null',
    ],
    [
      'test_job_targets',
      'workspace_id uuid not null, id uuid not null, created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz, primary key (workspace_id, id)',
    ],
  ] as const) {
    await testQuery(
      ownerUrl,
      `do $$ begin
         -- Test files run at once against one database: one makes the table, the others wait and find it.
         perform pg_advisory_xact_lock(4008);
         if to_regclass('public.${table}') is null then
           create table public.${table} (${columns});
           alter table public.${table} enable row level security;
           alter table public.${table} force row level security;
           create policy ${table}_tenant on public.${table} using (${policy}) with check (${policy});
           grant select, insert, update, delete on public.${table} to crm_app;
         end if;
       end $$`,
    );
  }
}

/** The kit over one test database: the app login's `db` and the owner's URL for reading across workspaces. */
export function jobTestKit(db: Database, ownerUrl: string, options: { readonly rules?: RuleSource } = {}) {
  // The rules a job's member is entered again with, as the worker passes the api's: none unless a test gives some.
  const rules = options.rules ?? NO_RULE_SOURCE;
  let made = 0;

  /** A workspace with its owner, plus one member of each role given, and scopes for them. */
  async function team(roles: readonly Role[] = ['member', 'admin']) {
    made += 1;
    const created = await createWorkspace(db, {
      name: 'Jobs',
      slug: `jobs-${String(made)}-${newId().slice(-12)}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const ids = roles.map(() => newId());
    await db.withWorkspace(created.workspaceId, async (tx) => {
      for (const [index, role] of roles.entries()) {
        const id = ids[index] ?? '';
        await tx.execute(
          sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${`M${String(index)}`}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
        );
      }
    });
    const as = (memberId: string, role: Role, limits?: Parameters<typeof testScope>[0]['limits']) =>
      testScope({
        db,
        workspaceId: created.workspaceId,
        actor: { type: 'member', id: memberId },
        role,
        ...(limits === undefined ? {} : { limits }),
      });
    const [member = '', admin = ''] = ids;
    return {
      workspaceId: created.workspaceId,
      owner: as(created.memberId, 'owner'),
      ownerId: created.memberId,
      member: as(member, 'member'),
      memberId: member,
      admin: as(admin, 'admin'),
      ids,
      as,
    };
  }

  /** The runner over `registry`, its clock and log, as the worker builds it (relay wakes counted). */
  function runnerFor(
    registry: JobRegistry = jobKinds({ environment: 'local' }),
    clock = fakeClock(),
    extra: Partial<RunnerDeps> = {},
  ) {
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const keep = (message: string, fields: Record<string, unknown>) => lines.push({ message, fields });
    let wakes = 0;
    const runner = createRunner({
      db,
      registry,
      enterAsActor: (input) => enterAsActor({ db, rules }, input),
      systemScope: (workspaceId) => systemScope(db, workspaceId),
      hooks: () => [outboxHook()],
      onStored: () => (wakes += 1),
      log: { info: keep, warn: keep, error: keep },
      now: clock.now,
      leaseOwner: 'test-runner',
      ...extra,
    });
    return { runner, lines, wakes: () => wakes, clock };
  }

  /** A job's queue rows (by its payload), with their key, lock and time. */
  const queueRows = (jobId: string) =>
    testQuery<{ key: string | null; locked: boolean; run_at: Date; attempts: number; max_attempts: number }>(
      ownerUrl,
      `select j.key, j.locked_at is not null as locked, j.run_at, j.attempts, j.max_attempts
       from graphile_worker._private_jobs j where j.payload->>'jobId' = $1 order by j.id`,
      [jobId],
    );

  /** A workspace's `jobs` outbox rows, in order. */
  const jobEvents = (workspaceId: string) =>
    testQuery<{ item_ids: string[]; actor_member_id: string | null }>(
      ownerUrl,
      "select item_ids, actor_member_id from outbox where workspace_id = $1 and kind = 'jobs' order by seq",
      [workspaceId],
    );

  /** How many of a job's items are in each state. */
  const itemStates = (workspaceId: string, jobId: string) =>
    testQuery<{ state: string; n: number }>(
      ownerUrl,
      'select state::text, count(*)::int as n from job_items where workspace_id = $1 and job_id = $2 group by 1 order by 1',
      [workspaceId, jobId],
    );

  /** A job row's columns, as the owner reads them. */
  const jobRow = async (jobId: string) => {
    const [row] = await testQuery<{
      status: string;
      error_code: string | null;
      attempts: number;
      total: number | null;
      run_at: Date;
      expires_at: Date | null;
      dedupe_key: string | null;
      once_key: string | null;
    }>(
      ownerUrl,
      `select status::text, error_code, attempts, total, run_at, expires_at, dedupe_key, once_key
       from jobs where id = $1`,
      [jobId],
    );
    return row;
  };

  /** Drives a job to its end as Graphile would, one slice after another (a rejected slice is a retry). */
  async function drive(
    run: ReturnType<typeof runnerFor>,
    workspaceId: string,
    jobId: string,
    max = 50,
  ): Promise<string[]> {
    const outcomes: string[] = [];
    for (let slice = 0; slice < max; slice += 1) {
      const outcome = await run.runner.runSlice({ workspaceId, jobId }).catch(() => 'threw');
      outcomes.push(outcome);
      if (['succeeded', 'failed', 'cancelled', 'finished-already', 'gone', 'ready'].includes(outcome)) return outcomes;
    }
    return outcomes;
  }

  return { team, runnerFor, queueRows, jobEvents, itemStates, jobRow, drive };
}
