// Sentry for the api and the worker (spec 0010): the one module that imports
// `@sentry/node` (AC-184). It sends unexpected errors, each with the request it
// belongs to, and the api's request traces (AC-170: named per procedure and
// sign in route, sampled by environment, never a health check; the worker
// traces nothing), the worker's metrics, heartbeat and `RELAY_LAGGING`
// (milestone 4), and nothing personal: no request bodies, cookies,
// headers beyond two, query strings, local variables or user fields beyond the
// id, and `scrub` runs in every send hook (AC-165). Every export is a no op
// until `startSentry` runs, which `instrument.ts` does only when a DSN is set,
// so local runs and tests send nothing and fail nothing (AC-166).
import type { AppEnvironment } from '@crm/contracts';
import { scrub } from '@crm/contracts/monitoring';
import {
  type Breadcrumb,
  captureCheckIn,
  captureException,
  captureMessage,
  createTransport,
  type ErrorEvent,
  flush as flushEvents,
  getActiveSpan,
  getClient,
  getGlobalScope,
  getIsolationScope,
  getRootSpan,
  init,
  isInitialized,
  metrics as sentryMetrics,
  type NodeOptions,
  Scope,
  onUnhandledRejectionIntegration,
  updateSpanName,
  withActiveSpan,
  withIsolationScope,
  withScope,
} from '@sentry/node';
import { queryFailure, safeError } from '../query-errors.ts';
import { keepSpanOrBlank, requestSampleRate } from './tracing.ts';

/** Which process is sending: the api or the worker (one Sentry project, tagged by service). */
export type Service = 'api' | 'worker';

/** What `startSentry` needs: where to send, and what every event says about where it came from. */
export interface SentryConfig {
  readonly dsn: string;
  readonly environment: AppEnvironment;
  /** The commit (`RAILWAY_GIT_COMMIT_SHA`), else `local`. */
  readonly release: string;
  readonly service: Service;
  /** Tests only: delivers each envelope here instead of to Sentry. */
  readonly deliver?: (envelope: string) => Promise<void>;
}

/** What is known about an unexpected error beyond the error itself. */
export interface FaultContext {
  /** The request's id, the same value as the answer's `x-request-id`. */
  readonly requestId?: string;
  /** The oRPC procedure (`records.query`). */
  readonly procedure?: string;
  /** The HTTP path, for an error outside a procedure. */
  readonly route?: string;
  /** What the process was doing, for a fault outside any request (`database pool`, `start`). */
  readonly task?: string;
}

const decoder = new TextDecoder();

// Breadcrumbs that are never kept: a log line can quote a value.
const DROPPED_BREADCRUMBS: ReadonlySet<string> = new Set(['console']);

// Default integrations left out (the rejection handler is replaced, in strict mode). Hono's would rename each
// trace after its route pattern (`POST /api/rpc/*`, over `nameRequest`'s procedure) and send each error `app.ts`
// answers a second time, around `captureFault`.
const DROPPED_INTEGRATIONS: ReadonlySet<string> = new Set([
  'ProcessSession',
  'Console',
  'OnUnhandledRejection',
  'Hono',
]);

/**
 * The metrics the processes record (spec 0010, milestone 4), each with its
 * unit: a closed list, so a name can never carry an id. `relay.lag` is each
 * published row's delay from commit to publish (AC-179); the three gauges are
 * the worker's stats tick (AC-180): awake (1) or asleep (0), and the relay's
 * unpublished rows and the oldest one's age.
 */
export const METRIC_UNITS = {
  'relay.lag': 'millisecond',
  'worker.awake': 'none',
  'outbox.pending': 'none',
  'outbox.oldest_age_s': 'second',
} as const;

/** One of the metrics in `METRIC_UNITS`. */
export type MetricName = keyof typeof METRIC_UNITS;

const isMetricName = (name: string): name is MetricName => Object.hasOwn(METRIC_UNITS, name);

// Scope attributes (`scope.setAttributes`) join a metric after this hook runs, out of its reach: nothing here sets
// any, and nothing may, or they would reach every metric.

/** What a metric may say about where it came from beside `service`: the environment, release and SDK, no more. */
const KEPT_METRIC_ATTRIBUTES: readonly string[] = [
  'sentry.environment',
  'sentry.release',
  'sentry.sdk.name',
  'sentry.sdk.version',
];

/** The SDK's view of a metric, as `beforeSendMetric` receives it. */
type SentMetric = Parameters<NonNullable<NodeOptions['beforeSendMetric']>>[0];

