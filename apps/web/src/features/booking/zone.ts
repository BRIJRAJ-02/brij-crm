// The browser's time zone, alone in its file: the Bookings routes' loaders read
// it up front, so hours.ts, and every booking word it draws, loads only with the
// screens that use them (the first load budget, spec 0003, AC-18). The member's own zone, from Preferences, wins.
import type { DataLayer } from '@crm/data';

/** The browser's zone. */
export const browserZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The member's own zone in a workspace (Settings › Account › Preferences), else the browser's: what the
 * scheduling screens (Bookings' week, hours, schedules, new pages and meetings) show and make times in. The
 * workspace frame reads the preferences before its first page, so they are there by the time a screen asks.
 */
export const memberZone = (data: Pick<DataLayer, 'preferences'>, slug: string): string => {
  const held = data.preferences.of(slug).getSnapshot();
  return (held.status === 'ready' ? held.preferences.timeZone : undefined) ?? browserZone();
};
