// The product events for the milestones a write reached (spec 0010, AC-175,
// AC-176, AC-177). Core stores each milestone once, in the write's own
// transaction, and returns it; this turns it into its catalog event, with the
// fixed id that makes a resend the same event, and queues it once the write
// has committed. No vendor here: the PostHog wrapper sends.
import { milestoneEventId, type ProductEvent } from '@crm/contracts/events';
import type { ReachedMilestone } from '@crm/core';
import { log } from '../log.ts';
import type { Analytics } from './posthog.ts';

/** A reached milestone as its product event, about `userId`, the person whose write reached it. */
export function milestoneEvent(reached: ReachedMilestone, userId: string): ProductEvent {
  const id = milestoneEventId(reached.workspaceId, reached.milestone);
  if (reached.milestone === 'workspace_created') {
    return {
      event: 'workspace_created',
      distinctId: userId,
      id,
      at: reached.reachedAt,
      properties: { workspace_id: reached.workspaceId },
    };
  }
  return {
    event: 'first_record_created',
    distinctId: userId,
    id,
    at: reached.reachedAt,
    properties: { workspace_id: reached.workspaceId, object_kind: reached.objectKind },
  };
}

/** What sending needs from a request: its analytics, and the signed in person (absent before sign in). */
export interface MilestoneSender {
  readonly analytics?: Analytics;
  readonly user?: { readonly id: string };
}

/**
 * Queues the events for what a committed write reached. Call it only after
 * the write resolved (so it committed); it returns at once and never throws.
 * Without analytics or a signed in person, nothing is sent.
 */
export function sendMilestones(context: MilestoneSender, reached: readonly ReachedMilestone[]): void {
  const { analytics, user } = context;
  if (analytics === undefined || user === undefined) return;
  for (const milestone of reached) {
    // The write has committed and its answer is on the way: nothing here may turn it into an error.
    try {
      analytics.capture(milestoneEvent(milestone, user.id));
    } catch (error) {
      log.warn('Milestone event not queued', {
        analytics: 'error',
        milestone: milestone.milestone,
        name: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}