/**
 * The metric hook: only a metric named in `METRIC_UNITS` leaves, and its
 * attributes are `service` and the environment, release and SDK the SDK adds,
 * nothing else (no user, host or anything a caller added), so no metric
 * carries a workspace, record or user id (AC-182).
 */
export function keepMetric(service: Service): (metric: SentMetric) => SentMetric | null {
  return (metric) => {
    if (!isMetricName(metric.name)) return null;
    const attributes = metric.attributes ?? {};
    const kept = Object.fromEntries(
      KEPT_METRIC_ATTRIBUTES.filter((key) => typeof attributes[key] === 'string').map((key) => [key, attributes[key]]),
    );
    return { ...metric, attributes: { ...kept, service } };
  };
}

/** The SDK's view of an integration, as the `integrations` option hands them over. */
type SdkIntegration = Parameters<
  Extract<NonNullable<NodeOptions['integrations']>, (...args: never[]) => unknown>
>[0][number];

/**
 * The SDK's Dedupe, except for the issues the processes raise themselves
 * (`raiseIssue`): it drops an event identical to the one before it, and a
 * `RELAY_LAGGING` raised again an hour later, or in a later episode, is
 * identical by design (one message, one fingerprint, no stack). Every other
 * event is still deduplicated.
 */
export function passRaisedIssues(dedupe: SdkIntegration): SdkIntegration {
  if (dedupe.processEvent === undefined) return dedupe;
  return {
    ...dedupe,
    processEvent: (event, hint, client) => {
      const [first, ...rest] = event.fingerprint ?? [];
      const raised = first !== undefined && rest.length === 0 && Object.hasOwn(ISSUES, first);
      return raised || dedupe.processEvent === undefined ? event : dedupe.processEvent(event, hint, client);
    },
  };
}

/** A breadcrumb fit to send, or null to drop it. */
export function keepBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category !== undefined && DROPPED_BREADCRUMBS.has(breadcrumb.category)) return null;
  return scrub(breadcrumb);
}

/**
 * An event whose error is a failed query, as `safeError` would send it: every
 * exception in the chain (the thrown error and the causes linked errors add)
 * keeps its type and stack, and each message becomes the safe one, named by
 * SQLSTATE and constraint. This covers what the SDK catches itself (an
 * uncaught exception, an unhandled rejection), not only what `captureFault`
 * sends.
 */
export function withoutQueryValues(event: ErrorEvent, original: unknown): ErrorEvent {
  if (queryFailure(original) === undefined) return event;
  const safe = safeError(original);
  const name = safe instanceof Error ? safe.name : 'Error';
  const message = safe instanceof Error ? safe.message : 'Query failed';
  const values = event.exception?.values ?? [{}];
  return {
    ...event,
    message: undefined,
    // The type stays as the SDK named it (the error class, never a value); the message is the safe one.
    exception: { values: values.map((value) => ({ ...value, type: value.type ?? name, value: message })) },
  };
}

/**
 * A whole transaction, should spans ever stop streaming (`traceLifecycle:
 * 'static'`, where the SDK skips `keepSpan`): it leaves with its name, timing
 * and request as `scrub` keeps them, and none of its spans or trace data, so
 * nothing `keepSpan` would have dropped goes out unread.
 */
export function transactionBackstop<T extends { spans?: unknown; contexts?: { trace?: object } }>(event: T): T {
  const { spans: _spans, ...rest } = scrub(event);
  const trace = rest.contexts?.trace;
  if (trace === undefined) return rest as T;
  const { data: _data, ...placed } = trace as { data?: unknown };
  return { ...rest, contexts: { ...rest.contexts, trace: placed } } as T;
}

/**
 * How the process traces (AC-170): the api samples each request by its
 * environment and path (`requestSampleRate`); the worker doesn't trace at all
 * (no rate set, so no span is even recorded: errors only). Spans stream
 * (`traceLifecycle: 'stream'`, so every one passes `beforeSendSpan`). Trace
 * headers go to no outgoing call (Resend, Google, Centrifugo, the worker's
 * poke), and a request that brings its own trace is never sampled.
 */
function tracingOptions(config: SentryConfig): NodeOptions {
  const shared = {
    tracePropagationTargets: [],
    strictTraceContinuation: true,
    traceLifecycle: 'stream',
  } satisfies NodeOptions;
  if (config.service === 'worker') return shared;
  return { ...shared, tracesSampler: (context) => requestSampleRate(config.environment, context) };
}

