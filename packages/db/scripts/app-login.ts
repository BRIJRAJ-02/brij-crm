// One time per environment: creates the login role named in DATABASE_URL and
// makes it a member of crm_app. Run it after the first migration, as the owner.
// The password goes over as a SCRAM verifier; `-- --plain-password` sends it
// as plain text instead, a last resort for a host that refuses verifiers.
import * as z from 'zod';
import { scriptEnv } from './env.ts';
import { ensureLogin, wantsPlainPassword } from './login.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url(), DATABASE_URL: z.url() });

await ensureLogin({
  ownerUrl: env.DATABASE_URL_OWNER,
  loginUrl: env.DATABASE_URL,
  variable: 'DATABASE_URL',
  group: 'crm_app',
  apartFrom: 'crm_identity',
  plainPassword: wantsPlainPassword(process.argv),
});
