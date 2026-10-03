// One time per environment: creates the login role named in DATABASE_URL and
// makes it a member of crm_app. Run it after the first migration, as the owner.
import * as z from 'zod';
import { scriptEnv } from './env.ts';
import { ensureLogin } from './login.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url(), DATABASE_URL: z.url() });

await ensureLogin({
  ownerUrl: env.DATABASE_URL_OWNER,
  loginUrl: env.DATABASE_URL,
  variable: 'DATABASE_URL',
  group: 'crm_app',
  apartFrom: 'crm_identity',
});
