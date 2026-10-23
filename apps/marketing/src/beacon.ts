// The site's own visit count (spec 0047, AC-1627): one beacon per page shown, to the app's api, which keeps the
// path, the referring site's host and `utm_source`, never a cookie or anything stored in the browser. The operator
// console's Website page reads it. No third party is contacted.

/** What the beacon sends: the path with no query, the referring site's host, and the `utm_source`. */
export interface Visit {
  readonly path: string;
  readonly referrer?: string;
  readonly source?: string;
}

/** The visit a page load is, from its address and its referrer; the referrer only when it is another site. */
export function visitOf(href: string, referrer: string): Visit {
  const here = new URL(href);
  let from: string | undefined;
  try {
    const there = referrer === '' ? undefined : new URL(referrer);
    from = there === undefined || there.hostname === here.hostname ? undefined : there.hostname;
  } catch {
    from = undefined;
  }
  const source = here.searchParams.get('utm_source') ?? undefined;
  return {
    path: here.pathname,
    ...(from === undefined ? {} : { referrer: from.slice(0, 120) }),
    ...(source === undefined || source === '' ? {} : { source: source.slice(0, 60) }),
  };
}

/** What sending needs from the browser, so tests pass their own. */
export interface BeaconHost {
  readonly href: string;
  readonly referrer: string;
  /** True under automation (Playwright, a crawler's browser): nothing is sent. */
  readonly isAutomated: boolean;
  readonly send: (url: string, body: Blob) => boolean;
}

/** Sends this page's visit to `endpoint`, as plain text so no preflight runs; nothing without an endpoint. */
export function sendVisit(endpoint: string | undefined, host: BeaconHost): boolean {
  if (endpoint === undefined || endpoint === '' || host.isAutomated) return false;
  const body = new Blob([JSON.stringify(visitOf(host.href, host.referrer))], { type: 'text/plain' });
  return host.send(endpoint, body);
}
