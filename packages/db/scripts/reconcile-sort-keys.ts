// `pnpm db:reconcile:sort-keys`: brings every workspace's stored sort keys in
// line with its current values (spec 0004, stored sort keys). Run it once
// after a deploy whose migration adds key kinds: the migration fills the keys
// before the new version starts, and saves the old version takes meanwhile
// don't keep the new kinds' keys. Safe to run any time; it changes only rows
// that differ. Runs as the owner on the direct connection, in one transaction,
// with FORCE ROW LEVEL SECURITY lifted only inside it (a failure rolls that
// back too).
import pg from 'pg';
import * as z from 'zod';
import { assertDirectUrl } from '../src/direct.ts';
import { scriptEnv } from './env.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url() });
assertDirectUrl(env.DATABASE_URL_OWNER, 'DATABASE_URL_OWNER');

const TABLES = ['records', 'list_entries', 'attributes', '"values"', 'sort_keys'];
const COLUMNS =
  'workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key, time_key, option_id, bool_key';

const client = new pg.Client({ connectionString: env.DATABASE_URL_OWNER, application_name: 'crm-reconcile-sort-keys' });
await client.connect();
try {
  await client.query('begin');
  await client.query(`set local lock_timeout = '5s'`);
  await client.query(`lock table ${TABLES.join(', ')} in access exclusive mode`);
  for (const table of TABLES) await client.query(`alter table ${table} no force row level security`);
  const upserted = await client.query(`
    insert into sort_keys (${COLUMNS}) select ${COLUMNS} from sort_key_sources
    on conflict (workspace_id, owner_id, attribute_id) do update set
      record_id = excluded.record_id, entry_id = excluded.entry_id, live = excluded.live,
      text_key = excluded.text_key, number_key = excluded.number_key, code_key = excluded.code_key,
      date_key = excluded.date_key, time_key = excluded.time_key, option_id = excluded.option_id,
      bool_key = excluded.bool_key
    where (sort_keys.record_id, sort_keys.entry_id, sort_keys.live, sort_keys.text_key, sort_keys.number_key,
      sort_keys.code_key, sort_keys.date_key, sort_keys.time_key, sort_keys.option_id, sort_keys.bool_key)
      is distinct from (excluded.record_id, excluded.entry_id, excluded.live, excluded.text_key, excluded.number_key,
      excluded.code_key, excluded.date_key, excluded.time_key, excluded.option_id, excluded.bool_key)
  `);
  const removed = await client.query(`
    delete from sort_keys k where not exists (
      select 1 from sort_key_sources s
      where s.workspace_id = k.workspace_id and s.owner_id = k.owner_id and s.attribute_id = k.attribute_id
    )
  `);
  for (const table of TABLES) await client.query(`alter table ${table} force row level security`);
  await client.query('commit');
  console.log(
    `Sort keys reconciled: ${String(upserted.rowCount ?? 0)} written, ${String(removed.rowCount ?? 0)} removed.`,
  );
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
