// Sentry for the api and the worker (spec 0010): the one module that imports
// `@sentry/node` (AC-184). It sends unexpected errors only, each with the
// request it belongs to, and nothing personal: no request bodies, cookies,
// headers beyond two, query strings, local variables or user fields beyond the
// id, and `scrub` runs in every send hook (AC-165). Every export is a no op
// until `startSentry` runs, which `instrument.ts` does only when a DSN is set,
// so local runs and tests send nothing and fail nothing (AC-166).
import type { AppEnvironment } from '@crm/contracts';
import { scrub } from '@crm/contracts/monitoring';
import {
  type Breadcrumb,
  captureException,
  createTransport,
  type ErrorEvent,
  flush as flushEvents,
  getIsolationScope,
  init,
  isInitialized,
  type NodeOptions,
  onUnhandledRejectionIntegration,
  withIsolationScope,
} from '@sentry/node';
import { queryFailure, safeError } from '../query-errors.ts';

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

// Default integrations left out (the rejection handler is replaced, in strict mode).
const DROPPED_INTEGRATIONS: ReadonlySet<string> = new Set(['ProcessSession', 'Console', 'OnUnhandledRejection']);

/** A breadcrumb fit to send, or null to drop it. */
export function keepBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category !== undefined && DROPPED_BREADCRUMBS.has(breadcrumb.category)) return null;
  return scrub(breadcrumb);
}

/**
 * An event whose error is a failed query, as `safeError` would send it: only
 * the outermost exception (Sentry lists causes first and the thrown error
 * last), named by SQLSTATE and constraint. This covers what the SDK catches
 * itself (an uncaught exception, an unhandled rejection) and the causes its
 * linked errors would add, not only what `captureFault` sends.
 */
export function withoutQueryValues(event: ErrorEvent, original: unknown): ErrorEvent {
  if (queryFailure(original) === undefined) return event;
  const safe = safeError(original);
  const outermost = event.exception?.values?.at(-1);
  const name = safe instanceof Error ? safe.name : 'Error';
  const message = safe instanceof Error ? safe.message : 'Query failed';
  return {
    ...event,
    message: undefined,
    // The type stays as the SDK named it (the error class, never a value); the message is the safe one.
    exception: { values: [{ ...outermost, type: outermost?.type ?? name, value: message }] },
  };
}

/**
 * The SDK's options: errors only, nothing personal collected, and `scrub` in
 * every send hook. Exported so tests can read them; `startSentry` uses them.
 */
export function sentryOptions(config: SentryConfig): NodeOptions {
  const { deliver } = config;
  return {
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
    // Node 24 stops on an unhandled rejection; a listener in warn mode would keep a broken process running.
    // Strict mode reports it, then exits the same way, so monitoring changes nothing about how the app fails.
    // No process session (release health would carry the last request's user id) and no console patching
    // (its breadcrumbs are dropped anyway).
    integrations: (defaults) => [
      ...defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name)),
      onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    // Fetch errors keep their own message; only what is sent gets the host.
    enhanceFetchErrorMessages: 'report-only',
    beforeSend: (event, hint) => scrub(withoutQueryValues(event, hint.originalException)),
    beforeBreadcrumb: keepBreadcrumb,
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
  withIsolationScope((scope) => {
    // Nothing of a request this fault may have inherited: no user, workspace or request id.
    scope.setUser(null);
    scope.setTags({ request_id: undefined, workspace_id: undefined });
    captureException(safe, { tags });
  });
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

/** The longest a shutdown waits for monitoring to send what it holds (AC-166), inside the 10 second window. */
export const MONITORING_FLUSH_MS = 2000;

/** Sends what is queued, waiting at most `timeoutMs`. Never rejects. */
export async function flush(timeoutMs: number): Promise<void> {
  if (!isInitialized()) return;
  await flushEvents(timeoutMs).catch(() => false);
}
