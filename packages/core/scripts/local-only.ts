// The scale scripts' guard: they write millions of rows, so they run only
// against localhost, or against the one host named in SEED_SCALE_ALLOW_HOST
// (a Neon branch made for the benchmark, never production). node-postgres
// lets `?host=` in the query string override the URL's host, so that is
// checked too. A URL with no host (`postgres:///crm`) reaches whatever PGHOST
// names, so an empty host counts as remote.

/** How `hostsOf` names an empty host: node-postgres would then connect to PGHOST, or a socket. */
export const NO_HOST = '(no host, so PGHOST or a socket)';

/** Every host a connection URL could reach: its hostname and any `host` in its query string, `NO_HOST` for an empty one. */
export function hostsOf(url: string): readonly string[] {
  const parsed = new URL(url);
  return [parsed.hostname, ...parsed.searchParams.getAll('host')].map((host) => (host === '' ? NO_HOST : host));
}

/** Exits unless every host the URL names is local or is `allowed`. */
export function refuseRemote(url: string, allowed: string | undefined, label: string): void {
  const remote = hostsOf(url).filter((host) => !['localhost', '127.0.0.1', '::1'].includes(host) && host !== allowed);
  if (remote.length > 0) {
    console.error(
      `Refusing to run ${label} against ${remote.join(', ')}. Name a benchmark branch's host in SEED_SCALE_ALLOW_HOST to run it there.`,
    );
    process.exit(1);
  }
}
