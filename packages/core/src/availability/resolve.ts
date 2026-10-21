// Which hours a member or a page books by (spec 0035, AC-963, AC-965,
// AC-976): a named schedule of the member's, else their stored default, else
// the virtual default (weekdays 09:00 to 17:00) in the zone the caller names.
// Reads only, inside the caller's transaction: the slot engine (`loadPage`),
// the page views and, later, round robin (spec 0029) and the team calendar
// (spec 0030) all resolve through here, so they can't disagree.
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  BookingAvailability,
  DEFAULT_SCHEDULE_NAME,
  defaultAvailability,
  type BookingAvailability as Hours,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';

const { availabilitySchedules } = schema;

/** A schedule as the slot engine takes it: its id (none for the virtual default), name and hours with their zone. */
export interface ResolvedSchedule {
  /** Undefined for the virtual default, which is never stored until the member saves it. */
  readonly id: string | undefined;
  readonly name: string;
  readonly isDefault: boolean;
  readonly availability: Hours;
}

/** The virtual default (AC-963): "Working hours", weekdays 09:00 to 17:00 in `zone`. */
export function virtualDefault(zone: string): ResolvedSchedule {
  return { id: undefined, name: DEFAULT_SCHEDULE_NAME, isDefault: true, availability: defaultAvailability(zone) };
}

/**
 * The hours as anyone but their member sees them (AC-971): every date
 * override's note left out, since a day off's reason is the member's alone.
 * `defaultSchedule` and `scheduleFor` answer the notes too; a caller showing
 * a member's hours to someone else passes them through this first.
 */
export function withoutNotes(hours: Hours): Hours {
  if (hours.overrides.every((override) => override.note === undefined)) return hours;
  return {
    ...hours,
    overrides: hours.overrides.map(({ note: _note, ...override }) => override),
  };
}

/** Stored hours parsed with the shared schema; damaged hours fall back to the virtual default's, never throwing. */
export function hoursOf(stored: unknown, zone: string): Hours {
  const parsed = BookingAvailability.safeParse(stored);
  return parsed.success ? parsed.data : defaultAvailability(zone);
}

/**
 * The member's default schedule (AC-976): their stored default, or the
 * virtual one in `fallbackZone` when they have none.
 */
export async function defaultSchedule(
  tx: WorkspaceTx,
  memberId: string,
  fallbackZone: string,
): Promise<ResolvedSchedule> {
  const [row] = await tx
    .select()
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.memberId, memberId), eq(availabilitySchedules.isDefault, true)));
  if (row === undefined) return virtualDefault(fallbackZone);
  return { id: row.id, name: row.name, isDefault: true, availability: hoursOf(row.availability, fallbackZone) };
}

/**
 * The schedule a member books by (AC-976): `scheduleId` when it is theirs,
 * else their default (a schedule deleted meanwhile, or one of someone else's,
 * follows the default rather than failing a slot read).
 */
export async function scheduleFor(
  tx: WorkspaceTx,
  input: { readonly memberId: string; readonly scheduleId?: string | undefined; readonly fallbackZone: string },
): Promise<ResolvedSchedule> {
  const resolved = await resolveMany(tx, [input]);
  return resolved[0] ?? virtualDefault(input.fallbackZone);
}

/**
 * `scheduleFor` for many at once, in order, with one query: every named
 * schedule and every member's stored default together (a list of pages).
 */
export async function resolveMany(
  tx: WorkspaceTx,
  wanted: readonly {
    readonly memberId: string;
    readonly scheduleId?: string | undefined;
    readonly fallbackZone: string;
  }[],
): Promise<readonly ResolvedSchedule[]> {
  if (wanted.length === 0) return [];
  const named = [...new Set(wanted.flatMap((each) => (each.scheduleId === undefined ? [] : [each.scheduleId])))];
  const owners = [...new Set(wanted.map((each) => each.memberId))];
  const rows = await tx
    .select()
    .from(availabilitySchedules)
    .where(
      or(
        and(inArray(availabilitySchedules.memberId, owners), eq(availabilitySchedules.isDefault, true)),
        named.length === 0 ? undefined : inArray(availabilitySchedules.id, named),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const defaults = new Map(rows.filter((row) => row.isDefault).map((row) => [row.memberId, row]));
  // Each schedule parsed once, however many pages book by it (a parse checks the zone, which builds an `Intl`
  // format): damaged hours stay undefined and fall back to the virtual default's in each page's own zone.
  const parsed = new Map(
    rows.map((row) => {
      const hours = BookingAvailability.safeParse(row.availability);
      return [row.id, hours.success ? hours.data : undefined] as const;
    }),
  );
  return wanted.map((each) => {
    const own = each.scheduleId === undefined ? undefined : byId.get(each.scheduleId);
    const row = own !== undefined && own.memberId === each.memberId ? own : defaults.get(each.memberId);
    if (row === undefined) return virtualDefault(each.fallbackZone);
    return {
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
      availability: parsed.get(row.id) ?? defaultAvailability(each.fallbackZone),
    };
  });
}
