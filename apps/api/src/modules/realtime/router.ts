import { apiError } from '../../errors.ts';
import { authed, member } from '../../orpc.ts';
import type { RealtimeTokens } from '../../realtime/tokens.ts';

/** The token signer, or 503 where live updates are off (no `CENTRIFUGO_TOKEN_SECRET`, as in previews). */
function signer(realtime: RealtimeTokens | undefined): RealtimeTokens {
  if (realtime === undefined) throw apiError('API_UNAVAILABLE', 'Live updates are off here.');
  return realtime;
}

// Centrifugo's tokens (spec 0005). The connection needs only a session (bootstrap); a workspace's channel needs
// the member door, so only a member of that workspace hears its changes. Both carry the same user id as `sub`.
export const realtimeRouter = authed.realtime.router({
  connectionToken: authed.realtime.connectionToken.handler(({ context }) => ({
    token: signer(context.realtime).connection(context.user.id),
  })),
  subscriptionToken: member.realtime.subscriptionToken.handler(({ context }) =>
    signer(context.realtime).subscription(context.user.id, context.scope.workspaceId),
  ),
});
