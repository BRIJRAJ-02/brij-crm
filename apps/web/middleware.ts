// Vercel Routing Middleware. It runs at the edge, before files and rewrites,
// for /api only, and proxies the request to the Railway API. The app and the
// API share one origin that way (host only cookies, no CORS).
import { ipAddress, rewrite } from '@vercel/functions';

export const config = { matcher: ['/api', '/api/:path*'] };

export default function middleware(request: Request): Response {
  const origin = process.env.API_ORIGIN_INTERNAL;
  if (origin === undefined || origin === '') {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'This deployment has no API address set.' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  // Replace these, never append to them: a client can send its own values.
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const clientIp = ipAddress(request);
  if (clientIp === undefined) headers.delete('x-forwarded-for');
  else headers.set('x-forwarded-for', clientIp);

  return rewrite(new URL(url.pathname + url.search, origin), { request: { headers } });
}
