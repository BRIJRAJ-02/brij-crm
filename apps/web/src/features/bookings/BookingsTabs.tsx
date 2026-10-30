// Brief
// Purpose: the Calendar · List · Availability · Roster · Round robin · Calendars bar under Bookings' TopBar, in the row People's ViewBar takes, one tab per child route, with that tab's tools at its end, as Captures has.
// Main task: switch between the week calendar, the list, the member's own hours, the team's week and the rest, each with its own address.
// Leaves out: what each tab shows (its child route renders that into the chosen panel, and portals its tools into the strip's end).
import { TabPanel, Tabs } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { strings } from './strings.ts';
import { BOOKINGS_TABS, bookingsTabHref, isBookingsPageTab, type BookingsPageTab } from './tabs.ts';
import { HostsSwitch } from './HostsSwitch.tsx';
import { BookingsToolbarSlot, type HostsChoice } from './toolbarSlot.ts';

/** Props for BookingsTabs. */
export interface BookingsTabsProps {
  readonly slug: string;
  /** The tab the address names. */
  readonly tab: BookingsPageTab;
  /** The tabs this member has, in order (the Roster only for someone who sees a colleague's scheduling). */
  readonly tabs?: readonly BookingsPageTab[];
  /** The child route's page (an `Outlet`), drawn in the chosen tab's panel. */
  readonly children: ReactNode;
  /**
   * Mine · Everyone at the strip's very end, after the tab's tools, for an admin on Calendar and List: drawn by the
   * layout, so it stands still as those tabs swap their tools in beside it.
   */
  readonly hosts?: HostsChoice | undefined;
}

/**
 * Calendar · List · Availability · Roster · Round robin · Calendars. Choosing a tab moves to its address; the panel holds whatever that address
 * renders, and the strip's end holds that tab's tools.
 */
export function BookingsTabs({ slug, tab, tabs = BOOKINGS_TABS, children, hosts }: BookingsTabsProps) {
  const navigate = useNavigate();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <BookingsToolbarSlot.Provider value={slot}>
      <Tabs
        variant="bar"
        end={
          <>
            <div ref={setSlot} />
            {hosts !== undefined && <HostsSwitch value={hosts.value} onChange={hosts.onChange} />}
          </>
        }
        label={strings.pageTabsLabel}
        selectedKey={tab}
        onSelectionChange={(next) => {
          if (isBookingsPageTab(next) && next !== tab) void navigate({ href: bookingsTabHref(slug, next) });
        }}
        tabs={tabs.map((id) => ({ id, label: strings.pageTabs[id], href: bookingsTabHref(slug, id) }))}
      >
        {/* One panel, always the chosen tab's: the page under it stays mounted while the next one loads, rather
            than moving to another panel and mounting again before it is swapped. */}
        <TabPanel id={tab}>{children}</TabPanel>
      </Tabs>
    </BookingsToolbarSlot.Provider>
  );
}
