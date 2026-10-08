// Live updates connect to Centrifugo on its own origin (spec 0005), which the
// Content Security Policy in vercel.json refuses unless `connect-src` names it.
// The build checks that the realtime address it bakes in (VITE_REALTIME_URL)
// is one the deployed CSP lets the browser reach, so production never ships a
// socket its own CSP blocks. A laptop's address (localhost) is skipped: the
// dev server sends no CSP.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The `connect-src` sources of a CSP header value. */
export function connectSources(csp: string): readonly string[] {
  const directive = csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === 'connect-src');
  return directive?.slice(1) ?? [];
}

/**
 * Why `realtimeUrl` can't be built against `csp`, or undefined when it can:
 * unset or empty (live updates off) and a localhost address are fine;
 * anything else must be `wss:` and its origin listed in `connect-src`.
 */
export function realtimeCspProblem(realtimeUrl: string | undefined, csp: string): string | undefined {
  if (realtimeUrl === undefined || realtimeUrl === '') return undefined;
  if (!URL.canParse(realtimeUrl)) return `VITE_REALTIME_URL isn't an address: ${realtimeUrl}`;
  const url = new URL(realtimeUrl);
  if (LOCAL_HOSTS.has(url.hostname)) return undefined;
  if (url.protocol !== 'wss:') return `VITE_REALTIME_URL must be wss:// outside a laptop: ${realtimeUrl}`;
  if (!connectSources(csp).includes(url.origin)) {
    return `Add ${url.origin} to connect-src in apps/web/vercel.json's Content-Security-Policy, or the browser refuses VITE_REALTIME_URL.`;
  }
  return undefined;
}
