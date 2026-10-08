// Live updates (spec 0005, change events; spec 0007, catch up): the browser
// connects to Centrifugo with a connection token and listens to its
// workspace's channel with a subscription token, both signed by the API and
// good for 10 minutes; it asks again before each runs out. The subscription
// token also carries the workspace's head (the last `seq` written), the
// watermark the browser starts from, and `catchUp` reads what it missed from
// the outbox when Centrifugo's history no longer has it.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ChangeEvent } from './change-event.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** A connection token: an HS256 JWT whose `sub` is the signed in person's user id. */
export const ConnectionToken = z.object({
  token: z.string(),
});
/** A connection token. */
export type ConnectionToken = z.infer<typeof ConnectionToken>;

/** A `seq` of a workspace's change events: 0 before its first. */
const Seq = z.number().int().min(0);

/**
 * A subscription token for one workspace's channel (`workspace:<id>`), with
 * the same `sub` as the connection, and `head`: the workspace's last `seq`
 * when the token was signed, read before any of the screen's first reads.
 */
export const SubscriptionToken = z.object({
  channel: z.string(),
  token: z.string(),
  head: Seq,
});
/** A subscription token and the channel it opens. */
export type SubscriptionToken = z.infer<typeof SubscriptionToken>;

/** What a catch up asks for: the workspace, and the last `seq` the browser applied. */
export const CatchUpInput = WorkspaceScoped.extend({
  after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
/** A catch up's input. */
export type CatchUpInput = z.infer<typeof CatchUpInput>;

/**
 * What a browser missed since `after`, up to `head`: at most one event per
 * kind and object or list, ids merged (past 1,000 the event goes coarse),
 * each with the `seq` of the last change it covers, and never `mutationId`,
 * `replaced` or a stub. `reset: true` (with no events) means the outbox no
 * longer holds everything since `after`, or it is more than 5,000 changes
 * behind: refetch everything held instead.
 */
export const CatchUp = z.object({
  head: Seq,
  reset: z.boolean(),
  events: z.array(ChangeEvent),
});
/** A catch up's answer. */
export type CatchUp = z.infer<typeof CatchUp>;

/**
 * Tokens for Centrifugo. `connectionToken` needs a session (bootstrap list);
 * `subscriptionToken` passes the member door, so only a member hears a
 * workspace's changes, and `catchUp` passes it too. The tokens answer 503 `API_UNAVAILABLE` where live updates
 * are off (no signing secret).
 */
export const realtimeContract = {
  connectionToken: oc.output(ConnectionToken),
  subscriptionToken: oc.input(WorkspaceScoped).output(SubscriptionToken),
  /** What the browser missed since its watermark, from the outbox (member door). */
  catchUp: oc.input(CatchUpInput).output(CatchUp),
};
