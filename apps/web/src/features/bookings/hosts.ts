// Whose bookings an admin's Bookings asks for (HostsSwitch), kept per workspace in this browser as a convenience.
// Plain helpers and one hook, no screen module, so the routes' loaders can read the kept choice.
import type { BookingHosts } from '@crm/data';
import { useState } from 'react';

/** Where the choice is kept, per workspace, in this browser: a convenience only, Mine when it can't be read. */
const keyOf = (slug: string) => `crm.bookings.hosts.${slug}`;

/**
 * Whose bookings to ask for: the choice kept in this browser for an admin, Mine for anyone else, or when none is kept
 * or storage is blocked. The loaders and the screens ask through it alike, so they hold the same read.
 */
export function readHosts(slug: string, isAdmin: boolean): BookingHosts {
  if (!isAdmin) return 'mine';
  try {
    return globalThis.localStorage.getItem(keyOf(slug)) === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
}

/** Keeps the choice in this browser, where storage allows. */
function writeHosts(slug: string, hosts: BookingHosts): void {
  try {
    globalThis.localStorage.setItem(keyOf(slug), hosts);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/**
 * Whose bookings the screen asks for: the kept choice for an admin, always Mine for anyone else (the server answers
 * Mine for them anyway, so asking for more would only be a second read of the same bookings).
 */
export function useHostsChoice(slug: string, isAdmin: boolean) {
  const [kept, setKept] = useState(() => ({ slug, value: readHosts(slug, true) }));
  // Another workspace: its own choice.
  if (kept.slug !== slug) setKept({ slug, value: readHosts(slug, true) });
  const value = kept.slug === slug ? kept.value : readHosts(slug, true);
  return {
    hosts: isAdmin ? value : ('mine' as const),
    choose: (next: BookingHosts) => {
      writeHosts(slug, next);
      setKept({ slug, value: next });
    },
  };
}
