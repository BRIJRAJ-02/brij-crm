// Brief
// Purpose: Bookings' Meetings · Pages · Availability · Routing on the TopBar's line (as Calendly and Cal.com lay theirs out), the page's one header with one line under it (the owner, 9 November 2026).
// Main task: switch between the meetings, the booking pages, the hours and routing; each tab opens on its first view, and its views (List, Day, Week; My hours, Team hours) switch inside it.
// Leaves out: what each view shows (its child route renders that under the bar; Pages and Routing portal their tools into it).
import { SegmentedControl, Tabs } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { strings } from './strings.ts';
import { BOOKINGS_TABS, bookingsTabHref, isBookingsPageTab, type BookingsPageTab, type BookingsView } from './tabs.ts';

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

/** The views whose screen portals its tools into the TopBar (Pages' search, Routing's views and period). */
const VIEWS_WITH_TOOLS = new Set<BookingsView>(['pages', 'routing']);

/**
 * Whether a view's screen puts its tools in the TopBar, before whose bookings show and the primary action: Pages and
 * Routing, so no second bar stands under the header (the owner: one line under the module tabs). Calendar, List and
 * Availability draw their own bar.
 */
export const viewHasTools = (view: BookingsView): boolean => VIEWS_WITH_TOOLS.has(view);

/** Props for BookingsScope. */
export interface BookingsScopeProps {
  readonly slug: string;
  readonly tab: BookingsPageTab;
  readonly view: BookingsView;
  /** My hours · Team hours on Availability, for whoever sees a colleague's scheduling; else absent. */
  readonly hasRoster?: boolean;
}

/**
 * Whose hours Availability shows, in the TopBar before its primary action: My hours · Team hours, for whoever sees a
 * colleague's scheduling. Drawn by the layout, so it stands still as the views swap under it. Whose meetings show is
 * Meetings' own People picker, beside its views (the mock, 10 November 2026), so nothing stands here for Meetings.
 */
export function BookingsScope({ slug, tab, view, hasRoster = false }: BookingsScopeProps) {
  const navigate = useNavigate();
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
          icon: each === 'roster' ? 'users' : 'user',
        }))}
      />
    );
  }
  return null;
}
