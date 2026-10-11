// One time per environment: creates the login role named in
// DATABASE_URL_DIRECT (the worker's direct connection: the relay and Graphile
// Worker's runners, spec 0008) and makes it a member of crm_worker, which
// inherits crm_app and alone reads the queue. Run it after the migration that
// creates crm_worker (0028), as the owner. `-- --plain-password` sends the
// password as plain text, a last resort for a host (Neon) that refuses a
// SCRAM verifier.
import * as z from 'zod';
import { scriptEnv } from './env.ts';
import { ensureLogin, wantsPlainPassword } from './login.ts';

const env = scriptEnv({ DATABASE_URL_OWNER: z.url(), DATABASE_URL: z.url(), DATABASE_URL_DIRECT: z.url() });

// The API's login must never reach the queue: the worker's direct login is its own role.
if (new URL(env.DATABASE_URL_DIRECT).username === new URL(env.DATABASE_URL).username) {
  console.error(
    'DATABASE_URL_DIRECT must use its own login role (crm_worker_user), not the app login in DATABASE_URL.',
  );
  process.exit(1);
}

await ensureLogin({
  ownerUrl: env.DATABASE_URL_OWNER,
  loginUrl: env.DATABASE_URL_DIRECT,
  variable: 'DATABASE_URL_DIRECT',
  group: 'crm_worker',
  apartFrom: 'crm_identity',
  plainPassword: wantsPlainPassword(process.argv),
});