/**
 * The SDK's options: errors and the api's request traces, nothing personal
 * collected, and `scrub` in every send hook (`keepSpan` for spans). Exported
 * so tests can read them; `startSentry` uses them.
 */
export function sentryOptions(config: SentryConfig): NodeOptions {
  const { deliver } = config;
  return {
    ...tracingOptions(config),
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    initialScope: { tags: { service: config.service } },
    // Nothing the SDK could collect on its own that might name a person or carry a value.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['content-type', 'x-request-id'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    includeLocalVariables: false,
    // No host name on events or metrics: on a laptop it often names its owner.
    includeServerName: false,
    // Node 24 stops on an unhandled rejection; a listener in warn mode would keep a broken process running.
    // Strict mode reports it, then exits the same way, so monitoring changes nothing about how the app fails.
    // No process session (release health would carry the last request's user id) and no console patching
    // (its breadcrumbs are dropped anyway).
    integrations: (defaults) => [
      ...defaults
        .filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name))
        .map((integration) => (integration.name === 'Dedupe' ? passRaisedIssues(integration) : integration)),
      onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    // Fetch errors keep their own message; only what is sent gets the host.
    enhanceFetchErrorMessages: 'report-only',
    beforeSend: (event, hint) => scrub(withoutQueryValues(event, hint.originalException)),
    beforeBreadcrumb: keepBreadcrumb,
    beforeSendSpan: keepSpanOrBlank,
    beforeSendTransaction: transactionBackstop,
    beforeSendMetric: keepMetric(config.service),
    ...(deliver === undefined
      ? {}
      : {
          transport: (options) =>
            createTransport(options, async (request) => {
              await deliver(typeof request.body === 'string' ? request.body : decoder.decode(request.body));
              return { statusCode: 200 };
            }),
        }),
  };
}

/** Starts Sentry for this process. `instrument.ts` calls it once, before anything else loads, when a DSN is set. */
export function startSentry(config: SentryConfig): void {
  init(sentryOptions(config));
  // On the global scope too, so a scope cleared for a fault outside any request still names the service.
  getGlobalScope().setTag('service', config.service);
}

/** Whether Sentry is sending in this process. */
export function isSentryStarted(): boolean {
  return isInitialized();
}

/**
 * Sends an unexpected error, tagged with what `context` knows. Expected
 * refusals never come here (callers check `toApiError(...).expected`). A
 * failed query goes as `safeError` makes it, never with its values. A fault
 * outside any request (`context.task`: a pool error, a start, the relay) is
 * sent from a scope of its own, since its callback can run in the async
 * context of whichever request opened the connection. It queues the event in
 * memory and never waits for the network.
 */
