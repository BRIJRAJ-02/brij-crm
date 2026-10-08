// Live updates' tokens (spec 0005, change events): the browser connects to
// Centrifugo with a connection token and listens to its workspace's channel
// with a subscription token, both signed by the API and good for 10 minutes.
// The browser asks again before each runs out.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceScoped } from './workspaces.ts';

/** A connection token: an HS256 JWT whose `sub` is the signed in person's user id. */
export const ConnectionToken = z.object({
  token: z.string(),
});
/** A connection token. */
export type ConnectionToken = z.infer<typeof ConnectionToken>;

/** A subscription token for one workspace's channel (`workspace:<id>`), with the same `sub` as the connection. */
export const SubscriptionToken = z.object({
  channel: z.string(),
  token: z.string(),
});
/** A subscription token and the channel it opens. */
export type SubscriptionToken = z.infer<typeof SubscriptionToken>;

/**
 * Tokens for Centrifugo. `connectionToken` needs a session (bootstrap list);
 * `subscriptionToken` passes the member door, so only a member hears a
 * workspace's changes. Both answer 503 `API_UNAVAILABLE` where live updates
 * are off (no signing secret).
 */
export const realtimeContract = {
  connectionToken: oc.output(ConnectionToken),
  subscriptionToken: oc.input(WorkspaceScoped).output(SubscriptionToken),
};
