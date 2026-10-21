// Home's Team today (spec 0041): where each member stands at a moment, from
// their day as the server let the reader see it. Pure: the day, the members
// and the clock come in, so "Free now" moves with the clock without a read.
// All day events don't make anyone busy; back to back meetings run together.
import type { MemberView, TeamTodayItem, TeamTodayMember } from '@crm/data';

/** Where one member stands now: in something until a time, or free, with what comes next. */
export interface Standing {
  readonly presence: 'free' | 'busy' | 'clear';
  /** What they are in now (the first of a run of meetings), while busy. */
  readonly current?: TeamTodayItem;
  /** When the run they are in ends, while busy. */
  readonly until?: string;
  /** Their next meeting after now (or after `until`). */
  readonly next?: TeamTodayItem;
}

/** Where a member stands at `now`, from their day's items. */
export function standingOf(items: readonly TeamTodayItem[], now: Date): Standing {
  const at = now.getTime();
  const timed = items
    .filter((item) => !item.allDay && Date.parse(item.endsAt) > at)
    .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const current = timed.find((item) => Date.parse(item.startsAt) <= at);
  if (current === undefined) {
    const next = timed[0];
    return next === undefined ? { presence: 'clear' } : { presence: 'free', next };
  }
  // The run they are in: every meeting starting before the run ends stretches it.
  let until = Date.parse(current.endsAt);
  for (const item of timed) {
    if (Date.parse(item.startsAt) <= until) until = Math.max(until, Date.parse(item.endsAt));
  }
  const next = timed.find((item) => Date.parse(item.startsAt) >= until);
  return {
    presence: 'busy',
    current,
    until: new Date(until).toISOString(),
    ...(next === undefined ? {} : { next }),
  };
}

/** One member's row: who they are and their day. */
export interface TeamMemberDay {
  readonly member: MemberView;
  readonly items: readonly TeamTodayItem[];
}

/**
 * The days of the members the reader knows, the reader first, then by name.
 * A member the list doesn't hold (joined since it was read) is left out
 * until it is read again.
 */
export function teamDaysOf(
  days: readonly TeamTodayMember[],
  members: readonly MemberView[],
  meId: string | undefined,
): readonly TeamMemberDay[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  return days
    .flatMap((day) => {
      const member = byId.get(day.memberId);
      return member === undefined ? [] : [{ member, items: day.items }];
    })
    .toSorted((a, b) => {
      if (a.member.id === meId) return -1;
      if (b.member.id === meId) return 1;
      return a.member.name.localeCompare(b.member.name);
    });
}
