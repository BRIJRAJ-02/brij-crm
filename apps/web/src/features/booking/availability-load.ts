// Availability's loader (spec 0035, AC-969 to AC-971), apart from the screen so both of its routes (Bookings ›
// Availability and Settings › Scheduling › Availability, 5 November 2026) load the same way, and a loader never
// imports the screen module (the first load).
import type { DataLayer, MemberView, VisibleMember } from '@crm/data';
import { memberZone } from './zone.ts';

/** What the screen needs: whose schedules, the colleagues the reader may see, and the workspace's people. */
export interface AvailabilityLoad {
  /** The colleague whose schedules show; undefined for the reader's own. */
  readonly member: string | undefined;
  readonly members: readonly VisibleMember[];
  readonly me: string;
  readonly ownHours: boolean;
  readonly people: readonly MemberView[];
}

/**
 * Whose schedules the reader may see comes from the server's reach (`members.visible`, spec 0037, AC-1268): a
 * colleague outside it opens the reader's own. The schedules, time off and limits are held before the page draws.
 */
export async function loadAvailability(
  data: DataLayer,
  slug: string,
  wanted: string | undefined,
): Promise<AvailabilityLoad> {
  const [access, members, people] = await Promise.all([
    data.access.mine(slug),
    data.scheduling.open().then((scheduling) => scheduling.visible(slug)),
    data.members.list(slug),
  ]);
  const member =
    wanted !== undefined && wanted !== access.memberId && members.some((each) => each.id === wanted)
      ? wanted
      : undefined;
  await Promise.all([
    data.schedules.view(slug, member, memberZone(data, slug)).ready(),
    // Time off (spec 0037, AC-1286), from the store `scheduling.open()` loaded above; a failure shows in its card.
    data.scheduling
      .loaded()
      ?.timeOff.held(slug, member)
      .ready()
      .catch(() => undefined),
    // Meeting limits (spec 0037, AC-1299), the same way.
    data.scheduling
      .loaded()
      ?.limits.held(slug, member)
      .ready()
      .catch(() => undefined),
  ]);
  return { member, members, me: access.memberId, ownHours: access.permissions.includes('availability.own'), people };
}
