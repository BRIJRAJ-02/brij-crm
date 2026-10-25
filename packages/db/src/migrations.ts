// Every migration, in the one order that works (spec 0008): Graphile Worker's
// own schema first (its migrations, as the owner), then ours (which create
// `crm_enqueue_job` over Graphile's `add_job` and the roles `crm_worker` and
// `crm_queue`), then the rights on Graphile's schema, granted again after every
// run so a Graphile upgrade that adds or renames a table is covered at once
// (the guard test compares them exactly). `scripts/migrate.ts` (Railway's pre
// deploy step) and the test setup both run it. The one module in this package
// that imports `graphile-worker`.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Logger, runMigrations } from 'graphile-worker';
import pg from 'pg';
import { QUEUE_SCHEMA } from './queue.ts';

export { QUEUE_SCHEMA };

/** The one policy on Graphile's tables, letting `crm_worker` and `crm_queue` past its row level security. */
const QUEUE_POLICY = 'crm_queue_roles';

/** A logger that says nothing: Graphile's migration chatter isn't ours to print. */
const quiet = new Logger(() => () => undefined);

/**
 * Exactly what `crm_queue` holds on Graphile's schema, for 0.18.0, whose
 * `add_job` runs with its caller's rights and calls `add_jobs`: usage on the
 * schema and the `job_spec` type, execute on the two functions, select and
 * insert on the task and queue name tables, and select, insert and update on
 * the jobs table (`add_jobs` clears the key of a locked row and upserts on
 * the key). Nothing else, and never delete.
 */
export const QUEUE_ROLE_RIGHTS = {
  functions: ['add_job', 'add_jobs'],
  tables: {
    _private_tasks: ['INSERT', 'SELECT'],
    _private_job_queues: ['INSERT', 'SELECT'],
    _private_jobs: ['INSERT', 'SELECT', 'UPDATE'],
  },
  types: ['job_spec'],
} as const;

/**
 * The rights on Graphile's schema, granted as the owner after its migrations
 * and ours. PUBLIC loses everything Postgres gives it by default (execute on
 * functions); `crm_worker` gets usage, select, insert, update and delete on
 * the queue's tables, select on the view and on Graphile's `migrations`
 * table (only the owner migrates), execute on every function, and never
 * `create`; `crm_queue` gets exactly `QUEUE_ROLE_RIGHTS`. Idempotent.
 */
export async function grantQueueRights(client: pg.ClientBase): Promise<void> {
  const tables = Object.entries(QUEUE_ROLE_RIGHTS.tables).map(
    ([table, rights]) => `grant ${rights.join(', ')} on ${QUEUE_SCHEMA}.${table} to crm_queue;`,
  );
  await client.query(`
    revoke all on schema ${QUEUE_SCHEMA} from public;
    revoke all on all tables in schema ${QUEUE_SCHEMA} from public;
    revoke all on all functions in schema ${QUEUE_SCHEMA} from public;
    revoke all on all sequences in schema ${QUEUE_SCHEMA} from public;
    -- Taken away and given again on every run, so the rights are exactly these whatever an earlier run gave.
    revoke all on all tables in schema ${QUEUE_SCHEMA} from crm_worker, crm_queue;
    revoke all on all functions in schema ${QUEUE_SCHEMA} from crm_worker, crm_queue;
    revoke all on all sequences in schema ${QUEUE_SCHEMA} from crm_worker, crm_queue;
    grant usage on schema ${QUEUE_SCHEMA} to crm_worker, crm_queue;
    do $$
    declare
      relation record;
    begin
      for relation in
        select c.relname, c.relkind, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = '${QUEUE_SCHEMA}' and c.relkind in ('r', 'p', 'v')
      loop
        -- Graphile's runners only read its migrations table at start (the owner runs its migrations before
        -- deploy), so the worker reads it and nothing more.
        if relation.relkind = 'v' or relation.relname = 'migrations' then
          execute format('grant select on %I.%I to crm_worker', '${QUEUE_SCHEMA}', relation.relname);
        else
          execute format('grant select, insert, update, delete on %I.%I to crm_worker', '${QUEUE_SCHEMA}', relation.relname);
        end if;
        -- Graphile turns row level security on for its own tables with no policy, so only their owner reads
        -- them. The queue holds ids only and is no tenant's, so one policy lets the two queue roles through;
        -- their grants decide what each may do.
        if relation.relrowsecurity then
          execute format('drop policy if exists ${QUEUE_POLICY} on %I.%I', '${QUEUE_SCHEMA}', relation.relname);
          execute format(
            'create policy ${QUEUE_POLICY} on %I.%I to crm_worker, crm_queue using (true) with check (true)',
            '${QUEUE_SCHEMA}', relation.relname
          );
        end if;
      end loop;
    end
    $$;
    grant usage, select, update on all sequences in schema ${QUEUE_SCHEMA} to crm_worker;
    grant execute on all functions in schema ${QUEUE_SCHEMA} to crm_worker;
    ${QUEUE_ROLE_RIGHTS.functions.map((name) => `grant execute on function ${QUEUE_SCHEMA}.${name} to crm_queue;`).join('\n')}
    ${QUEUE_ROLE_RIGHTS.types.map((name) => `grant usage on type ${QUEUE_SCHEMA}.${name} to crm_queue;`).join('\n')}
    ${tables.join('\n')}
  `);
}

