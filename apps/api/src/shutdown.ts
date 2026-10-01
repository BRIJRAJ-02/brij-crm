import { errorFields, log } from './log.ts';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** On SIGTERM (a Railway deploy) or SIGINT, run the cleanup once, then exit. */
export function onShutdown(cleanup: () => Promise<void>): void {
  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log.info('Shutting down', { signal });
    setTimeout(() => {
      log.error('Shutdown timed out');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    try {
      await cleanup();
      process.exit(0);
    } catch (error) {
      log.error('Shutdown failed', errorFields(error));
      process.exit(1);
    }
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    // stop() handles its own errors, so nothing is left unawaited.
    process.once(signal, () => void stop(signal));
  }
}
