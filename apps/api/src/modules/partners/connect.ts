import { approvePartnerConnect, denyPartnerConnect, partnerConnectOffer } from '@crm/core';
import { apiError } from '../../errors.ts';
import { authed, member, memberDoor } from '../../orpc.ts';

// The OAuth connect (spec 0070, AC-7011, AC-7012). `offer` and `deny` are bootstrap: the connect page runs before any
// workspace is chosen, and core enters each of the person's workspaces through the door itself (`partnerConnectOffer`),
// so nothing here builds a scope. `approve` sits inside the chosen workspace, behind the member door, and core checks
// `connected_apps.manage` (owners only) first. Approve is a cookie session's POST, so the Origin check (`app.ts`)
// refuses it from anywhere but the app; the partner's own `state` comes back to it untouched.

/** Connect pages one person may open in an hour: each enters every workspace they're in. */
const OFFERS_PER_HOUR = 120;
/** Approvals one person may make in an hour. */
const APPROVALS_PER_HOUR = 30;

const TOO_MANY = 'Too many connect tries in the last hour. Try again later.';

export const partnerConnectRouter = {
  offer: authed.partnerConnect.offer.handler(async ({ context, input }) => {
    const limit = await context.limiter.consumeRateLimit(`partner:offer:${context.user.id}`, {
      window: 3600,
      max: OFFERS_PER_HOUR,
    });
    if (!limit.allowed) throw apiError('RATE_LIMITED', TOO_MANY);
    return partnerConnectOffer(
      { partners: context.partners, door: memberDoor(context), identity: context.identity },
      { userId: context.user.id, session: context.doorSession, request: input },
    );
  }),
  deny: authed.partnerConnect.deny.handler(({ context, input }) =>
    denyPartnerConnect({ partners: context.partners }, input),
  ),
  approve: member.partnerConnect.approve.handler(async ({ context, input }) => {
    const limit = await context.limiter.consumeRateLimit(`partner:approve:${context.user.id}`, {
      window: 3600,
      max: APPROVALS_PER_HOUR,
    });
    if (!limit.allowed) throw apiError('RATE_LIMITED', TOO_MANY);
    return approvePartnerConnect(
      context.scope,
      { partners: context.partners },
      { request: input.request, modules: input.modules },
    );
  }),
};
