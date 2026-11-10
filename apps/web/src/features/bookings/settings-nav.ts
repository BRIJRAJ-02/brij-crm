// Bookings settings' navigation (the mock's IA, 9 November 2026): the module's own settings behind the gear on its
// TopBar, grouped as the mock groups them. Plain data, no React, so the frame and the settings page share it.
import type { Permission } from '@crm/data';
import { bookingsSettingsHref, type BookingsSettingsPage } from '../booking/links.ts';
import { strings } from './settings-strings.ts';

/** One page of Bookings settings in its navigation. */
export interface BookingsSettingsEntry {
  readonly id: BookingsSettingsPage;
  readonly label: string;
  readonly href: string;
  readonly icon: 'calendar' | 'users-round' | 'eye' | 'timer' | 'palette';
  /** The group's name it sits under. */
  readonly group: string;
  /** A permission the page needs; absent, every member but a guest may open it. */
  readonly requires?: Permission;
}

/**
 * Bookings settings, in the mock's groups: Connections (Calendars), People (Teams, the round robin groups, and
 * Scheduling access), Meetings (Meeting limits, out of Availability on 10 November 2026) and Guests see (Brand, the
 * look booking pages wear). Booking notifications, Appointments and the all pages overview are not here: there is no
 * setting of theirs to move, and none is made up.
 */
export function bookingsSettingsNav(slug: string): readonly BookingsSettingsEntry[] {
  return [
    {
      id: 'calendars',
      label: strings.calendars,
      href: bookingsSettingsHref(slug, 'calendars'),
      icon: 'calendar',
      group: strings.groups.connections,
    },
    {
      id: 'teams',
      label: strings.teams,
      href: bookingsSettingsHref(slug, 'teams'),
      icon: 'users-round',
      group: strings.groups.people,
      requires: 'booking.manage',
    },
    {
      id: 'access',
      label: strings.access,
      href: bookingsSettingsHref(slug, 'access'),
      icon: 'eye',
      group: strings.groups.people,
    },
    {
      id: 'limits',
      label: strings.limits,
      href: bookingsSettingsHref(slug, 'limits'),
      icon: 'timer',
      group: strings.groups.meetings,
    },
    {
      id: 'brand',
      label: strings.brand,
      href: bookingsSettingsHref(slug, 'brand'),
      icon: 'palette',
      group: strings.groups.guestsSee,
    },
  ];
}

/**
 * The entries this member may open: none for a guest, who takes no bookings (spec 0031, slice 9); an entry that needs
 * a permission only with it. `permissions` undefined (still loading) keeps the entries that need none.
 */
export function visibleBookingsSettingsNav(
  entries: readonly BookingsSettingsEntry[],
  permissions: readonly Permission[] | undefined,
  isGuest: boolean,
): readonly BookingsSettingsEntry[] {
  if (isGuest) return [];
  return entries.filter((entry) => entry.requires === undefined || (permissions?.includes(entry.requires) ?? false));
}

/** The Bookings settings page an address shows, or undefined for none (bare `/bookings/settings`, an unknown page). */
export function bookingsSettingsPageOf(pathname: string): BookingsSettingsPage | undefined {
  const last = /^\/w\/[^/]+\/bookings\/settings\/([^/]+)\/*$/.exec(pathname)?.[1];
  return last === 'calendars' || last === 'teams' || last === 'access' || last === 'limits' || last === 'brand'
    ? last
    : undefined;
}
