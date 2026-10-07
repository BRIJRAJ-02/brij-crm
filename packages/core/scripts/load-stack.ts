// `pnpm load:stack`, `load:stack:down` and `load:stack:wipe` (spec 0011,
// AC-193): start, stop or delete the load stack in `docker-compose.load.yml`
// (project `crm-load`). Starting refuses (exit 3) when Docker has under 11 GB
// of memory, and exits 1 when Docker is missing. The data services start
// first; the API and the worker start too once the database has its logins
// (`pnpm load:seed` sets them up, then starts them). The dev stack, its
// project and its volume are never named, so nothing here can touch them.
import { spawnSync } from 'node:child_process';
import {
  APP_SERVICES,
  assertDockerMemory,
  DATA_SERVICES,
  LOAD_STACK,
  REPO_ROOT,
  runLoadCommand,
} from './load-local.ts';

/** Runs `docker` with `args` from the repository root, streaming its output; the exit status, or undefined without Docker. */
function docker(args: readonly string[], capture = false): { status: number | undefined; stdout: string } {
  const result = spawnSync('docker', args, {
    cwd: REPO_ROOT,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error !== undefined) return { status: undefined, stdout: '' };
  return { status: result.status ?? 1, stdout: typeof result.stdout === 'string' ? result.stdout : '' };
}

/** `docker compose` on the load stack's own file and project. */
const COMPOSE = ['compose', '-f', LOAD_STACK.composeFile, '-p', LOAD_STACK.project] as const;

function compose(args: readonly string[], capture = false) {
  return docker([...COMPOSE, ...args], capture);
}

function must(result: { status: number | undefined }, what: string): void {
  if (result.status === undefined) {
    console.error('Docker is missing. Install Docker Desktop (or OrbStack) and start it.');
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${what} failed (docker exited ${String(result.status)}).`);
    process.exit(1);
  }
}

/** Docker's memory in bytes; exits 1 when Docker is missing or not running. */
function dockerMemory(): number {
  const result = docker(['info', '--format', '{{.MemTotal}}'], true);
  must(result, 'Reading Docker’s memory');
  const bytes = Number(result.stdout.trim());
  if (!Number.isFinite(bytes) || bytes <= 0) {
    console.error(`Docker reported no memory size ("${result.stdout.trim()}").`);
    process.exit(1);
  }
  return bytes;
}

/** Whether the load database has both logins the API and the worker connect as. */
function hasLogins(): boolean {
  const result = compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'crm',
      '-tAc',
      "select count(*) from pg_roles where rolname in ('crm_app_user', 'crm_identity_user')",
    ],
    true,
  );
  return result.status === 0 && result.stdout.trim() === '2';
}

/**
 * Starts the load stack's data services (refusing under 11 GB of Docker
 * memory) and waits for them, then the API and the worker when `apps` is
 * true, or when it is `'when-ready'` and the database already has its logins.
 */
export function startLoadStack(apps: boolean | 'when-ready'): void {
  assertDockerMemory(dockerMemory());
  must(compose(['up', '-d', '--wait', ...DATA_SERVICES]), 'Starting the load stack');
  const withApps = apps === 'when-ready' ? hasLogins() : apps;
  if (!withApps) {
    console.log(
      'The load database has no logins yet: `pnpm load:seed` sets it up, then starts the API and the worker.',
    );
    return;
  }
  must(compose(['up', '-d', '--build', '--wait', ...APP_SERVICES]), 'Starting the API and the worker');
  console.log(`The load stack is up: the API on ${LOAD_STACK.apiUrl}.`);
}

/** Whether the load stack's Postgres is running and healthy. */
export function isLoadStackUp(): boolean {
  const result = compose(['ps', '--status', 'running', '--format', '{{.Service}} {{.Health}}'], true);
  return result.status === 0 && /^postgres healthy$/m.test(result.stdout);
}

function main(): void {
  const command = process.argv[2] ?? 'up';
  switch (command) {
    case 'up':
      startLoadStack('when-ready');
      return;
    case 'down':
      must(compose(['down']), 'Stopping the load stack');
      return;
    case 'wipe':
      must(compose(['down', '--volumes']), 'Wiping the load stack');
      console.log('The load stack is down and its volume is deleted. `pnpm load:seed` starts and fills it again.');
      return;
    default:
      console.error(`Unknown command "${command}": use up, down or wipe.`);
      process.exit(1);
  }
}

if (import.meta.main) await runLoadCommand(main);
