// The caller's own link page as an Apple Wallet pass (the owner, 26 October 2026): they carry their page in their
// wallet and show its code at an event, instead of spelling an address out.
//
// A plain GET, so the button is a link and works with no script, and a phone opens Wallet straight from it. It is
// private — a session is required — but it lives here because it reads a handle through the public booking door
// (`findHandleOwner`), which only this folder may open (`apps/api/eslint.config.js`).
//
// The handle rides in the query and is checked against the session. The pass holds only what the page already
// shows, but it is signed with our Pass Type ID certificate, so it is only ever made for its owner: somebody
// else's handle reads as the same nothing as a handle no one holds.
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

/** Mounts `GET /api/me/wallet/pass.pkpass`. The app mounts under `/api`, so the path drops it here. */
export function mountWalletPass(app: Hono<{ Variables: WalletVariables }>, deps: WalletPassDeps): void {
  const limiter = createMemoryLimiter();
  const nothing = () => answer('NOT_FOUND', 'There’s no pass here.');
  app.get(APPLE_PASS_PATH.replace(/^\/api/, ''), async (c) => {
    const make = deps.pass;
    if (make === undefined) return nothing();
    const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
    if (session === undefined) return answer('UNAUTHENTICATED', 'Sign in to continue.');
    if (!limiter(`wallet-pass:${session.user.id}`, PASS_LIMIT).allowed) {
      return answer('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
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
    const bytes = make({
      handle: owner.handle,
      name: owner.name.trim() === '' ? owner.handle : owner.name,
      ...(owner.bio === '' ? {} : { bio: owner.bio }),
    });
    const answered = new Response(bytes, {
      headers: {
        'content-type': PKPASS_TYPE,
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${owner.handle}.pkpass"`,
        // Signed for this person and remade on every ask: never kept anywhere but their own device.
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
    for (const cookie of session.setCookies) answered.headers.append('set-cookie', cookie);
    return answered;
  });
}
