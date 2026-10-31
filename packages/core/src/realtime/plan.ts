// Delivery planning (spec 0007, milestones 2 and 4): what the relay publishes
// for one outbox row to each audience of its workspace. Each audience (members
// with equal data policies, spec 0009's `audiences`) has its own channel
// (`audienceChannel` in `@crm/contracts`) and receives the row through spec
// 0009's `filterEvent`, in its wire shape, or the stub when nothing of it is
// left for them, so every channel carries every `seq` exactly once. Pure: the
// relay loads the audiences (cached per workspace while it is awake) and the
// facts, and publishes what this answers. With no access rules (#24) every
// active member shares `open`, so a workspace has one channel and one copy.
import type { ChangeEvent } from '@crm/contracts';
import type { OutboxRow } from '@crm/db';
import { filterEvent, type Audience, type EventFacts } from '../access/events.ts';
import { SYSTEM_ACCESS } from '../access/policy.ts';
import { outboxEvent, stubEvent, wireEvent } from './events.ts';

/** One audience's copy of a row: the audience's key (which names its channel) and the event. */
export interface Delivery {
  readonly audience: string;
  readonly event: ChangeEvent;
}

/**
 * The audience of a workspace with no active member: the open policy and no
 * member named, so a rule that needs to know who receives an event (a job's
 * id, a private view, a task) fails closed and the event goes coarse with no
 * ids. Nobody can be subscribed to it; the relay still publishes every `seq`.
 */
const NO_MEMBERS: Audience = Object.freeze({
  key: SYSTEM_ACCESS.data.key,
  policy: SYSTEM_ACCESS.data,
  members: Object.freeze([]),
});

/**
 * Each audience's copy of `row`: `filterEvent` for that audience in its wire
 * shape (`mutationId` only on a copy it left unchanged, AC-87), or the stub
 * when the row is malformed or nothing of it is left. With no audiences, one
 * copy for a workspace nobody is in. `facts` holds what `eventFacts` asks for
 * the row; a missing fact counts as not visible.
 */
export function planDelivery(
  row: OutboxRow,
  audiences: readonly Audience[],
  facts: EventFacts = {},
): readonly Delivery[] {
  const event = outboxEvent(row);
  const each = audiences.length === 0 ? [NO_MEMBERS] : audiences;
  return each.map((audience) => {
    const kept = event === undefined ? undefined : filterEvent(audience, event, facts);
    return { audience: audience.key, event: kept === undefined ? stubEvent(row.seq, row.at) : wireEvent(kept) };
  });
}
