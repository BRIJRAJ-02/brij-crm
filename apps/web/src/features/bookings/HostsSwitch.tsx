// Brief
// Purpose: whose bookings an owner or admin sees on Bookings (the owner's ask of 29 October 2026: a colleague's
// booking stays theirs): their own, or everyone's.
// Main task: switch the week and the list between Mine and Everyone; only a holder of `booking.admin` sees it, since
// for anyone else there is nothing but their own.
// Leaves out: picking one colleague (spec 0037's reach brings that), and colleagues' calendar events, which never show.
import type { BookingHosts } from '@crm/data';
import { SegmentedControl } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

// The choice is kept per workspace in this browser as a convenience. The routes' loaders read the default (Mine)
// and never this, so it stays out of the first load: an admin who kept Everyone sees the week or list load once more.

/** Where the choice is kept, per workspace, in this browser: a convenience only, Mine when it can't be read. */
const keyOf = (slug: string) => `crm.bookings.hosts.${slug}`;

/** The choice kept in this browser for a workspace; Mine when none is kept or storage is blocked. */
function readHosts(slug: string): BookingHosts {
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
  const [kept, setKept] = useState(() => ({ slug, value: readHosts(slug) }));
  // Another workspace: its own choice.
  if (kept.slug !== slug) setKept({ slug, value: readHosts(slug) });
  const value = kept.slug === slug ? kept.value : readHosts(slug);
  return {
    hosts: isAdmin ? value : ('mine' as const),
    choose: (next: BookingHosts) => {
      writeHosts(slug, next);
      setKept({ slug, value: next });
    },
  };
}

/** Mine · Everyone, as one compact SegmentedControl (arrow keys move and choose). */
export function HostsSwitch({
  value,
  onChange,
}: {
  readonly value: BookingHosts;
  readonly onChange: (next: BookingHosts) => void;
}) {
  return (
    <SegmentedControl
      label={strings.hostsLabel}
      size="compact"
      isFitted
      segments={[
        { value: 'mine', label: strings.hosts.mine },
        { value: 'all', label: strings.hosts.all },
      ]}
      value={value}
      onChange={(next) => onChange(next === 'all' ? 'all' : 'mine')}
    />
  );
}
