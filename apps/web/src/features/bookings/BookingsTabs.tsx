// Brief
// Purpose: the Calendar · List · Availability bar under Bookings' TopBar, in the row People's ViewBar takes, one tab per child route, with that tab's tools at its end, as Captures has.
// Main task: switch between the week calendar, the list and the member's own hours, each with its own address.
// Leaves out: what each tab shows (its child route renders that into the chosen panel, and portals its tools into the strip's end).
import { TabPanel, Tabs } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { strings } from './strings.ts';
import { BOOKINGS_TABS, bookingsTabHref, isBookingsPageTab, type BookingsPageTab } from './tabs.ts';
import { BookingsToolbarSlot } from './toolbarSlot.ts';

/** Props for BookingsTabs. */
export interface BookingsTabsProps {
  readonly slug: string;
  /** The tab the address names. */
  readonly tab: BookingsPageTab;
  /** The child route's page (an `Outlet`), drawn in the chosen tab's panel. */
  readonly children: ReactNode;
}

/**
 * Calendar · List · Availability. Choosing a tab moves to its address; the panel holds whatever that address
 * renders, and the strip's end holds that tab's tools.
 */
export function BookingsTabs({ slug, tab, children }: BookingsTabsProps) {
  const navigate = useNavigate();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <BookingsToolbarSlot.Provider value={slot}>
      <Tabs
        variant="bar"
        end={<div ref={setSlot} />}
        label={strings.pageTabsLabel}
        selectedKey={tab}
        onSelectionChange={(next) => {
          if (isBookingsPageTab(next) && next !== tab) void navigate({ href: bookingsTabHref(slug, next) });
        }}
        tabs={BOOKINGS_TABS.map((id) => ({ id, label: strings.pageTabs[id], href: bookingsTabHref(slug, id) }))}
      >
        {/* One panel, always the chosen tab's: the page under it stays mounted while the next one loads, rather
            than moving to another panel and mounting again before it is swapped. */}
        <TabPanel id={tab}>{children}</TabPanel>
      </Tabs>
    </BookingsToolbarSlot.Provider>
  );
}
