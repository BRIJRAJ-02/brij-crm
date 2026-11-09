// Brief
// Purpose: Bookings' Meetings · Pages · Availability · Routing on the TopBar's line (as Calendly and Cal.com lay theirs out), the page's one header with one line under it (the owner, 9 November 2026), and the tab's tools under it.
// Main task: switch between the meetings, the booking pages, the hours and routing; each tab opens on its first view, and its views (Day, Week, Team, List; My hours, Roster) switch inside it.
// Leaves out: what each view shows (its child route renders that under the bar, and portals its tools into the tools row).
import { SectionBar, SegmentedControl, Tabs, usePhoneWidth } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { strings } from './strings.ts';
import { BOOKINGS_TABS, bookingsTabHref, isBookingsPageTab, type BookingsPageTab, type BookingsView } from './tabs.ts';
import { HostsSwitch } from './HostsSwitch.tsx';
import { BookingsToolbarSlot, type HostsChoice } from './toolbarSlot.ts';

/** Props for BookingsModuleTabs. */
export interface BookingsModuleTabsProps {
  readonly slug: string;
  /** The tab the address names. */
  readonly tab: BookingsPageTab;
  /** The tabs this member has, in order (Routing only for a holder of `routing.manage`). */
  readonly tabs?: readonly BookingsPageTab[];
}

/**
 * Meetings · Pages · Availability · Routing, in Bookings' TopBar on its hairline. Each tab is its own address:
 * choosing one moves there, and the page under the bar is that address's.
 */
export function BookingsModuleTabs({ slug, tab, tabs = BOOKINGS_TABS }: BookingsModuleTabsProps) {
  const navigate = useNavigate();
  return (
    <Tabs
      variant="topbar"
      label={strings.pageTabsLabel}
      selectedKey={tab}
      onSelectionChange={(next) => {
        if (isBookingsPageTab(next) && next !== tab) void navigate({ href: bookingsTabHref(slug, next) });
      }}
      tabs={tabs.map((id) => ({ id, label: strings.pageTabs[id], href: bookingsTabHref(slug, id) }))}
    />
  );
}

/** The views whose screen portals its tools into the row under the bar (Pages' search, Routing's views). */
const VIEWS_WITH_TOOLS = new Set<BookingsView>(['pages', 'routing']);

/** Props for BookingsTabBody. */
export interface BookingsTabBodyProps {
  /** The view the address names. */
  readonly view: BookingsView;
  /** The child route's page (an `Outlet`). */
  readonly children: ReactNode;
}

/**
 * The chosen tab's page under the TopBar: on Pages and Routing, a row for the tools the screen portals in (Captures'
 * search, Overview · Decisions · Skills · Test); the other views draw their own bar (the week's dates, the schedule
 * switcher), so they get none and no empty row stands over them.
 */
export function BookingsTabBody({ view, children }: BookingsTabBodyProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const hasTools = VIEWS_WITH_TOOLS.has(view);
  return (
    <BookingsToolbarSlot.Provider value={hasTools ? slot : null}>
      {hasTools && <SectionBar variant="bar" end={<div ref={setSlot} />} />}
      {children}
    </BookingsToolbarSlot.Provider>
  );
}

/** Props for BookingsScope. */
export interface BookingsScopeProps {
  readonly slug: string;
  readonly tab: BookingsPageTab;
  readonly view: BookingsView;
  /** Mine · Everyone on Calendar and List, for an admin; else absent. */
  readonly hosts?: HostsChoice | undefined;
  /** My hours · Roster on Availability, for whoever sees a colleague's scheduling; else absent. */
  readonly hasRoster?: boolean;
}

/**
 * Whose bookings or hours the tab shows, in the TopBar before its primary action: Mine · Everyone on Meetings'
 * Calendar and List (an admin's), My hours · Roster on Availability. Drawn by the layout, so it stands still as the
 * views swap under it. Nothing for anyone with only their own.
 */
export function BookingsScope({ slug, tab, view, hosts, hasRoster = false }: BookingsScopeProps) {
  const navigate = useNavigate();
  const isPhone = usePhoneWidth();
  // On a phone Meetings' View menu holds Mine · Everyone with its views (A14), so it leaves the bar.
  if (hosts !== undefined && !(isPhone && (view === 'calendar' || view === 'list'))) {
    return <HostsSwitch value={hosts.value} onChange={hosts.onChange} />;
  }
  // The member's own hours or the team's week, as Cal.com's My availability · Team availability.
  if (hasRoster && tab === 'availability') {
    return (
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
    );
  }
  return null;
}
