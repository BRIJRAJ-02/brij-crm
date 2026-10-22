// One container, two processes (spec 0044, Render's free plan): the free plan has no pre deploy step and one
// service, so this launcher migrates first, then runs the api and the worker as two child Node processes, each
// with Sentry's instrument and its own heap cap inside the shared 512 MB. Signals reach both children. If either
// child dies on its own, the other is stopped and the launcher exits non zero, so Render restarts the container.
// The worker's port stays inside the container: the api wakes it at WORKER_INTERNAL_URL=http://127.0.0.1:<port>.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { errorFields, log } from './log.ts';

/** A running child process, as much of it as the launcher needs. */
export interface Child {
  /** Sends a signal; a child that has already exited ignores it. */
  readonly kill: (signal: NodeJS.Signals) => void;
  /** Called once when the child exits: its exit code, or null when a signal ended it. */
  readonly onExit: (listener: (code: number | null) => void) => void;
}

/** What `launch` does to the world, passed in so tests can drive it. */
export interface LaunchDeps {
  /** Starts `node <args>` with this process's environment and output. */
  readonly run: (args: readonly string[]) => Child;
  /** Subscribes to a signal sent to the launcher. */
  readonly onSignal: (signal: NodeJS.Signals, listener: () => void) => void;
  /** Ends the launcher. */
  readonly exit: (code: number) => void;
  /** Runs `task` after `ms`, the backstop for a child that ignores SIGTERM. */
  readonly later: (ms: number, task: () => void) => void;
  readonly log: Pick<typeof log, 'info' | 'error'>;
}

const INSTRUMENT = ['--import', './apps/api/src/monitoring/instrument.ts'];

/** The migration, exactly the script Railway's pre deploy step ran (owner login, direct connection). */
export const MIGRATE_ARGS: readonly string[] = ['packages/db/scripts/migrate.ts'];

/**
 * The api and the worker, with heap caps that fit Render's free 512 MB beside each other: about 40 MB for the
 * launcher and about 45 MB outside the heap for each child leave 192 MB for the api's heap and 128 MB for the
 * worker's (its jobs are off in production; the relay is off without Centrifugo).
 */
export const PROCESSES: Readonly<Record<'api' | 'worker', readonly string[]>> = {
  api: ['--max-old-space-size=192', ...INSTRUMENT, 'apps/api/src/server.ts'],
  worker: ['--max-old-space-size=128', ...INSTRUMENT, 'apps/api/src/worker.ts'],
};

/** How long a child gets after SIGTERM before the launcher exits anyway (Render's own window is 30 s). */
export const STOP_GRACE_MS = 25_000;

const SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Migrates, then runs the api and the worker until a signal or a child's own exit. Exits 0 when a signal stopped
 * both cleanly, and 1 when the migration failed (nothing starts), a child died on its own, or a child failed to
 * stop cleanly.
 */
export function launch(deps: LaunchDeps): void {
  const running = new Set<Child>();
  const state = { stopping: false, failed: false, exited: false };

  const finish = () => {
    if (state.exited) return;
    state.exited = true;
    deps.exit(state.failed ? 1 : 0);
  };

  const stopAll = (signal: NodeJS.Signals) => {
    if (state.stopping) return;
    state.stopping = true;
    for (const child of running) child.kill(signal);
    if (running.size === 0) finish();
    else
      deps.later(STOP_GRACE_MS, () => {
        if (running.size > 0) {
          deps.log.error('launch.stop.timeout', { left: running.size });
          state.failed = true;
          finish();
        }
      });
  };

  for (const signal of SIGNALS) {
    deps.onSignal(signal, () => {
      deps.log.info('launch.signal', { signal });
      stopAll(signal);
    });
  }

  const migrate = deps.run(MIGRATE_ARGS);
  running.add(migrate);
  migrate.onExit((code) => {
    running.delete(migrate);
    if (state.stopping) {
      finish();
      return;
    }
    if (code !== 0) {
      deps.log.error('launch.migrate.failed', { code });
      state.failed = true;
      state.stopping = true;
      finish();
      return;
    }
    for (const name of ['api', 'worker'] as const) {
      const child = deps.run(PROCESSES[name]);
      running.add(child);
      child.onExit((exitCode) => {
        running.delete(child);
        if (!state.stopping) {
          deps.log.error('launch.child.died', { process: name, code: exitCode });
          state.failed = true;
          stopAll('SIGTERM');
        } else if (exitCode !== 0) {
          state.failed = true;
        }
        if (running.size === 0) finish();
      });
    }
  });
}

/** `node <args>` as a child of this process, sharing its environment and output. */
function runNode(args: readonly string[]): Child {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  return {
    kill: (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    },
    onExit: (listener) => {
      const once = { done: false };
      const report = (code: number | null) => {
        if (once.done) return;
        once.done = true;
        listener(code);
      };
      child.on('exit', (code) => report(code));
      child.on('error', (error) => {
        log.error('launch.spawn.failed', errorFields(error));
        report(1);
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  launch({
    run: runNode,
    onSignal: (signal, listener) => process.on(signal, listener),
    exit: (code) => process.exit(code),
    later: (ms, task) => setTimeout(task, ms).unref(),
    log,
  });
}
