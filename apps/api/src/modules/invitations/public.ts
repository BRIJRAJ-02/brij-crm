import { isIP } from 'node:net';
import { INVITE_PEEKS_PER_IP_MINUTE } from '@crm/contracts';
import { acceptInvite, newId, peekInvite } from '@crm/core';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { authed, pub } from '../../orpc.ts';
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

/** `invitations.peek` and `invitations.accept`, joined into the invitations router. */
export const invitationsPublic = {
  peek: pub.invitations.peek.handler(async ({ context, input }) => {
    const limit = await context.identity.consumeRateLimit(`invites:peek:${addressKey(context.clientIp)}`, {
      window: 60,
      max: INVITE_PEEKS_PER_IP_MINUTE,
    });
    if (!limit.allowed) {
      throw apiError('RATE_LIMITED', 'Too many invitation lookups from here. Wait a minute, then try again.');
    }
    return peekInvite({ db: context.db }, input.token);
  }),
  accept: authed.invitations.accept.handler(async ({ context, input }) => {
    const { user } = context;
    // A server made mutation id: the browser that accepts has no events of this workspace to skip yet.
    const accepted = await commitWrite(context, { mutationId: newId() }, (hooks) =>
      acceptInvite(
        { db: context.db },
        { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
        input.token,
        hooks,
        { source: sourceOf(context) },
      ),
    );
    return { slug: accepted.slug };
  }),
};
