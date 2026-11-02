// Brief
// Purpose: the two view switches a Bookings tab draws on its own tools' row, Hours' Mine · Team and Hosts' Groups · Rules, since the strip was cut to four areas (2 November 2026).
// Main task: move between a tab's views, keeping each view's own address, with one compact control in the place the calendar's Day · Week · Team day · List sits.
// Leaves out: Meetings' own switch, which lives in BookingsScreen beside the week it drives, and any view a reader may not see, which is simply absent.
import { SegmentedControl } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { strings } from './strings.ts';
import { HOURS_VIEWS, HOSTS_VIEWS, isHostsView, isHoursView, type HostsView, type HoursView } from './tabs.ts';

/** Props for HoursViewSwitch. */
export interface HoursViewSwitchProps {
  readonly slug: string;
  readonly view: HoursView;
}

/**
 * Hours' Mine · Team. Drawn only where the reader's scheduling reach sees a colleague (`rosterIsShown`, checked by
 * the route): for everybody else a roster of one is their own hours, so there is nothing to switch between and no
 * switch at all, rather than a control with one dead segment.
 */
export function HoursViewSwitch({ slug, view }: HoursViewSwitchProps) {
  return (
    <Switch
      label={strings.hoursViewLabel}
      value={view}
      views={HOURS_VIEWS}
      labelOf={(id) => strings.hoursViews[id]}
      isView={isHoursView}
      hrefOf={(next) => `/w/${slug}/bookings/hours${next === 'team' ? '?v=team' : ''}`}
    />
  );
}

/** Props for HostsViewSwitch. */
export interface HostsViewSwitchProps {
  readonly slug: string;
  readonly view: HostsView;
}

/**
 * Hosts' Groups · Rules. Drawn only for a holder of `routing.manage`: without it there are no rules to reach, so
 * the switch is absent rather than offering a segment that would bounce back.
 */
export function HostsViewSwitch({ slug, view }: HostsViewSwitchProps) {
  return (
    <Switch
      label={strings.hostsViewLabel}
      value={view}
      views={HOSTS_VIEWS}
      labelOf={(id) => strings.hostsViews[id]}
      isView={isHostsView}
      hrefOf={(next) => `/w/${slug}/bookings/hosts${next === 'rules' ? '?v=rules' : ''}`}
    />
  );
}

/**
 * The switch both tabs draw: a compact SegmentedControl whose segments are addresses. Each view keeps its own
 * search, so moving between them starts the other clean rather than carrying a week into a schedule editor or a
 * schedule id into a week. A third view (Hosts' Insights, lane L9) is one more entry in its `*_VIEWS` list.
 */
function Switch<View extends string>({
  label,
  value,
  views,
  labelOf,
  isView,
  hrefOf,
}: {
  readonly label: string;
  readonly value: View;
  readonly views: readonly View[];
  readonly labelOf: (view: View) => string;
  readonly isView: (value: unknown) => value is View;
  readonly hrefOf: (view: View) => string;
}) {
  const navigate = useNavigate();
  return (
    <SegmentedControl
      label={label}
      size="compact"
      value={value}
      onChange={(next) => {
        if (isView(next) && next !== value) void navigate({ href: hrefOf(next) });
      }}
      segments={views.map((id) => ({ value: id, label: labelOf(id) }))}
    />
  );
}
