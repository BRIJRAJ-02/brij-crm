// The no secrets in the client check (spec 0045). The api's server variables
// now sit in the same Vercel project, and the same Production environment, as
// the web app's VITE_* ones, so after each production build the deploy scans
// every file the browser can fetch for the value of every variable in the
// pulled environment that isn't public, and refuses to deploy if one is there.
// It names the variable and the file, never the value.
//
//   node apps/web/client-secrets.ts .vercel/.env.production.local .vercel/output/static
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Variables whose values are public or harmless in a page: the app's
 * addresses, switches and public keys. Every other variable that doesn't
 * start with VITE_ counts as a secret, so a secret added later is checked
 * without anyone listing it.
 */
export const PUBLIC_VARIABLES: ReadonlySet<string> = new Set([
  'APP_ENV',
  'NODE_ENV',
  'APP_URL',
  'BETTER_AUTH_URL',
  'TRUSTED_ORIGINS',
  'FORMS_PUBLIC_ORIGIN',
  'BOOKING_PUBLIC_ORIGIN',
  'PUBLIC_HOST_HOME_URL',
  'CALENDAR_WEBHOOK_ORIGIN',
  'API_ORIGIN_INTERNAL',
  'MAIL_FROM',
  'SIGNUP_ALLOWLIST',
  'POSTHOG_KEY',
  'POSTHOG_HOST',
  'RECAPTCHA_SITE_KEY',
  'SENTRY_DSN_SERVER',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_ID',
  'CALENDAR_SYNC',
  'WORKER_WAKE_ON_USE',
  'MONITORING_TEST_FAULT',
]);

/** Prefixes of variables the browser gets on purpose, or the platform and build tools set: not secrets. */
const PUBLIC_PREFIXES = ['VITE_', 'VERCEL', 'TURBO_', 'NX_'];

/** The secrets the api can't run without in function mode: empty after the pull means the check can't see them. */
export const CORE_SECRETS: readonly string[] = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'EDGE_SECRET', 'JOBS_RUN_SECRET'];

/** Values shorter than this aren't looked for: too short to be a secret, and they would match by chance. */
const SHORTEST = 12;

/** One file the browser can fetch, as text. */
export interface ClientFile {
  readonly path: string;
  readonly content: string;
}

/** Whether a variable counts as a secret: not a VITE_ or platform one, and not on the public list. */
export function isSecret(name: string): boolean {
  return !PUBLIC_VARIABLES.has(name) && !PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** What to look for in a secret: its whole value, as a JSON string holds it, and a URL's password on its own. */
export function needles(value: string): readonly string[] {
  const found = [value, JSON.stringify(value).slice(1, -1)];
  if (URL.canParse(value)) {
    const password = decodeURIComponent(new URL(value).password);
    if (password !== '') found.push(password);
  }
  return [...new Set(found)].filter((needle) => needle.length >= SHORTEST);
}

/** The secrets in `env` whose value appears in any of `files`, each with the file it was found in. */
export function findLeaks(
  files: readonly ClientFile[],
  env: Readonly<Record<string, string | undefined>>,
): readonly { readonly name: string; readonly file: string }[] {
  // A value some VITE_ variable also holds is public by definition: the browser gets it on purpose.
  const shipped = new Set(
    Object.entries(env).flatMap(([name, value]) => (name.startsWith('VITE_') && value !== undefined ? [value] : [])),
  );
  return Object.entries(env).flatMap(([name, value]) => {
    if (!isSecret(name) || value === undefined || value === '' || shipped.has(value)) return [];
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
  const [envFile, dir] = process.argv.slice(2);
  if (envFile === undefined || dir === undefined) {
    console.error('Usage: node apps/web/client-secrets.ts <the pulled env file> <the built static directory>');
    process.exit(2);
  }
  const env = parseEnv(readFileSync(envFile, 'utf8'));
  const files = readAll(dir);
  const checked = Object.entries(env).filter(([name, value]) => isSecret(name) && (value ?? '') !== '');
  // A Sensitive variable comes down from Vercel empty: the check can't see it, so it says so.
  const unseen = CORE_SECRETS.filter((name) => (env[name] ?? '') === '');
  if (unseen.length > 0) {
    console.error(`::warning::Not checked, empty after the pull (unset, or Sensitive): ${unseen.join(', ')}.`);
  }
  const leaks = findLeaks(files, env);
  for (const leak of leaks)
    console.error(`::error::${leak.name}'s value is in ${leak.file}, a file the browser loads.`);
  if (leaks.length > 0) process.exit(1);
  process.stdout.write(
    `No server secret in ${String(files.length)} client files (${String(checked.length)} secrets checked).\n`,
  );
}
