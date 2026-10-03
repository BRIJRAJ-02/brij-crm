// One time per environment: creates the login role named in
// IDENTITY_DATABASE_URL and makes it a member of crm_identity, the only role
// that reads and writes schema `auth` (spec 0005, security model). Run it after
// the migration that creates crm_identity (0016), as the owner.
import * as z from 'zod';
import { scriptEnv } from './env.ts';
import { ensureLogin } from './login.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url(), DATABASE_URL: z.url(), IDENTITY_DATABASE_URL: z.url() });

if (new URL(env.IDENTITY_DATABASE_URL).username === new URL(env.DATABASE_URL).username) {
  console.error('IDENTITY_DATABASE_URL must use its own login role, not the app login in DATABASE_URL.');
  process.exit(1);
}

await ensureLogin({
  ownerUrl: env.DATABASE_URL_OWNER,
  loginUrl: env.IDENTITY_DATABASE_URL,
  variable: 'IDENTITY_DATABASE_URL',
  group: 'crm_identity',
  apartFrom: 'crm_app',
});
