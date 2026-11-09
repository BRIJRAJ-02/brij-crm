import { EMBED_SESSION_HOURS, type EmbedSessionView, type PartnerScreen } from '@crm/contracts';
import { describeEmbedSession, redeemPartnerLaunch, type RedeemedLaunch } from '@crm/core';
import { doorSession } from '../../auth/door-session.ts';
import { apiError } from '../../errors.ts';
import { log } from '../../log.ts';
import { authed, memberDoor, pub, type RequestContext } from '../../orpc.ts';

// The embedded frame's own calls (spec 0070, AC-7031). Both are bootstrap: the frame knows no workspace until its
// session names one.
// - `start` redeems a launch's one time code (once, within 60 seconds; core marks it used as it reads it) and sets
//   the embedded session's cookie. A cookie session's POST, so the Origin check (`app.ts`) refuses it from anywhere
//   but our own pages; the frame is our own page inside the partner's. 30 a minute per address.
// - `session` reads what the embedded session opens. `requireSession` lets an embedded session reach it and nothing
//   else outside the shared modules; an app session asking is told there is nothing here.
// Each goes through the member door (`describeEmbedSession` in core), so the person's own role decides Team pages.

/** Redemptions one address may try a minute: a guessed code is 32 random bytes, so this only caps the noise. */
const STARTS_A_MINUTE = 30;

const RUN_OUT = 'This address has run out. Open the screen again from the app you came from.';

/** What an embedded session opens, with its partner's name and frame origins. */
async function viewOf(
  context: RequestContext,
  session: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly verifiedAt: Date;
    readonly expiresAt: Date;
  },
  first?: Pick<RedeemedLaunch, 'screen' | 'theme'>,
): Promise<EmbedSessionView> {
  const facts = await describeEmbedSession(memberDoor(context), {
    userId: session.userId,
    workspaceId: session.workspaceId,
    connectionId: session.connectionId,
    session: doorSession({ verifiedAt: session.verifiedAt, twoFactorEnabled: false }),
  });
  const partner = await context.partners.partnerById(facts.partnerId);
  if (partner === undefined) throw apiError('NOT_FOUND', RUN_OUT);
  const screen: PartnerScreen | undefined = first?.screen;
  return {
    workspace: facts.slug,
    workspaceName: facts.workspaceName,
    partner: { clientId: partner.clientId, name: partner.name },
    frameOrigins: [...partner.frameOrigins],
    ...(screen === undefined ? {} : { screen }),
    ...(first?.theme === undefined ? {} : { theme: first.theme }),
    person: { name: facts.personName },
    canManageTeam: facts.canManageTeam,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export const embedRouter = {
  start: pub.embed.start.handler(async ({ context, input }) => {
    const limit = await context.limiter.consumeRateLimit(`embed:start:${context.clientIp ?? 'unknown'}`, {
      window: 60,
      max: STARTS_A_MINUTE,
    });
    if (!limit.allowed) throw apiError('RATE_LIMITED', 'Too many tries from this address. Wait a minute.');
    const launch = await redeemPartnerLaunch({ db: context.db }, input.code);
    if (launch === undefined) throw apiError('NOT_FOUND', RUN_OUT);
    const made = await context.auth.startEmbedSession({
      userId: launch.userId,
      connectionId: launch.connectionId,
      workspaceId: launch.workspaceId,
      expiresAt: launch.sessionExpiresAt,
    });
    context.resHeaders?.append('set-cookie', made.setCookie);
    // Ids only: never the code, the cookie or who the person is beyond their identity's id.
    log.info('embed.started', {
      requestId: context.requestId,
      workspaceId: launch.workspaceId,
      connectionId: launch.connectionId,
      sessionId: made.sessionId,
      screen: launch.screen,
    });
    return viewOf(
      context,
      {
        userId: launch.userId,
        workspaceId: launch.workspaceId,
        connectionId: launch.connectionId,
        verifiedAt: new Date(),
        expiresAt: launch.sessionExpiresAt,
      },
      launch,
    );
  }),
  session: authed.embed.session.handler(async ({ context }) => {
    const { embed } = context;
    if (embed === undefined) throw apiError('NOT_FOUND', 'There is nothing at this address.');
    return viewOf(context, {
      userId: context.user.id,
      workspaceId: embed.workspaceId,
      connectionId: embed.connectionId,
      verifiedAt: context.doorSession.verifiedAt,
      // Made at its launch and never extended: it ends 12 hours after it proved itself.
      expiresAt: new Date(context.doorSession.verifiedAt.getTime() + EMBED_SESSION_HOURS * 60 * 60 * 1000),
    });
  }),
};
