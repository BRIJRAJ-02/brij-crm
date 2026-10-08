import { catchUp, workspaceHead } from '@crm/core';
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
// The subscription token comes with the workspace's head, the browser's first watermark, and `catchUp` reads
// what a browser missed since its watermark from the outbox, through the caller's own audience (spec 0007).
export const realtimeRouter = authed.realtime.router({
  connectionToken: authed.realtime.connectionToken.handler(({ context }) => ({
    token: signer(context.realtime).connection(context.user.id),
  })),
  subscriptionToken: member.realtime.subscriptionToken.handler(async ({ context }) => {
    const signed = signer(context.realtime).subscription(context.user.id, context.scope.workspaceId);
    return { ...signed, head: await workspaceHead(context.scope) };
  }),
  catchUp: member.realtime.catchUp.handler(({ context, input }) => catchUp(context.scope, { after: input.after })),
});
