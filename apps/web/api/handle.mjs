// The handle address's shell as a Vercel Function (spec 0055, AC-5501): `/<handle>` answers the built shell with a
// meta block, so a link pasted into a message shows the person. Everything it decides lives in `handle-shell.ts`,
// which runs in a Node test; this file is the entry, the one outside call, and nothing else.
//
// The headers that matter are not set here. vercel.json's header block for handle paths applies to this answer as
// it applies to the static shell, so the policy, `X-Content-Type-Options` and `Referrer-Policy` are the same bytes
// for both and can never drift (AC-5505).
import { registerHooks } from 'node:module';

// Vercel's Node builder compiles each imported TypeScript file to a .js beside it but keeps the `.ts` in every
// import, as Node runs them on the other hosts. The same hook `api/index.mjs` registers, for the same reason.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const missing = error?.code === 'ERR_MODULE_NOT_FOUND' && typeof error.url === 'string' ? error.url : '';
      if (missing.startsWith('file:') && missing.endsWith('.ts')) {
        return nextResolve(missing.replace(/\.ts$/, '.js'), context);
      }
      throw error;
    }
  },
});

// @boundaries-ignore the Vercel Function entry runs on the server, not in the client bundle
const { SHELL_CACHE_CONTROL, shellFor } = await import('../handle-shell.ts');
// The built shell, written beside this file by the build (`crm:booking-shell` in vite.config.ts), so the function
// reads no file and makes no request for its own bytes.
const { BOOKING_SHELL } = await import('./shell.generated.mjs');

/** Reads one handle's public profile from this deployment's own api, through the same edge every visitor uses. */
const readProfile = (origin) => async (handle, signal) => {
  const answer = await fetch(`${origin}/api/public/handles/${encodeURIComponent(handle)}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (answer.status === 404) return undefined;
  if (!answer.ok) throw new Error(`profile read answered ${String(answer.status)}`);
  return await answer.json();
};

/** Reads one of a person's booking pages, by the handle and the slug apart: neither is joined into a path here. */
const readPage = (origin) => async (handle, slug, signal) => {
  const answer = await fetch(`${origin}/api/public/handles/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (answer.status === 404) return undefined;
  if (!answer.ok) throw new Error(`page read answered ${String(answer.status)}`);
  return await answer.json();
};

export async function GET(request) {
  const url = new URL(request.url);
  // The canonical address is the public origin's, never the host this request happened to arrive on (AC-5502);
  // without one set, a preview serves itself and says so.
  const origin = process.env.BOOKING_PUBLIC_ORIGIN ?? url.origin;
  const { body, status, outcome } = await shellFor(url.pathname, {
    shell: BOOKING_SHELL,
    origin,
    // The share card is served from the public origin too, by `api/card.mjs` in this same deployment, so a crawler
    // that follows the block reaches a picture on the address the page itself lives at (spec 0055, AC-5510).
    cardOrigin: origin,
    readProfile: readProfile(url.origin),
    readPage: readPage(url.origin),
    onMiss: (handle, reason) => {
      // One line, the handle and why: a miss is invisible otherwise, since the visitor sees a working page.
      console.warn(JSON.stringify({ event: 'handle.shell.missed', handle, reason }));
    },
  });
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': SHELL_CACHE_CONTROL,
      'x-crm-shell': outcome,
    },
  });
}

export async function HEAD(request) {
  const answer = await GET(request);
  return new Response(null, { status: answer.status, headers: answer.headers });
}
