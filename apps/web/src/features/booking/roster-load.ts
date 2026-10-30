// What Bookings › Roster's loader does, loaded with `import()` so the first load carries none of it (the route's
// loader stays in the first load, spec 0003's budget): who may have a roster, and the week's first read.
import type { DataLayer } from '@crm/data';
import { redirect } from '@tanstack/react-router';
import { memberZone } from './zone.ts';

/**
 * Whether the Roster shows (spec 0037, AC-1447): to an admin (`booking.admin`) and to anyone whose scheduling reach
 * sees a colleague (`seesOthers`); a roster of one is Availability, so everyone else has no such tab, and its address
 * falls back to Availability.
 */
export const rosterIsShown = (access: {
  readonly permissions: readonly string[];
  readonly scheduling?: { readonly seesOthers: boolean } | undefined;
}): boolean => access.permissions.includes('booking.admin') || access.scheduling?.seesOthers === true;

/**
 * The Roster's loader: anyone without a roster opens their own hours, Availability; else the week (`week`'s Monday,
 * else this week's) is read for the search `q` in the member's zone, with the members Set usual hours offers.
 */
export async function loadRoster(data: DataLayer, slug: string, week: string | undefined, q: string) {
  if (!rosterIsShown(await data.access.mine(slug))) {
    throw redirect({ to: '/w/$slug/bookings/availability', params: { slug }, replace: true });
  }
  const zone = memberZone(data, slug);
  const team = await (await data.scheduling.open()).openTeamWeek(slug, week, q, zone);
  return { zone, ...team };
}
