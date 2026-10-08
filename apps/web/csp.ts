// The Content Security Policy in vercel.json, read for the build and its tests
// (spec 0010, AC-167): which origins the browser may connect to, and whether
// the web DSN a build carries is one the policy lets through. A DSN whose
// host the policy blocks would build fine and then lose every report, so the
// build refuses it instead.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Sentry's EU ingest hosts look like `o123456.ingest.de.sentry.io`. */
const EU_INGEST_HOST = /^o\d+\.ingest\.de\.sentry\.io$/;

/** The policy vercel.json sends with every page. Throws if it has none. */
export function contentSecurityPolicy(vercelJsonPath = path.join(import.meta.dirname, 'vercel.json')): string {
  const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
    headers?: { headers?: { key: string; value: string }[] }[];
  };
  const policy = (config.headers ?? [])
    .flatMap((rule) => rule.headers ?? [])
    .find((header) => header.key.toLowerCase() === 'content-security-policy');
  if (policy === undefined) throw new Error('vercel.json sends no Content-Security-Policy.');
  return policy.value;
}

/** The sources one directive of a policy allows (`connect-src`), in order. */
export function directiveSources(policy: string, directive: string): string[] {
  const found = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return found?.slice(1) ?? [];
}

/** Whether a host is a Sentry ingest host in the EU region. */
export function isEuIngestHost(host: string): boolean {
  return EU_INGEST_HOST.test(host);
}

/**
 * Why the web DSN can't ship with this policy, or undefined when it can: it
 * must be an https URL on Sentry's EU ingest (the account's region), and its
 * origin must be in `connect-src`.
 */
export function sentryDsnProblem(dsn: string, connectSources: readonly string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return 'VITE_SENTRY_DSN_WEB is not a URL.';
  }
  if (url.protocol !== 'https:') return 'VITE_SENTRY_DSN_WEB must be an https URL.';
  if (!isEuIngestHost(url.hostname)) {
    return `VITE_SENTRY_DSN_WEB must be on Sentry's EU ingest (o<id>.ingest.de.sentry.io), not ${url.hostname}.`;
  }
  if (!connectSources.includes(url.origin)) {
    return `vercel.json's connect-src must list ${url.origin}, or the browser blocks every report. Add it, then build again.`;
  }
  return undefined;
}
