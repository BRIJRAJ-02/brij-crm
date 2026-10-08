// The browser's Sentry, for real, in Chromium (spec 0010, AC-163, AC-165,
// AC-169): faults from before the SDK loads and after, a render that crashed
// and a data layer fault with its request id all arrive scrubbed, named by the
// route pattern and never by the address; a refusal never goes. A fake
// transport stands in for Sentry.
import { dataError } from '@crm/data';
import { createRoot } from 'react-dom/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startMonitoring } from './index.ts';
import { keepBreadcrumb, prepareEvent } from './sentry.ts';

const EMAIL = 'ada.lovelace@example.com';
const ROUTE = '/w/$slug/objects/$object';

interface SentEvent {
  readonly release?: string;
  readonly environment?: string;
  readonly transaction?: string;
  readonly tags?: Readonly<Record<string, string>>;
  readonly request?: Readonly<Record<string, unknown>>;
  readonly contexts?: Readonly<Record<string, unknown>>;
  readonly exception?: { readonly values?: readonly { readonly value?: string }[] };
}

const envelopes: string[] = [];

/** The error events in every envelope sent so far. */
function events(): SentEvent[] {
  return envelopes.flatMap((envelope) => {
    const lines = envelope.split('\n').filter((line) => line.trim() !== '');
    const found: SentEvent[] = [];
    for (let index = 1; index < lines.length - 1; index += 2) {
      const header = JSON.parse(lines[index] ?? '{}') as { type?: string };
      if (header.type === 'event') found.push(JSON.parse(lines[index + 1] ?? '{}') as SentEvent);
    }
    return found;
  });
}

const valueOf = (event: SentEvent | undefined) => event?.exception?.values?.[0]?.value ?? '';

function Broken(): never {
  throw new Error('A render that crashed');
}

const container = document.body.appendChild(document.createElement('div'));
afterAll(() => {
  container.remove();
});

describe('the browser SDK, end to end', () => {
  it('sends early and later faults, scrubbed and named by the route pattern, and never a refusal', async () => {
    // A stand in for the window before the SDK starts: Vitest treats a real uncaught error as a failed test.
    const early = new EventTarget();
    const monitor = startMonitoring({
      config: {
        dsn: 'https://public@o1.ingest.de.sentry.io/2',
        release: 'abc1234',
        environment: 'preview',
        route: () => ROUTE,
      },
      target: early,
      load: async () => {
        const { startSentry } = await import('./sentry.ts');
        return {
          startSentry: (config, buffered) => {
            startSentry(
              {
                ...config,
                deliver: (envelope) => {
                  envelopes.push(envelope);
                  return Promise.resolve();
                },
              },
              buffered,
            );
          },
        };
      },
      logError: () => undefined,
    });

    // Before the chunk has loaded: kept by the buffer.
    early.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error(`Sign up failed for ${EMAIL}`) }),
    );
    monitor.report({ error: dataError('SLUG_TAKEN', 'That address is taken.') });

    // A render that crashed, and a data layer fault the server never saw.
    createRoot(container, monitor.rootOptions).render(<Broken />);
    monitor.report({
      error: new Error('A proxy page answered records.query'),
      requestId: 'req-7',
      procedure: 'records.query',
    });

    await vi.waitFor(
      () => {
        expect(events()).toHaveLength(3);
      },
      { timeout: 5000 },
    );
    const sent = events();
    const byValue = (start: string) => sent.find((event) => valueOf(event).startsWith(start));

    for (const event of sent) {
      expect(event).toMatchObject({ release: 'abc1234', environment: 'preview', transaction: ROUTE });
      expect(event.tags?.route).toBe(ROUTE);
      expect(event.request?.url).toBeUndefined();
    }
    expect(valueOf(byValue('Sign up failed'))).toBe('Sign up failed for [email]');
    expect(byValue('A render that crashed')?.contexts?.react).toBeDefined();
    expect(byValue('A proxy page')?.tags).toMatchObject({ request_id: 'req-7', procedure: 'records.query' });
    const all = envelopes.join('\n');
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain('That address is taken.');
    // No session envelopes: release health would send the user agent, and it isn't needed for errors.
    expect(all).not.toContain('"type":"session"');
  });
});

describe('the send hooks', () => {
  it('drops console, input and navigation breadcrumbs, and keeps only the path of a fetch', () => {
    expect(keepBreadcrumb({ category: 'console', message: `${EMAIL} signed in` })).toBeNull();
    expect(keepBreadcrumb({ category: 'ui.input', message: 'input[name="email"]' })).toBeNull();
    expect(
      keepBreadcrumb({ category: 'navigation', data: { from: '/w/acme', to: '/w/acme/objects/people' } }),
    ).toBeNull();
    expect(
      keepBreadcrumb({
        category: 'fetch',
        data: { url: 'https://app.test/api/rpc/records/query?q=ada', status_code: 500 },
      }),
    ).toEqual({ category: 'fetch', data: { url: '/api/rpc/records/query', status_code: 500 } });
  });

  it('replaces the address with the route pattern, and scrubs the rest', () => {
    const event = prepareEvent(
      {
        type: undefined,
        message: `failed for ${EMAIL}`,
        request: {
          url: 'https://app.test/w/acme/objects/people?view=all',
          headers: { 'User-Agent': 'x', Referer: 'y' },
        },
        user: { id: 'u', email: EMAIL },
      },
      ROUTE,
    );
    expect(event).toEqual({
      type: undefined,
      message: 'failed for [email]',
      request: { headers: {} },
      user: { id: 'u' },
      transaction: ROUTE,
      tags: { route: ROUTE },
    });
  });
});
