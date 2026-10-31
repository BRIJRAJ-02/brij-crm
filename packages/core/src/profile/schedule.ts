// Scheduled blocks (spec 0061, AC-6111): "Show from" and "Hide after", typed in the owner's own time zone and kept
// in UTC. The public read leaves a block out of its window with the database's own clock
// (`crm_profile_items_public`); these are the same rules for everything else that reads a block: the editor's chip,
// the crawler text and a picture's live check. The rule itself (`isInProfileWindow`) lives in `@crm/contracts`, so the
// editor and the server can never disagree on it.
import { isInProfileWindow, profileWindowProblem, type ProfileWindow } from '@crm/contracts';

export { isInProfileWindow, profileWindowProblem, profileWindowState, type ProfileWindow } from '@crm/contracts';

/** A block's window from its stored data: only the two keys, each only when it is a string. */
export function windowOf(data: unknown): ProfileWindow {
  if (typeof data !== 'object' || data === null) return {};
  const showFrom = 'showFrom' in data && typeof data.showFrom === 'string' ? data.showFrom : undefined;
  const hideAfter = 'hideAfter' in data && typeof data.hideAfter === 'string' ? data.hideAfter : undefined;
  return { ...(showFrom === undefined ? {} : { showFrom }), ...(hideAfter === undefined ? {} : { hideAfter }) };
}

/** Whether a stored block is on the public page at `now`: within its window, and a window that holds together. */
export function isShownAt(data: unknown, now: Date): boolean {
  const window = windowOf(data);
  return profileWindowProblem(window) === undefined && isInProfileWindow(window, now);
}

/** The offset of `zone` from UTC at `instant`, in minutes (positive east of Greenwich). */
function offsetMinutes(zone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/**
 * A wall clock time in the owner's zone (`2026-11-03T09:00`) as the UTC instant stored (AC-6111), or undefined for
 * a time that can't be read or a zone the platform doesn't know. A time a clock change skips is read forward, one
 * it repeats as its first, as calendars do.
 */
export function zonedToUtc(local: string, zone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    return undefined;
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(wall);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || hour > 23 || minute > 59) return undefined;
  try {
    // Two passes settle the offset either side of a clock change.
    const first = wall - offsetMinutes(zone, wall) * 60_000;
    const second = wall - offsetMinutes(zone, first) * 60_000;
    return new Date(second).toISOString();
  } catch {
    return undefined;
  }
}