/**
 * `uuidv7()` under one name on every Postgres we run on. The built in arrived in 18, and the two productions do not
 * agree: Timefix's database is 17.11, brij-crm's is 18.6 (25 October 2026). Forty three of the migrations call
 * `uuidv7()` unqualified from migration 0002 onwards, so on 17 a fresh database cannot be built at all without
 * this. It runs before the migrations, not as one of them, because a migration numbered after 0002 would be far
 * too late, and an already built database skips it either way.
 *
 * On 18 it wraps the built in. On 17 it writes the same value the built in would: 48 bits of millisecond time, the
 * version nibble 7, the variant bits, and randomness from `gen_random_uuid()` for the rest. A database that
 * already has one of its own (Timefix was patched by hand) keeps it untouched.
 */
async function ensureUuidV7(client: pg.Client): Promise<void> {
  await client.query(`
    do $$
    begin
      if to_regprocedure('public.uuidv7()') is not null then
        return;
      end if;
      if to_regprocedure('pg_catalog.uuidv7()') is not null then
        execute 'create function public.uuidv7() returns uuid language sql volatile parallel safe '
             || 'as $f$select pg_catalog.uuidv7()$f$';
      else
        execute $f$
          create function public.uuidv7() returns uuid
            language sql volatile parallel safe
          as $body$
            with r as (select pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) as b)
            select pg_catalog.encode(
              pg_catalog.set_byte(
                pg_catalog.set_byte(
                  overlay(b placing substring(
                    pg_catalog.int8send(
                      pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint)
                    from 3) from 1 for 6),
                  6, (pg_catalog.get_byte(b, 6) & 15) | 112),
                8, (pg_catalog.get_byte(b, 8) & 63) | 128),
              'hex')::uuid
            from r
          $body$
        $f$;
      end if;
      comment on function public.uuidv7() is
        'uuidv7 under one name on Postgres 17 and 18 (packages/db/src/migrations.ts).';
    end
    $$;
  `);
}

/**
 * Applies Graphile Worker's migrations, then ours, then the queue rights, all
 * as the owner on `ownerUrl` (a direct connection: Graphile's migrations
 * notify). Graphile's are idempotent, so each run only applies what is new.
 */
export async function applyMigrations(ownerUrl: string, applicationName: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl, application_name: applicationName });
  await client.connect();
  try {
    // Before anything else: migration 0002 already calls uuidv7(), which Postgres 17 has no built in for.
    await ensureUuidV7(client);
  } finally {
    await client.end();
  }
  await runMigrations({ connectionString: ownerUrl, logger: quiet });
  const second = new pg.Client({ connectionString: ownerUrl, application_name: applicationName });
  await second.connect();
  try {
    await migrate(drizzle({ client: second }), {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
    await grantQueueRights(second);
  } finally {
    await second.end();
  }
}
