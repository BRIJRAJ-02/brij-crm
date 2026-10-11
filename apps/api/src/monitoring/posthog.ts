// PostHog for the api (spec 0010, milestone 3): the one module that imports
// `posthog-node` (AC-184). It sends the product event catalog
// (`@crm/contracts/events`) and nothing else: `capture` takes a `ProductEvent`
// only, parses it (a property outside the catalog fails the type check and the
// parse, AC-173), adds `environment`, and asks PostHog to keep no person
// profile and no location. The SDK's own last hook (`before_send`) drops any
// event outside the catalog and scrubs what is left, so nothing personal
// leaves (AC-165). Sending is queued in memory and never awaited on a request
// path (AC-166); `shutdown` sends what is queued within the shutdown window.
// Without `POSTHOG_KEY` it is a no op: local runs, tests and previews send
// nothing (AC-178).
import type { AppEnvironment } from '@crm/contracts';
import { PRODUCT_EVENT_NAMES, ProductEvent } from '@crm/contracts/events';
import { scrub } from '@crm/contracts/monitoring';
import { type EventMessage, PostHog } from 'posthog-node';

/** Sends product events to PostHog, or does nothing where no key is set. */
export interface Analytics {
  /** Whether events leave this process: false without `POSTHOG_KEY`. */
  readonly enabled: boolean;
  /** Queues one catalog event. Returns at once, never throws, and never waits for the network. */
  capture(event: ProductEvent): void;
  /** Sends what is queued, waiting at most `timeoutMs`, then stops. Never rejects. */
  shutdown(timeoutMs: number): Promise<void>;
}

/** What `createAnalytics` needs: the project key (unset means off), the EU host, and where it runs. */
export interface AnalyticsConfig {
  /** The PostHog project's key (`POSTHOG_KEY`). Unset turns analytics off. */
  readonly key: string | undefined;
  /** `POSTHOG_HOST`: `https://eu.i.posthog.com` unless set. */
  readonly host: string;
  /** `APP_ENV`, which every event carries, so the dashboard filters to production. */
  readonly environment: AppEnvironment;
  readonly log: { warn(message: string, fields?: Record<string, unknown>): void };
  /** Tests only: send each event at once instead of in batches of 20 every 10 seconds. */
  readonly flushAt?: number;
}

/** PostHog Cloud's EU ingest, where events go unless `POSTHOG_HOST` says otherwise. */
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com';

/** Analytics that send nothing: no key set, and tests that don't look at events. */
export const NO_ANALYTICS: Analytics = Object.freeze({
  enabled: false,
  capture: () => undefined,
  shutdown: () => Promise.resolve(),
});

// How long one send to PostHog may take, and how often it is tried, before the batch is given up. Sending runs
// off the request path, so a slow PostHog only delays its own batch.
const REQUEST_TIMEOUT_MS = 5_000;
const RETRIES = 2;

/**
 * The SDK's last look at an event before it is queued: one outside the
 * catalog is dropped (only `capture` below makes events, but a future SDK
 * feature could make its own), and the rest have their properties scrubbed.
 * Exported for tests.
 */
export function keepEvent(event: EventMessage | null): EventMessage | null {
  if (event === null || !PRODUCT_EVENT_NAMES.has(event.event)) return null;
  return { ...event, properties: scrub(event.properties ?? {}) };
}

/** PostHog for this process when `config.key` is set, else `NO_ANALYTICS`. */
export function createAnalytics(config: AnalyticsConfig): Analytics {
  if (config.key === undefined) return NO_ANALYTICS;
  const { environment, log } = config;
  const client = new PostHog(config.key, {
    host: config.host,
    // No location from the address a batch comes from (the api's own, on Railway).
    disableGeoip: true,
    flushAt: config.flushAt ?? 20,
    flushInterval: 10_000,
    requestTimeout: REQUEST_TIMEOUT_MS,
    fetchRetryCount: RETRIES,
    enableExceptionAutocapture: false,
    before_send: keepEvent,
  });
  // A failed send is logged by its name only: it never reaches the caller, and never stops the process.
  client.on('error', (error: unknown) => {
    log.warn('Product events not sent', {
      analytics: 'error',
      name: error instanceof Error ? error.name : typeof error,
    });
  });

  return {
    enabled: true,

    capture(event) {
      try {
        const parsed = ProductEvent.safeParse(event);
        if (!parsed.success) {
          // Never the event itself: only its name, when it has one from the catalog.
          const given: unknown = (event as { readonly event?: unknown }).event;
          const name = typeof given === 'string' && PRODUCT_EVENT_NAMES.has(given) ? given : 'unknown';
          log.warn('Product event refused by the catalog', { analytics: 'refused', event: name });
          return;
        }
        const valid = parsed.data;
        const properties = { ...valid.properties, environment, $process_person_profile: false };
        client.capture({
          distinctId: valid.distinctId,
          event: valid.event,
          properties,
          disableGeoip: true,
          ...('id' in valid ? { uuid: valid.id, timestamp: new Date(valid.at) } : {}),
        });
      } catch (error) {
        log.warn('Product event not queued', {
          analytics: 'error',
          name: error instanceof Error ? error.name : typeof error,
        });
      }
    },

    async shutdown(timeoutMs) {
      try {
        await client.shutdown(timeoutMs);
      } catch (error) {
        log.warn('Product events not sent at shutdown', {
          analytics: 'error',
          name: error instanceof Error ? error.name : typeof error,
        });
      }
    },
  };
}
