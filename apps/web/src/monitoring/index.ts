// Monitoring in the browser (spec 0010, AC-163, AC-169), without the vendor:
// with no DSN in the build it is a no op; with one, it buffers faults from the
// first moment, loads the Sentry chunk without waiting for it, and hands React
// the root error options. Only unexpected faults go (`expected.ts`): a
// DataError is the data layer's answer (it reports what the server never saw
// itself), the router's not found and redirect are how routing works, and
// fetch failing offline is the network.
import type { ErrorInfo } from 'react';
import { createFaultBuffer, type Fault, type FaultBuffer, type FaultTarget } from './buffer.ts';
import { isExpected } from './expected.ts';
import type { SentryConfig } from './sentry.ts';

export type { Fault } from './buffer.ts';
export { isExpected } from './expected.ts';

/** What the build says about monitoring. */
export interface MonitoringConfig {
  /** `VITE_SENTRY_DSN_WEB`; unset means monitoring is off. */
  readonly dsn: string | undefined;
  readonly release: string;
  readonly environment: string;
  /** The route pattern open now. */
  readonly route: () => string | undefined;
}

/** React 19's root error options, as `createRoot` takes them. */
export interface RootErrorOptions {
  readonly onUncaughtError?: (error: unknown, info: ErrorInfo) => void;
  readonly onCaughtError?: (error: unknown, info: ErrorInfo) => void;
  readonly onRecoverableError?: (error: unknown, info: ErrorInfo) => void;
}

/** Monitoring as the app uses it. */
export interface Monitor {
  /** Reports a fault; an expected one (a DataError, a route's not found or redirect) is dropped here. */
  readonly report: (fault: Fault) => void;
  /** For `createRoot`: none when monitoring is off, so React keeps its own defaults. */
  readonly rootOptions: RootErrorOptions;
}

/** Loads the Sentry chunk: `() => import('./monitoring/sentry.ts')`, so it never joins the first load. */
export type LoadSentry = () => Promise<{
  readonly startSentry: (config: SentryConfig, buffered: FaultBuffer) => void;
}>;

/** Monitoring when the build has no DSN: nothing listens, nothing loads, nothing is sent. */
const OFF: Monitor = { report: () => undefined, rootOptions: {} };

/**
 * Starts monitoring: a buffer on `target` at once, then the Sentry chunk,
 * which is never awaited. `logError` keeps React's own console output for
 * errors, since these options replace its defaults.
 */
export function startMonitoring({
  config,
  target,
  load,
  logError = (error) => {
    console.error(error);
  },
}: {
  readonly config: MonitoringConfig;
  readonly target: FaultTarget;
  readonly load: LoadSentry;
  readonly logError?: (error: unknown) => void;
}): Monitor {
  const { dsn } = config;
  if (dsn === undefined || dsn === '') return OFF;
  // The window's own errors pass the same test as reports: a refusal or being offline is no fault.
  const buffer = createFaultBuffer({ target, ignore: isExpected });
  load()
    .then(({ startSentry }) => {
      startSentry({ dsn, release: config.release, environment: config.environment, route: config.route }, buffer);
    })
    .catch(() => {
      // The chunk never came (offline, a deploy in between): stop listening and keep nothing.
      buffer.drain(() => undefined);
    });

  const report = (fault: Fault) => {
    if (!isExpected(fault.error)) buffer.report(fault);
  };
  const fromReact =
    (handled: boolean) =>
    (error: unknown, info: ErrorInfo): void => {
      report({ error, handled, ...(info.componentStack ? { componentStack: info.componentStack } : {}) });
      logError(error);
    };
  return {
    report,
    rootOptions: {
      onUncaughtError: fromReact(false),
      onCaughtError: fromReact(true),
      onRecoverableError: fromReact(true),
    },
  };
}
