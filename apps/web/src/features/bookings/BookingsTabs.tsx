// Brief
// Purpose: the Meetings · Hours · Hosts · Calendars bar under Bookings' TopBar, in the row People's ViewBar takes, one tab per child route, with that tab's tools at its end, as Captures has.
// Main task: switch between the four jobs Bookings holds: what is booked, when we are free, who takes the booking, and the calendars it reads.
// Leaves out: which view of a tab shows (that is the tab's own switch, on its tools' row, so the strip holds tabs and nothing else).
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
  /** The tabs this member has, in order; every member has all four, since each tab's own views carry the gates. */
  readonly tabs?: readonly BookingsPageTab[];
  /** The child route's page (an `Outlet`), drawn in the chosen tab's panel. */
  readonly children: ReactNode;
}

/**
 * Meetings · Hours · Hosts · Calendars. Choosing a tab moves to its address; the panel holds whatever that address
 * renders, and the strip's end holds that tab's tools. Four tabs, so nothing scrolls off a phone's strip, and no
 * view switch lives up here: each tab's views sit on its own tools' row, one control row per screen.
 */
export function BookingsTabs({ slug, tab, tabs = BOOKINGS_TABS, children }: BookingsTabsProps) {
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
        tabs={tabs.map((id) => ({ id, label: strings.pageTabs[id], href: bookingsTabHref(slug, id) }))}
      >
        {/* One panel, always the chosen tab's: the page under it stays mounted while the next one loads, rather
            than moving to another panel and mounting again before it is swapped. */}
        <TabPanel id={tab}>{children}</TabPanel>
      </Tabs>
    </BookingsToolbarSlot.Provider>
  );
}
