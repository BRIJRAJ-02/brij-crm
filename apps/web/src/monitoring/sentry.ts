// Sentry in the browser (spec 0010): the one module that imports
// `@sentry/react` (AC-184). Errors only: no tracing, no replay, no logs. It is
// loaded in its own chunk, never in the first load (AC-169), and started by
// `startMonitoring` only when the build carries a DSN. Nothing personal goes
// (AC-165): the SDK collects nothing on its own, `scrub` runs in every send
// hook, console, input and navigation breadcrumbs are dropped, fetch
// breadcrumbs keep the path only, and an event names the route pattern
// (`/w/$slug/objects/$object`), never the address that was open.
import { scrub } from '@crm/contracts/monitoring';
import {
  type Breadcrumb,
  type BrowserOptions,
  captureException,
  createTransport,
  type ErrorEvent,
  init,
  withScope,
} from '@sentry/react';
import type { Fault, FaultBuffer } from './buffer.ts';

/** What the browser's Sentry needs. */
export interface SentryConfig {
  readonly dsn: string;
  /** The commit the build came from (`GITHUB_SHA`), else `local`. */
  readonly release: string;
  /** `production` or `preview` (`VERCEL_ENV` at build), else `local`. */
  readonly environment: string;
  /** The route pattern open now (the router's matched route id), or undefined before the router runs. */
  readonly route: () => string | undefined;
  /** Tests only: delivers each envelope here instead of to Sentry. */
  readonly deliver?: (envelope: string) => Promise<void>;
}

// Breadcrumbs never kept: a log line or a typed value can quote a person, and a
// navigation names the filled address.
const DROPPED_BREADCRUMBS: ReadonlySet<string> = new Set(['console', 'ui.input', 'navigation']);
const NETWORK_BREADCRUMBS: ReadonlySet<string> = new Set(['fetch', 'xhr']);
// Default integrations left out: sessions send the user agent, and console breadcrumbs are never kept.
const DROPPED_INTEGRATIONS: ReadonlySet<string> = new Set(['BrowserSession', 'Console']);

const decoder = new TextDecoder();

/** The path of a URL, relative to the page's origin when it has none. */
function pathOf(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  try {
    return new URL(url, 'https://app.invalid').pathname;
  } catch {
    return undefined;
  }
}

/** A breadcrumb fit to send, or null to drop it. */
export function keepBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const { category } = breadcrumb;
  if (category !== undefined && DROPPED_BREADCRUMBS.has(category)) return null;
  if (category !== undefined && NETWORK_BREADCRUMBS.has(category) && breadcrumb.data !== undefined) {
    return scrub({ ...breadcrumb, data: { ...breadcrumb.data, url: pathOf(breadcrumb.data.url) } });
  }
  return scrub(breadcrumb);
}

/** The route open now, or undefined if the router can't say (it failed before it started). */
function currentRoute(route: () => string | undefined): string | undefined {
  try {
    return route();
  } catch {
    return undefined;
  }
}

/** The event tagged with the route pattern in place of the address that was open, then scrubbed. */
export function prepareEvent(event: ErrorEvent, route: string | undefined): ErrorEvent {
  const { request, ...rest } = event;
  const kept = request === undefined ? {} : { request: { ...request, url: undefined } };
  const routed =
    route === undefined
      ? { ...rest, ...kept }
      : { ...rest, ...kept, transaction: route, tags: { ...rest.tags, route } };
  return scrub(routed);
}

/** The SDK's options: errors only, nothing collected on its own, and `scrub` in every send hook. */
export function sentryOptions(config: SentryConfig): BrowserOptions {
  const { deliver } = config;
  return {
    dsn: config.dsn,
    release: config.release,
    environment: config.environment,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // No release health sessions (they carry the user agent), and no console patching: its breadcrumbs are dropped.
    integrations: (defaults) => defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name)),
    // Fetch errors keep their own message for the app; only what is sent gets the host.
    enhanceFetchErrorMessages: 'report-only',
    beforeSend: (event) => prepareEvent(event, currentRoute(config.route)),
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

/** Sends one fault the app (or the buffer) reported, with its request id and procedure when known. */
export function reportFault(fault: Fault): void {
  withScope((scope) => {
    if (fault.requestId !== undefined) scope.setTag('request_id', fault.requestId);
    if (fault.procedure !== undefined) scope.setTag('procedure', fault.procedure);
    if (fault.componentStack !== undefined) scope.setContext('react', { componentStack: fault.componentStack });
    captureException(fault.error, { mechanism: { type: 'crm.monitoring', handled: fault.handled ?? true } });
  });
}

/** Starts Sentry, then sends what the buffer kept and lets the SDK's own handlers watch the window. */
export function startSentry(config: SentryConfig, buffered: FaultBuffer): void {
  init(sentryOptions(config));
  buffered.drain(reportFault);
}
