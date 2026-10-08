// The load stack's fixed facts and the guards every load command shares (spec
// 0011, AC-193 and AC-210): its addresses, logins and `local-only` secrets
// (the same values `docker-compose.load.yml` holds, which a test keeps in
// step), the localhost guard with no allow host escape, the Docker memory
// check, and where `.load/` lives. Nothing here reaches a remote host.
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { hostsOf } from './local-only.ts';

/** The load stack (`docker-compose.load.yml`): its project, ports, logins and fixed `local-only` secrets. */
export const LOAD_STACK = {
  project: 'crm-load',
  composeFile: 'docker-compose.load.yml',
  /** Host ports, all apart from the dev stack's (5433, 6432, 3000, 3001, 8000, 9000, 1025, 8025). */
  ports: {
    postgres: 5434,
    pgbouncer: 6434,
    api: 3100,
    worker: 3101,
    centrifugo: 8100,
    centrifugoInternal: 9100,
    smtp: 1026,
    mailpit: 8026,
  },
  /** The owner login, direct: migrations, the seed, minting sessions, reset and the bench. */
  ownerUrl: 'postgres://crm_owner:crm_owner_local@localhost:5434/crm',
  /** The app login, through PgBouncer, as the API connects. `pnpm load:seed` creates it. */
  appUrl: 'postgres://crm_app_user:local-only-load-app@localhost:6434/crm',
  /** The identity login, direct. `pnpm load:seed` creates it. */
  identityUrl: 'postgres://crm_identity_user:local-only-load-identity@localhost:5434/crm',
  apiUrl: 'http://localhost:3100',
  centrifugoUrl: 'ws://localhost:8100/connection/websocket',
  /** The API's `BETTER_AUTH_SECRET` on the load stack. The API refuses any secret holding `local-only` outside local. */
  betterAuthSecret: 'local-only-load-stack-better-auth-secret',
  /** The least memory Docker must have for the stack's caps (8 GB Postgres, 2 GB for the rest, and headroom). */
  minDockerMemoryBytes: 11 * 1024 ** 3,
} as const;

/** The services that hold data and connections: up before the database is set up. */
export const DATA_SERVICES = ['postgres', 'pgbouncer', 'centrifugo', 'mailpit'] as const;
/** The API and the worker: they boot only once the migrations ran and the logins exist. */
export const APP_SERVICES = ['api', 'worker'] as const;

/** The repository root, where `docker-compose.load.yml` and `.load/` live. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Where the manifest, the sessions and the results go (gitignored). */
export const LOAD_DIR = fileURLToPath(new URL('../../../.load/', import.meta.url));

/** A load command's addresses (AC-210), every default pointing at the load stack. */
export const LoadUrls = z.object({
  LOAD_DATABASE_URL_OWNER: z.url().default(LOAD_STACK.ownerUrl),
  LOAD_PGBOUNCER_URL: z.url().default(LOAD_STACK.appUrl),
  LOAD_IDENTITY_DATABASE_URL: z.url().default(LOAD_STACK.identityUrl),
  LOAD_API_URL: z.url().default(LOAD_STACK.apiUrl),
  LOAD_CENTRIFUGO_URL: z.url().default(LOAD_STACK.centrifugoUrl),
});
export type LoadUrls = z.infer<typeof LoadUrls>;

/** A setup refusal: the command exits with `exitCode` (3, spec 0011's "setup refused") and prints `message`. */
export interface LoadRefusal extends Error {
  readonly code: 'LOAD_REFUSED';
  readonly exitCode: number;
}

/** A refusal that ends a load command with exit code 3 (or `exitCode`). */
export function loadRefusal(message: string, exitCode = 3): LoadRefusal {
  return Object.assign(new Error(message), { code: 'LOAD_REFUSED' as const, exitCode });
}

