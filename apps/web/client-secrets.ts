// The no secrets in the client check (spec 0045). The api's server variables
// now sit in the same Vercel project, and the same Production environment, as
// the web app's VITE_* ones, so after each production build the deploy scans
// every file the browser can fetch for the value of each server secret, and
// refuses to deploy if one is there. It names the variable, never the value.
//
//   node --env-file=.vercel/.env.production.local apps/web/client-secrets.ts .vercel/output/static
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The server variables that are secrets: none may start with VITE_ (Vite
 * hands every VITE_ variable to the browser), and none of their values may
 * appear in a file the browser loads.
 */
export const SERVER_SECRETS: readonly string[] = [
  'DATABASE_URL',
  'DATABASE_URL_DIRECT',
  'DATABASE_URL_OWNER',
  'IDENTITY_DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'EDGE_SECRET',
  'JOBS_RUN_SECRET',
  'WORKER_WAKE_SECRET',
  'BOOKING_LINK_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'CALENDAR_TOKEN_KEY',
  'CENTRIFUGO_TOKEN_SECRET',
  'RECAPTCHA_SECRET_KEY',
  'FORMS_IP_SALT',
  'SENTRY_AUTH_TOKEN',
];

/** Values shorter than this aren't looked for: too short to be a secret, and they would match by chance. */
const SHORTEST = 12;

/** One file the browser can fetch, as text. */
export interface ClientFile {
  readonly path: string;
  readonly content: string;
}

/** What to look for in each secret: its whole value, and a URL's password on its own. */
export function needles(value: string): readonly string[] {
  const found = [value];
  if (URL.canParse(value)) {
    const password = decodeURIComponent(new URL(value).password);
    if (password !== '') found.push(password);
  }
  return found.filter((needle) => needle.length >= SHORTEST);
}

/** The names of the secrets in `env` whose value appears in any of `files`, with the file it was found in. */
export function findLeaks(
  files: readonly ClientFile[],
  env: Readonly<Record<string, string | undefined>>,
): readonly { readonly name: string; readonly file: string }[] {
  return SERVER_SECRETS.flatMap((name) => {
    const value = env[name];
    if (value === undefined || value === '') return [];
    const file = files.find((candidate) => needles(value).some((needle) => candidate.content.includes(needle)));
    return file === undefined ? [] : [{ name, file: file.path }];
  });
}

/** Every file under `dir`, read as text. */
function readAll(dir: string): ClientFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = path.join(entry.parentPath, entry.name);
      return { path: path.relative(dir, full), content: readFileSync(full, 'latin1') };
    });
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('Usage: node apps/web/client-secrets.ts <the built static directory>');
    process.exit(2);
  }
  const files = readAll(dir);
  const checked = SERVER_SECRETS.filter((name) => (process.env[name] ?? '') !== '');
  const leaks = findLeaks(files, process.env);
  for (const leak of leaks)
    console.error(`::error::${leak.name}'s value is in ${leak.file}, a file the browser loads.`);
  if (leaks.length > 0) process.exit(1);
  process.stdout.write(
    `No server secret in ${String(files.length)} client files (${String(checked.length)} secrets checked).\n`,
  );
}
