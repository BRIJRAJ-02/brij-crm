// The guest menu's shell as a Vercel Function (spec 0065, H1, AC-6531): `/m/<key>` answers the built shell with the
// menu already written into it, so it reads before (and without) the script. Everything it decides lives in
// `menu-shell.ts`, which runs in a Node test; this file is the entry, the one outside call, and nothing else. The
// headers that matter (the policy, nosniff, the referrer rule) come from vercel.json's block for `/m/`, as they would
// for the static shell.
import { registerHooks } from 'node:module';
import { addCacheTag, ipAddress } from '@vercel/functions';

// Vercel's Node builder compiles each imported TypeScript file to a .js beside it but keeps the `.ts` in every
// import; the same hook `api/handle.mjs` registers, for the same reason.
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
const { menuCacheControlFor, menuShellFor } = await import('../menu-shell.ts');
// The built shell, written beside this file by the build (`crm:booking-shell` in vite.config.ts).
const { MENU_SHELL } = await import('./menu-shell.generated.mjs');
// @boundaries-ignore the Vercel Function entry runs on the server, not in the client bundle
const { menuReadHeaders } = await import('../menu-read.ts');

/**
 * Reads one place's published menu from this deployment's own api, through the same edge every guest uses, vouching
 * for the guest (`menu-read.ts`) so the read counts against their address, not this function's.
 */
const readMenu = (origin, headers) => async (key, signal) => {
  const answer = await fetch(`${origin}/api/public/menu/${encodeURIComponent(key)}`, { signal, headers });
  if (answer.status === 404) return undefined;
  if (!answer.ok) throw new Error(`menu read answered ${String(answer.status)}`);
  return await answer.json();
};

export async function GET(request) {
  const url = new URL(request.url);
  const { body, status, outcome, tags } = await menuShellFor(url.pathname, {
    shell: MENU_SHELL,
    readMenu: readMenu(url.origin, menuReadHeaders({ secret: process.env.EDGE_SECRET, guestIp: ipAddress(request) })),
  });
  if (outcome === 'missed') console.warn(JSON.stringify({ event: 'menu.shell.missed' }));
  // Filed under the place's and the workspace's tags, so Publish, Sold out and removing the app clear this HTML too.
  // A failed tag leaves only the answer's short s-maxage. The runtime's addCacheTag may answer no promise or throw.
  if (tags !== undefined && tags.length > 0) {
    try {
      await addCacheTag([...tags]);
    } catch {
      // The minute's s-maxage bounds an untagged answer anyway.
    }
  }
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': menuCacheControlFor(outcome),
      'x-crm-shell': outcome,
    },
  });
}

export async function HEAD(request) {
  const answer = await GET(request);
  return new Response(null, { status: answer.status, headers: answer.headers });
}
