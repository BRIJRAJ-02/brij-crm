// The scale scripts' guard: they write millions of rows, so they run only
// against localhost, or against the one host named in SEED_SCALE_ALLOW_HOST
// (a Neon branch made for the benchmark, never production). node-postgres
// lets `?host=` in the query string override the URL's host, so that is
// checked too.

/** Every host a connection URL could reach: its hostname and any `host` in its query string. */
export function hostsOf(url: string): readonly string[] {
  const parsed = new URL(url);
  return [parsed.hostname, ...parsed.searchParams.getAll('host')].filter((host) => host !== '');
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