export function captureFault(error: unknown, context: FaultContext = {}): void {
  if (!isInitialized()) return;
  const tags = Object.fromEntries(
    Object.entries({
      request_id: context.requestId,
      procedure: context.procedure,
      route: context.route,
      task: context.task,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const safe = safeError(error);
  if (context.task === undefined) {
    captureException(safe, { tags });
    return;
  }
  outsideAnyRequest(() => {
    captureException(safe, { tags });
  });
}

/**
 * Runs `send` with nothing of a request it may have inherited: no user,
 * workspace, request id, request data, breadcrumbs or trace. Fresh scopes on
 * the same client, and no active span (with tracing on, the request's span
 * would otherwise lend the event its trace); the service tag lives on the
 * global scope.
 */
function outsideAnyRequest(send: () => void): void {
  const client = getClient();
  const fresh = () => {
    const scope = new Scope();
    scope.setClient(client);
    return scope;
  };
  withActiveSpan(null, () => withIsolationScope(fresh(), () => withScope(fresh(), send)));
}

/**
 * Names the current request's trace, and the errors it sends (AC-170): `rpc
 * records.query` for a procedure, `auth /sign-in/email-otp` for a sign in
 * route. Called once the request is known to be one of those, so a name never
 * comes from a path a caller made up.
 */
export function nameRequest(name: string): void {
  if (!isInitialized()) return;
  getIsolationScope().setTransactionName(name);
  const active = getActiveSpan();
  if (active !== undefined) updateSpanName(getRootSpan(active), name);
}

/**
 * Runs one request in its own scope, tagged with its id, so what
 * `setRequestScope` adds (the user, the workspace) stays with this request.
 */
export function withRequestScope<T>(requestId: string, run: () => T): T {
  if (!isInitialized()) return run();
  return withIsolationScope((scope) => {
    scope.setTag('request_id', requestId);
    return run();
  });
}

/** Adds who is asking and where to the current request's scope: the user id, and the workspace once the door let them in. */
export function setRequestScope({ userId, workspaceId }: { userId?: string; workspaceId?: string }): void {
  if (!isInitialized()) return;
  const scope = getIsolationScope();
  if (userId !== undefined) scope.setUser({ id: userId });
  if (workspaceId !== undefined) scope.setTag('workspace_id', workspaceId);
}

/**
 * The metrics this process records, named in `METRIC_UNITS`: held in memory
 * and sent by the SDK every few seconds, so a call never waits for the
 * network. Each does nothing until Sentry starts, and drops a value that
 * isn't a finite number.
 */
export const metrics = {
  /** One value of a distribution (`relay.lag`), charted at percentiles. */
  distribution(name: MetricName, value: number): void {
    if (!isInitialized() || !Number.isFinite(value)) return;
    sentryMetrics.distribution(name, value, { unit: METRIC_UNITS[name] });
  },
  /** A gauge's value now (`worker.awake`, `outbox.pending`, `outbox.oldest_age_s`). */
  gauge(name: MetricName, value: number): void {
    if (!isInitialized() || !Number.isFinite(value)) return;
    sentryMetrics.gauge(name, value, { unit: METRIC_UNITS[name] });
  },
} as const;

/** A cron monitor's settings, as a check in carries them to create or update it. */
type MonitorConfig = NonNullable<Parameters<typeof captureCheckIn>[1]>;

/** The cron monitor the worker's stats tick checks in to (AC-181). */
export const HEARTBEAT_MONITOR = 'worker-heartbeat';

/**
 * The heartbeat's monitor, created or updated by its first check in: one a
 * minute, missed after 2 minutes more (3 minutes without one), one missed
 * check in opens an issue and one on time closes it.
 */
export const HEARTBEAT_SCHEDULE: MonitorConfig = {
  schedule: { type: 'interval', value: 1, unit: 'minute' },
  checkinMargin: 2,
  timezone: 'Etc/UTC',
  failureIssueThreshold: 1,
  recoveryThreshold: 1,
};

/**
 * Checks in to `worker-heartbeat` (AC-181): the process lives. Sent from
 * memory, awake or asleep, so it never touches the database; production only
 * (the free plan's one cron monitor), and a no op until Sentry starts.
 */
export function heartbeat(): void {
  if (!isInitialized() || getClient()?.getOptions().environment !== 'production') return;
  outsideAnyRequest(() => {
    captureCheckIn({ monitorSlug: HEARTBEAT_MONITOR, status: 'ok' }, HEARTBEAT_SCHEDULE);
  });
}

/** The issues the processes raise themselves, each with its one fixed fingerprint and message. */
export const ISSUES = {
  RELAY_LAGGING: 'Live updates are behind: the oldest unpublished change has waited over 30 seconds',
} as const;

/** One of the codes in `ISSUES`. */
export type IssueCode = keyof typeof ISSUES;

/** The numbers each issue carries, named per code, so no key can be an id. */
export interface IssueNumbers {
  /** The relay's unpublished rows, and how long the oldest has waited, in seconds. */
  readonly RELAY_LAGGING: { readonly pending: number; readonly oldest_age_s: number };
}

/**
 * Raises a warning issue the process found itself (`RELAY_LAGGING`, AC-182):
 * one fingerprint per code, so every episode lands on one issue, with its
 * numbers (counts and ages only, never an id) in the `numbers` context. Sent
 * outside any request, never waiting for the network; a no op until Sentry
 * starts.
 */
export function raiseIssue<Code extends IssueCode>(code: Code, numbers: IssueNumbers[Code]): void {
  if (!isInitialized()) return;
  outsideAnyRequest(() => {
    captureMessage(ISSUES[code], {
      level: 'warning',
      fingerprint: [code],
      tags: { code },
      contexts: { numbers: { ...numbers } },
    });
  });
}

/** The longest a shutdown waits for monitoring to send what it holds (AC-166), inside the 10 second window. */
export const MONITORING_FLUSH_MS = 2000;

/** Sends what is queued, waiting at most `timeoutMs`. Never rejects. */
export async function flush(timeoutMs: number): Promise<void> {
  if (!isInitialized()) return;
  await flushEvents(timeoutMs).catch(() => false);
}
