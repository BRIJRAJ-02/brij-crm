// Serves the single page app and proxies /api/* to the Railway API, so the
// app and the API share one origin (host only cookies, no CORS).
interface Env {
  ASSETS: Fetcher;
  API_ORIGIN_INTERNAL: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) headers.set('x-forwarded-for', clientIp);

    return fetch(new URL(url.pathname + url.search, env.API_ORIGIN_INTERNAL), {
      method: request.method,
      headers,
      body: request.body,
      // Pass redirects (sign in callbacks later) back to the browser untouched.
      redirect: 'manual',
    });
  },
} satisfies ExportedHandler<Env>;
