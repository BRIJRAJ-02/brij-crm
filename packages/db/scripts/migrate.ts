// Applies committed SQL migrations as the owner role, over the direct connection.
// Runs as the api service's pre deploy step, before the new version starts.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as z from 'zod';
import { assertDirectUrl } from '../src/direct.ts';
import { scriptEnv } from './env.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url() });
assertDirectUrl(env.DATABASE_URL_OWNER, 'DATABASE_URL_OWNER');

const client = new pg.Client({ connectionString: env.DATABASE_URL_OWNER, application_name: 'crm-migrate' });
await client.connect();
try {
  await migrate(drizzle({ client }), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.log('Migrations applied.');
} finally {
  await client.end();
}