/** True when `error` is a `loadRefusal`. */
export function isLoadRefusal(error: unknown): error is LoadRefusal {
  return error instanceof Error && 'code' in error && error.code === 'LOAD_REFUSED';
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Refuses (a `loadRefusal`, exit 3) unless every host each URL names is this
 * machine: its hostname and any `host` in its query string, which
 * node-postgres would follow. A URL with no host is refused (node-postgres
 * would follow PGHOST), and so is one that doesn't parse. There is no allow
 * host: a load command never reaches another machine (AC-210).
 */
export function assertLocalUrls(urls: Readonly<Record<string, string>>): void {
  for (const [name, url] of Object.entries(urls)) {
    if (!URL.canParse(url)) throw loadRefusal(`Refusing ${name}: it isn't a URL a load command can check.`);
    const remote = hostsOf(url).filter((host) => !LOCAL_HOSTS.has(host));
    if (remote.length > 0) {
      throw loadRefusal(`Refusing ${name}: it names ${remote.join(', ')}. Load commands run against localhost only.`);
    }
  }
}

/** Parses the load addresses from `env` and refuses any that isn't localhost. */
export function loadUrls(env: Readonly<Record<string, string | undefined>>): LoadUrls {
  const parsed = LoadUrls.safeParse(env);
  if (!parsed.success) throw loadRefusal(`Invalid load addresses:\n${z.prettifyError(parsed.error)}`);
  assertLocalUrls(parsed.data);
  return parsed.data;
}

/** Whether a database URL is the load stack's own Postgres (its port on this machine), which `load:seed` may start. */
export function isLoadStackDatabase(url: string): boolean {
  const parsed = new URL(url);
  return LOCAL_HOSTS.has(parsed.hostname) && parsed.port === String(LOAD_STACK.ports.postgres);
}

/** The dev stack's Postgres port (docker-compose.yml), which a load command never sets logins on by default. */
export const DEV_POSTGRES_PORT = 5433;

/**
 * Refuses (exit 3) to create logins anywhere but the load stack unless both
 * login URLs are named explicitly and with their own login names. Setting up a
 * database resets its logins' passwords, and the stack's login names
 * (`crm_app_user`, `crm_identity_user`) are the dev stack's too, so pointing
 * `load:seed` at another Postgres (the dev one on 5433, say) with the defaults
 * would break every app connected to it. Roles belong to the whole server.
 */
export function assertLoginsApart(env: Readonly<Record<string, string | undefined>>, urls: LoadUrls): void {
  if (isLoadStackDatabase(urls.LOAD_DATABASE_URL_OWNER)) return;
  const owner = new URL(urls.LOAD_DATABASE_URL_OWNER);
  const where = owner.port === String(DEV_POSTGRES_PORT) ? 'the dev Postgres' : 'a Postgres other than the load stack';
  const stackLogins = new Set([new URL(LOAD_STACK.appUrl).username, new URL(LOAD_STACK.identityUrl).username]);
  for (const name of ['LOAD_PGBOUNCER_URL', 'LOAD_IDENTITY_DATABASE_URL'] as const) {
    const login = new URL(urls[name]).username;
    if (env[name] === undefined || stackLogins.has(login)) {
      throw loadRefusal(
        `Refusing to set up logins on ${where} with ${name} ${env[name] === undefined ? 'unset' : `as ${login}`}: ` +
          'it would reset the passwords other apps there connect with. Name its own login (a load_ prefixed one) in ' +
          `${name}, or use the load stack (\`pnpm load:stack\`).`,
      );
    }
  }
}

/** Refuses (exit 3) when Docker has less memory than the load stack needs, naming what it found. */
export function assertDockerMemory(bytes: number): void {
  if (bytes >= LOAD_STACK.minDockerMemoryBytes) return;
  const gb = (value: number) => (value / 1024 ** 3).toFixed(2);
  throw loadRefusal(
    `Docker has ${gb(bytes)} GB of memory; the load stack needs at least ${gb(LOAD_STACK.minDockerMemoryBytes)} GB ` +
      '(Postgres alone is capped at 8 GB). Raise it in Docker Desktop, Settings, Resources (12 GB on the reference machine).',
  );
}

/** Runs a load command's `main`, ending the process with a refusal's exit code and message, or 1 on a crash. */
export async function runLoadCommand(main: () => Promise<void> | void): Promise<void> {
  try {
    await main();
  } catch (error) {
    if (isLoadRefusal(error)) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(error);
    process.exit(1);
  }
}
