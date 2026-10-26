// A link page as an Apple Wallet pass (the owner, 26 October 2026). Two routes, one maker:
//
// - `/api/me/wallet/pass.pkpass` is the owner's own. They carry their page in their wallet and show its code at an
//   event, instead of spelling an address out.
// - `/api/public/handles/<handle>/pass.pkpass` is the same pass for a visitor reading that page, so somebody met
//   once is kept the way a paper card used to be. Its code is tagged `utm_content=shared`, so a visit from a pass a
//   visitor saved reads apart from one its owner carries.
//
// Both are plain GETs, so each button is a link and works with no script, and a phone opens Wallet straight from
// it. Both read their handle through the public booking door (`findHandleOwner`), which only this folder may open
// (`apps/api/eslint.config.js`).
//
// On the owner's route the handle rides in the query and is checked against the session, so somebody else's handle
// reads as the same nothing as a handle no one holds. The public route needs no such check: a pass holds only the
// name, the line under it and the address that `/<handle>` already shows anyone who opens it, so there is nothing
// in it a visitor could not have read off the page. What the public route does need is a tighter limit, since
// every pass is signed and nobody is signed in to key on: the client address, and the handle.
import { createHash } from 'node:crypto';
import { errorStatus, HANDLE_PATTERN } from '@crm/contracts';
import { findHandleOwner } from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Geo } from '../edge.ts';
import type { Hono } from 'hono';
import type { Auth } from '../auth/auth.ts';
import { PKPASS_TYPE } from '../wallet/apple.ts';
import { APPLE_PASS_PATH, type ApplePassMaker } from '../wallet/wallet.ts';
import { createMemoryLimiter, type LimitRule } from './limits.ts';

/** A `{ code, message }` answer at the status the error map gives the code, as every route here answers. */
const answer = (code: 'NOT_FOUND' | 'UNAUTHENTICATED' | 'RATE_LIMITED', message: string): Response =>
  Response.json({ code, message }, { status: errorStatus(code) });

/** How many passes one person may ask for a minute. Each one signs, which is the only costly part. */
const PASS_LIMIT: LimitRule = { max: 20, windowMs: 60_000 };

/**
 * The public route's limits: 6 a minute per client address, and 120 for one handle across this instance. A visitor
 * presses the button once, so six is already generous; the handle's ceiling is what holds a sweep of one page.
 */
const PUBLIC_PASS_LIMITS = {
  perAddress: { max: 6, windowMs: 60_000 },
  perHandle: { max: 120, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

/** Where a visitor's browser asks for somebody's pass. The web app builds the same address (`publicPassPath`). */
export const PUBLIC_PASS_PATH = '/api/public/handles/:handle/pass.pkpass';

/** What this route reads off the request, which is what the app already sets on every one. */
interface WalletVariables {
  requestId: string;
  clientIp: string | undefined;
  geo?: Geo;
  origin: string | undefined;
}

/** What the route needs: the database the door reads through, the session reader, and the pass maker. */
export interface WalletPassDeps {
  readonly db: Database;
  readonly auth: Auth;
  /** Undefined where this environment has no Apple certificate: then the address simply isn't there. */
  readonly pass: ApplePassMaker | undefined;
}

/** The client address as a short hash, as every other public limit keys on it: no raw address is kept. */
function addressKey(clientIp: string | undefined): string {
  return createHash('sha256')
    .update(clientIp ?? 'unknown')
    .digest('base64url')
    .slice(0, 22);
}

/** One pass as our answer. `cache` is what each route may promise: the owner's is theirs alone. */
function passResponse(bytes: Uint8Array, handle: string, cache: string): Response {
  return new Response(bytes, {
    headers: {
      'content-type': PKPASS_TYPE,
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${handle}.pkpass"`,
      'x-content-type-options': 'nosniff',
      'cache-control': cache,
    },
  });
}

/** Mounts both pass routes. The app mounts under `/api`, so the paths drop it here. */
export function mountWalletPass(app: Hono<{ Variables: WalletVariables }>, deps: WalletPassDeps): void {
  const limiter = createMemoryLimiter();
  const nothing = () => answer('NOT_FOUND', 'There’s no pass here.');
  const tooMany = () => answer('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');

  app.get(APPLE_PASS_PATH.replace(/^\/api/, ''), async (c) => {
    const make = deps.pass;
    if (make === undefined) return nothing();
    const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
    if (session === undefined) return answer('UNAUTHENTICATED', 'Sign in to continue.');
    if (!limiter(`wallet-pass:${session.user.id}`, PASS_LIMIT).allowed) return tooMany();
    const handle = c.req.query('handle') ?? '';
    // A handle that can't be one never reaches the door.
    if (!HANDLE_PATTERN.test(handle)) return nothing();
    let owner;
    try {
      owner = await findHandleOwner({ db: deps.db }, handle);
    } catch {
      return nothing();
    }
    if (owner.userId !== session.user.id) return nothing();
    const bytes = await make({
      handle: owner.handle,
      name: owner.name.trim() === '' ? owner.handle : owner.name,
      ...(owner.bio === '' ? {} : { bio: owner.bio }),
    });
    // Signed for this person and remade on every ask: never kept anywhere but their own device.
    const answered = passResponse(bytes, owner.handle, 'private, no-store');
    for (const cookie of session.setCookies) answered.headers.append('set-cookie', cookie);
    return answered;
  });

  // Somebody else's page, for a visitor reading it. No session: everything in the pass is already on the page.
  app.get(PUBLIC_PASS_PATH.replace(/^\/api/, ''), async (c) => {
    const make = deps.pass;
    if (make === undefined) return nothing();
    const handle = c.req.param('handle') ?? '';
    // Checked before it becomes a limiter key, so a made up address can't fill the table.
    if (!HANDLE_PATTERN.test(handle)) return nothing();
    for (const [key, rule] of [
      [`wallet-pass-public:${addressKey(c.get('clientIp'))}`, PUBLIC_PASS_LIMITS.perAddress],
      [`wallet-pass-handle:${handle}`, PUBLIC_PASS_LIMITS.perHandle],
    ] as const) {
      if (!limiter(key, rule).allowed) return tooMany();
    }
    let owner;
    try {
      owner = await findHandleOwner({ db: deps.db }, handle);
    } catch {
      return nothing();
    }
    const bytes = await make({
      handle: owner.handle,
      name: owner.name.trim() === '' ? owner.handle : owner.name,
      ...(owner.bio === '' ? {} : { bio: owner.bio }),
      shared: true,
    });
    // Nobody's but the browser that asked: the same page's pass is signed again each time, and an edge that kept
    // one would hand yesterday's name to tomorrow's visitor.
    return passResponse(bytes, owner.handle, 'private, no-store');
  });
}
