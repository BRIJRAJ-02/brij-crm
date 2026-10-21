// The Content Security Policy and monitoring (spec 0010, AC-167): connect-src
// allows our own origin, Centrifugo's socket (spec 0005, checked by
// realtime-csp.ts) and at most the one Sentry EU ingest host; the browser never
// reaches PostHog; and a build refuses a web DSN the policy would block, beside
// the realtime check, both against the same policy.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, directiveSources, isEuIngestHost, sentryDsnProblem } from './csp.ts';
import { realtimeCspProblem } from './realtime-csp.ts';

const policy = contentSecurityPolicy();
const DSN = 'https://0123abcd@o4507.ingest.de.sentry.io/4508';
const SOCKET = 'wss://centrifugo.example.app/connection/websocket';

/** Whether a connect-src source is a Sentry EU ingest origin. */
const isSentryOrigin = (source: string) =>
  URL.canParse(source) &&
  new URL(source).protocol === 'https:' &&
  isEuIngestHost(new URL(source).hostname) &&
  new URL(source).origin === source;

/** Whether a connect-src source is the live updates socket's origin: Centrifugo on Railway, nothing else. */
const isSocketOrigin = (source: string) =>
  URL.canParse(source) &&
  new URL(source).protocol === 'wss:' &&
  /^centrifugo[-\w]*\.up\.railway\.app$/u.test(new URL(source).hostname) &&
  new URL(source).origin === source;

describe("vercel.json's policy", () => {
  it("lets the browser connect to our own origin, Centrifugo's socket and at most one Sentry host, nothing else", () => {
    const [self, ...others] = directiveSources(policy, 'connect-src');
    expect(self).toBe("'self'");
    expect(others.filter(isSentryOrigin).length).toBeLessThanOrEqual(1);
    expect(others.filter(isSocketOrigin).length).toBeLessThanOrEqual(1);
    for (const origin of others) expect(isSentryOrigin(origin) || isSocketOrigin(origin)).toBe(true);
  });

  it('never lets the browser reach PostHog', () => {
    expect(policy.toLowerCase()).not.toContain('posthog');
  });
});

describe('both build checks on one policy', () => {
  it('pass together when connect-src lists the socket and the Sentry host, and each still refuses its own', () => {
    const both =
      "default-src 'self'; connect-src 'self' wss://centrifugo.example.app https://o4507.ingest.de.sentry.io";
    expect(realtimeCspProblem(SOCKET, both)).toBeUndefined();
    expect(sentryDsnProblem(DSN, directiveSources(both, 'connect-src'))).toBeUndefined();
    const socketOnly = "default-src 'self'; connect-src 'self' wss://centrifugo.example.app";
    expect(sentryDsnProblem(DSN, directiveSources(socketOnly, 'connect-src'))).toMatch(/connect-src must list/);
    const sentryOnly = "default-src 'self'; connect-src 'self' https://o4507.ingest.de.sentry.io";
    expect(realtimeCspProblem(SOCKET, sentryOnly)).toMatch(/connect-src/);
  });
});

describe('a build carrying a web DSN', () => {
  it("passes when the DSN is Sentry's EU ingest and connect-src lists it", () => {
    expect(sentryDsnProblem(DSN, ["'self'", 'https://o4507.ingest.de.sentry.io'])).toBeUndefined();
  });

  it.each([
    ['not in connect-src', DSN, ["'self'"], /connect-src must list https:\/\/o4507\.ingest\.de\.sentry\.io/],
    ['outside the EU', 'https://k@o4507.ingest.us.sentry.io/1', ["'self'"], /EU ingest/],
    ['plain http', 'http://k@o4507.ingest.de.sentry.io/1', ["'self'"], /https/],
    ['not a URL', 'not a dsn', ["'self'"], /not a URL/],
  ])('refuses one %s', (_case, dsn, sources, problem) => {
    expect(sentryDsnProblem(dsn, sources)).toMatch(problem);
  });
});

/** vercel.json's header rules: each path pattern and the headers it sends. */
const rules = (
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'vercel.json'), 'utf8')) as {
    readonly headers: readonly {
      readonly source: string;
      readonly headers: readonly { readonly key: string; readonly value: string }[];
    }[];
  }
).headers;

/** The value a rule sends for a header, by the rule's exact source. */
const sent = (source: string, key: string) =>
  rules.find((rule) => rule.source === source)?.headers.find((header) => header.key === key)?.value;

describe('framing (spec 0023, the embeds)', () => {
  it('lets any site frame a hosted form and a booking page, and nothing else', () => {
    expect(directiveSources(sent('/f/(.*)', 'Content-Security-Policy') ?? '', 'frame-ancestors')).toEqual(['*']);
    expect(directiveSources(sent('/b/:publicKey', 'Content-Security-Policy') ?? '', 'frame-ancestors')).toEqual(['*']);
    const app = rules[0];
    expect(app?.source).toBe('/((?!api/|api$|f/|b/[^/]+$|embed/).*)');
    expect(
      directiveSources(
        app?.headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? '',
        'frame-ancestors',
      ),
    ).toEqual(["'self'"]);
  });

  it("frames a booking page with the app's own policy otherwise, so the page itself changes in nothing", () => {
    const app = rules[0]?.headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    expect(sent('/b/:publicKey', 'Content-Security-Policy')).toBe(
      app.replace("frame-ancestors 'self'", 'frame-ancestors *'),
    );
  });

  it('serves the embed script cached for an hour, to any site', () => {
    expect(sent('/embed/(.*)', 'Cache-Control')).toMatch(/^public, max-age=3600/);
    expect(sent('/embed/(.*)', 'Cross-Origin-Resource-Policy')).toBe('cross-origin');
  });
});
