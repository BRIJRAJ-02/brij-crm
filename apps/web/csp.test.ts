// The Content Security Policy and monitoring (spec 0010, AC-167): connect-src
// allows our own origin and at most the one Sentry EU ingest host, the browser
// never reaches PostHog, and a build refuses a web DSN the policy would block.
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, directiveSources, isEuIngestHost, sentryDsnProblem } from './csp.ts';

const policy = contentSecurityPolicy();
const DSN = 'https://0123abcd@o4507.ingest.de.sentry.io/4508';

describe("vercel.json's policy", () => {
  it('lets the browser connect to our own origin and at most one Sentry EU ingest host, nothing else', () => {
    const [self, ...others] = directiveSources(policy, 'connect-src');
    expect(self).toBe("'self'");
    expect(others.length).toBeLessThanOrEqual(1);
    for (const origin of others) {
      const url = new URL(origin);
      expect(url.protocol).toBe('https:');
      expect(isEuIngestHost(url.hostname)).toBe(true);
      expect(url.origin).toBe(origin);
    }
  });

  it('never lets the browser reach PostHog', () => {
    expect(policy.toLowerCase()).not.toContain('posthog');
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
