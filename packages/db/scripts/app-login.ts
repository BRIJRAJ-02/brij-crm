// One time per environment: creates the login role named in DATABASE_URL and
// makes it a member of crm_app. Run it after the first migration, as the owner.
// Roles made this way (in SQL, not in the Neon console) get no extra powers.
import pg from 'pg';
import * as z from 'zod';
import { assertDirectUrl } from '../src/direct.ts';
import { scriptEnv } from './env.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url(), DATABASE_URL: z.url() });
assertDirectUrl(env.DATABASE_URL_OWNER, 'DATABASE_URL_OWNER');

const appUrl = new URL(env.DATABASE_URL);
const login = decodeURIComponent(appUrl.username);
const password = decodeURIComponent(appUrl.password);
if (!login || !password) {
  throw new Error('DATABASE_URL needs the app login role and its password.');
}

const client = new pg.Client({ connectionString: env.DATABASE_URL_OWNER, application_name: 'crm-app-login' });
await client.connect();
try {
  const owner = await client.query<{ current_user: string }>('select current_user');
  if (owner.rows[0]?.current_user === login) {
    throw new Error('DATABASE_URL uses the owner role. The app needs its own login role.');
  }
  const role = client.escapeIdentifier(login);
  const secret = client.escapeLiteral(password);
  const existing = await client.query('select 1 from pg_roles where rolname = $1', [login]);
  if (existing.rowCount === 0) {
    await client.query(`create role ${role} login password ${secret} nosuperuser nobypassrls nocreatedb nocreaterole`);
    console.log(`Created login role "${login}".`);
  } else {
    await client.query(`alter role ${role} with login password ${secret}`);
    console.log(`Updated the password of login role "${login}".`);
  }
  await client.query(`grant crm_app to ${role}`);
  console.log(`"${login}" is a member of crm_app.`);
} finally {
  await client.end();
}
