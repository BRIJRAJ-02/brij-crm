import { isIP } from 'node:net';
import { INVITE_PEEKS_PER_IP_MINUTE } from '@crm/contracts';
import { acceptInvite, claimPageInvite, newId, peekInvite } from '@crm/core';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { authed, pub, type RequestContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// The two invitation handlers that run before any workspace scope exists (spec 0031, AC-805, AC-806): `peek` (no
// session, 20 a minute per address) and `accept` (a session). Core finds the workspace by the token's hash and mints
// its scope there, so nothing here builds one. The only module file of invitations that reaches the database or
// global identity from the context (door.test.ts).

/**
 * The peek limiter's key for a caller's address (AC-808): an IPv4 address
 * whole, an IPv6 one by its /64, the share one host usually holds, so
 * walking a /64 gets no fresh limit. No address the edge vouched for keys as
 * `unknown`.
 */
export function addressKey(ip: string | undefined): string {
  if (ip === undefined) return 'unknown';
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return 'unknown';
  const lower = ip.toLowerCase();
  // An IPv4 address carried in IPv6 (::ffff:192.0.2.1) is that IPv4 address.
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)?.[1];
  if (dotted !== undefined) return dotted;
  const [head = '', tail] = lower.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array.from({ length: 8 - left.length - right.length }, () => '0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** Counts one invitation look up (a peek, or a page taken over) against the caller's address, 20 a minute (AC-808). */
async function limitLookups(context: Pick<RequestContext, 'identity' | 'clientIp'>): Promise<void> {
  const limit = await context.identity.consumeRateLimit(`invites:peek:${addressKey(context.clientIp)}`, {
    window: 60,
    max: INVITE_PEEKS_PER_IP_MINUTE,
  });
  if (!limit.allowed) {
    throw apiError('RATE_LIMITED', 'Too many invitation lookups from here. Wait a minute, then try again.');
  }
}

/** `invitations.peek`, `invitations.accept` and `invitations.claimPage`, joined into the invitations router. */
export const invitationsPublic = {
  peek: pub.invitations.peek.handler(async ({ context, input }) => {
    await limitLookups(context);
    return peekInvite({ db: context.db }, input.token);
  }),
  // A page's hand over taken (9 Nov 2026): no session, as the token is the invited inbox's; counted with the peeks,
  // since a token is tried here the same way. Core makes the page's identity a login through the identity store's two
  // narrow calls (`context.pageOnlyUsers`), then the workspace's half; signing in by code comes next, on the page.
  claimPage: pub.invitations.claimPage.handler(async ({ context, input }) => {
    await limitLookups(context);
    const claimed = await commitWrite(context, { mutationId: newId() }, (hooks) =>
      claimPageInvite({ db: context.db, users: context.pageOnlyUsers }, input.token, hooks, sourceOf(context)),
    );
    return claimed;
  }),
  accept: authed.invitations.accept.handler(async ({ context, input }) => {
    const { user } = context;
    // A server made mutation id: the browser that accepts has no events of this workspace to skip yet.
    const accepted = await commitWrite(context, { mutationId: newId() }, (hooks) =>
      acceptInvite(
        { db: context.db, identity: context.identity },
        {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          // The invite card's Your name (QA N14); core makes it plain as every join does.
          ...(input.memberName === undefined ? {} : { typedName: input.memberName }),
        },
        input.token,
        hooks,
        { source: sourceOf(context) },
      ),
    );
    return { slug: accepted.slug };
  }),
};
