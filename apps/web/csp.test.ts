// The Content Security Policy and monitoring (spec 0010, AC-167): connect-src
// allows our own origin, Centrifugo's socket (spec 0005, checked by
// realtime-csp.ts) and at most the one Sentry EU ingest host; the browser never
// reaches PostHog; and a build refuses a web DSN the policy would block, beside
// the realtime check, both against the same policy.
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

/** Whether a connect-src source is a live updates socket's origin. */
const isSocketOrigin = (source: string) =>
  URL.canParse(source) && new URL(source).protocol === 'wss:' && new URL(source).origin === source;

describe("vercel.json's policy", () => {
  it("lets the browser connect to our own origin, Centrifugo's socket and at most one Sentry host, nothing else", () => {
    const [self, ...others] = directiveSources(policy, 'connect-src');
    expect(self).toBe("'self'");
    expect(others.filter(isSentryOrigin).length).toBeLessThanOrEqual(1);
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
