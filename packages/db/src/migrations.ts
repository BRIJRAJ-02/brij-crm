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

/** The schema Graphile Worker keeps its queue in. */
export const QUEUE_SCHEMA = 'graphile_worker';

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
 * functions); `crm_worker` gets usage, every table right but `create`
 * (select, insert, update and delete on tables, select on views) and execute
 * on every function; `crm_queue` gets exactly `QUEUE_ROLE_RIGHTS`. Idempotent.
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
    grant usage on schema ${QUEUE_SCHEMA} to crm_worker, crm_queue;
    do $$
    declare
      relation record;
    begin
      for relation in
        select c.relname, c.relkind, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = '${QUEUE_SCHEMA}' and c.relkind in ('r', 'p', 'v')
      loop
        if relation.relkind = 'v' then
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
 * Applies Graphile Worker's migrations, then ours, then the queue rights, all
 * as the owner on `ownerUrl` (a direct connection: Graphile's migrations
 * notify). Graphile's are idempotent, so each run only applies what is new.
 */
export async function applyMigrations(ownerUrl: string, applicationName: string): Promise<void> {
  await runMigrations({ connectionString: ownerUrl, logger: quiet });
  const client = new pg.Client({ connectionString: ownerUrl, application_name: applicationName });
  await client.connect();
  try {
    await migrate(drizzle({ client }), {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
    await grantQueueRights(client);
  } finally {
    await client.end();
  }
}
