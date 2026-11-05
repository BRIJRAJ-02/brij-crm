// Brief
// Purpose: the Meetings · Pages · Availability · Routing bar under Bookings' TopBar (as Calendly and Cal.com lay theirs out), in the row People's ViewBar takes, with the tab's tools at its end, as Captures has.
// Main task: switch between the meetings, the booking pages, the hours and routing; each tab opens on its first view, and its views (Day, Week, Team, List; My hours, Roster) switch inside it.
// Leaves out: what each view shows (its child route renders that into the chosen panel, and portals its tools into the strip's end).
import { SegmentedControl, TabPanel, Tabs, usePhoneWidth } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { strings } from './strings.ts';
import { BOOKINGS_TABS, bookingsTabHref, isBookingsPageTab, type BookingsPageTab, type BookingsView } from './tabs.ts';
import { HostsSwitch } from './HostsSwitch.tsx';
import { BookingsToolbarSlot, type HostsChoice } from './toolbarSlot.ts';

/** Props for BookingsTabs. */
export interface BookingsTabsProps {
  readonly slug: string;
  /** The tab the address names. */
  readonly tab: BookingsPageTab;
  /** The view the address names (Calendar and List under Meetings, Availability and Roster under Availability). */
  readonly view: BookingsView;
  /** The tabs this member has, in order (the Roster only for someone who sees a colleague's scheduling, Routing only for a holder of `routing.manage`). */
  readonly tabs?: readonly BookingsPageTab[];
  /** The child route's page (an `Outlet`), drawn in the chosen tab's panel. */
  readonly children: ReactNode;
  /**
   * Mine · Everyone at the strip's very end, after the tab's tools, for an admin on Calendar and List: drawn by the
   * layout, so it stands still as those tabs swap their tools in beside it.
   */
  readonly hosts?: HostsChoice | undefined;
  /** My hours · Roster at the strip's end on Availability, for whoever sees a colleague's scheduling; else absent. */
  readonly hasRoster?: boolean;
}

/**
 * Meetings · Pages · Availability · Routing. Choosing a tab moves to its first view's address; the panel holds
 * whatever that address renders, and the strip's end holds that view's tools.
 */
export function BookingsTabs({
  slug,
  tab,
  view,
  tabs = BOOKINGS_TABS,
  children,
  hosts,
  hasRoster = false,
}: BookingsTabsProps) {
  const navigate = useNavigate();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const isPhone = usePhoneWidth();
  return (
    <BookingsToolbarSlot.Provider value={slot}>
      <Tabs
        variant="bar"
        end={
          <>
            <div ref={setSlot} />
            {/* On a phone Meetings' View menu holds Mine · Everyone with its views (A14), so it leaves the strip. */}
            {hosts !== undefined && !(isPhone && (view === 'calendar' || view === 'list')) && (
              <HostsSwitch value={hosts.value} onChange={hosts.onChange} />
            )}
            {/* The member's own hours or the team's week, as Cal.com's My availability · Team availability. Drawn here,
                so it stands still as the two views swap their tools in beside it. */}
            {hasRoster && tab === 'availability' && (
              <SegmentedControl
                label={strings.availabilityViewsLabel}
                size="compact"
                isFitted
                value={view === 'roster' ? 'roster' : 'availability'}
                onChange={(next) => {
                  const to = next === 'roster' ? 'roster' : 'availability';
                  if (to !== view) void navigate({ href: bookingsTabHref(slug, to) });
                }}
                segments={(['availability', 'roster'] as const).map((each) => ({
                  value: each,
                  label: strings.availabilityViews[each],
                }))}
              />
            )}
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
