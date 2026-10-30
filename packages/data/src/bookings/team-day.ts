// The Team day's optimistic changes (spec 0030, AC-781): what a write shows on a held day at once, before the server
// answers and the day is read again. Pure, so each is tested alone; the store lays them over what is shown and puts
// the day back on a refusal.
import type { TeamDay, TeamDayItem, TimeBlockOccurrence } from '@crm/contracts';

/** Where an item starts, for keeping a column in order. */
const startOf = (item: TeamDayItem): string => (item.kind === 'event' ? item.event.startsAt : item.startsAt);

/** A column's items in order, with `added`. */
const withItems = (items: readonly TeamDayItem[], added: readonly TeamDayItem[]): TeamDayItem[] =>
  [...items, ...added].toSorted((a, b) => startOf(a).localeCompare(startOf(b)));

/** A block or hold drawn on `memberId`'s column, its turns under the id the block will have. */
export function blockedOnDay(
  day: TeamDay,
  memberId: string,
  blockId: string,
  turns: readonly Omit<TimeBlockOccurrence, 'key' | 'blockId'>[],
): TeamDay {
  const added = turns.flatMap((turn): TeamDayItem[] =>
    turn.kind === 'away'
      ? []
      : [
          {
            kind: turn.kind === 'hold' ? 'hold' : 'block',
            key: `${blockId}:${turn.startsAt}`,
            blockId,
            repeat: turn.repeat,
            ...(turn.label === undefined ? {} : { label: turn.label }),
            startsAt: turn.startsAt,
            endsAt: turn.endsAt,
          },
        ],
  );
  if (added.length === 0 || !day.columns.some((column) => column.memberId === memberId)) return day;
  return {
    ...day,
    columns: day.columns.map((column) =>
      column.memberId === memberId ? { ...column, items: withItems(column.items, added) } : column,
    ),
  };
}

/** A block taken off whichever column holds it. */
export function unblockedOnDay(day: TeamDay, blockId: string): TeamDay {
  if (!day.columns.some((column) => column.items.some((item) => isBlock(item, blockId)))) return day;
  return {
    ...day,
    columns: day.columns.map((column) => ({
      ...column,
      items: column.items.filter((item) => !isBlock(item, blockId)),
    })),
  };
}

const isBlock = (item: TeamDayItem, blockId: string): boolean =>
  (item.kind === 'block' || item.kind === 'hold') && item.blockId === blockId;

/**
 * A booking handed to `memberId` (Reassign, AC-777): it leaves every column for theirs (when it shows), its host and
 * flags change, and it leaves the Needs a host lane.
 */
export function reassignedOnDay(day: TeamDay, bookingId: string, memberId: string): TeamDay {
  const booking = day.bookings.find((each) => each.id === bookingId);
  if (booking === undefined) return day;
  const seat: TeamDayItem = { kind: 'booking', bookingId, startsAt: booking.startsAt, endsAt: booking.endsAt };
  const isSeat = (item: TeamDayItem) => item.kind === 'booking' && item.bookingId === bookingId;
  return {
    ...day,
    columns: day.columns.map((column) => {
      const had = column.items.some(isSeat);
      const kept = column.items.filter((item) => !isSeat(item));
      if (column.memberId === memberId) {
        return { ...column, items: withItems(kept, [seat]), booked: column.booked + (had ? 0 : 1) };
      }
      return had ? { ...column, items: kept, booked: Math.max(0, column.booked - 1) } : column;
    }),
    bookings: day.bookings.map((each) => {
      if (each.id !== bookingId) return each;
      const { hostAway: _away, hostAwayStandinId: _standin, ...rest } = each;
      return { ...rest, hostMemberId: memberId, needsHost: false };
    }),
    ...(day.needsHost === undefined ? {} : { needsHost: day.needsHost.filter((id) => id !== bookingId) }),
    issues: day.issues.filter((issue) => issue.bookingId !== bookingId && issue.withBookingId !== bookingId),
  };
}
