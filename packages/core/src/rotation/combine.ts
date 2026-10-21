// Team pages' slots (spec 0029, AC-734, AC-735): the engine runs once per
// member, and these pure functions combine the answers. A round robin page
// offers the union (a time at least one member is free for), each slot
// carrying the members free for it, so booking knows its candidates; a
// collective page offers the intersection (every required member free).
// Slots are keyed by start and end, so two members' different lengths never
// merge.
import type { Span } from '../booking/engine.ts';

/** A team slot: its time, and the members free for it, in the order the members were given. */
export interface FreeSlot extends Span {
  readonly memberIds: readonly string[];
}

const keyOf = (slot: Span) => `${String(slot.start.getTime())}:${String(slot.end.getTime())}`;

/** Every time at least one member is free for, chronological, each with the members free then. */
export function unionSlots(perMember: ReadonlyMap<string, readonly Span[]>): readonly FreeSlot[] {
  const byKey = new Map<string, { start: Date; end: Date; memberIds: string[] }>();
  for (const [memberId, slots] of perMember) {
    for (const slot of slots) {
      const key = keyOf(slot);
      const found = byKey.get(key);
      if (found === undefined) byKey.set(key, { start: slot.start, end: slot.end, memberIds: [memberId] });
      else if (!found.memberIds.includes(memberId)) found.memberIds.push(memberId);
    }
  }
  return [...byKey.values()].sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
}

/**
 * The times every member in `required` is free for, chronological. A member
 * missing from `perMember` has no slots, so nothing is offered; no members
 * at all offers nothing either.
 */
export function intersectSlots(
  perMember: ReadonlyMap<string, readonly Span[]>,
  required: readonly string[],
): readonly FreeSlot[] {
  if (required.length === 0) return [];
  const needed = new Set(required);
  return unionSlots(new Map([...perMember].filter(([memberId]) => needed.has(memberId)))).filter(
    (slot) => slot.memberIds.length === needed.size,
  );
}
