// Brief
// Purpose: whose bookings an owner or admin sees on Bookings (the owner's ask of 29 October 2026: a colleague's
// booking stays theirs): their own, or everyone's.
// Main task: switch the week and the list between Mine and Everyone; only a holder of `booking.admin` sees it, since
// for anyone else there is nothing but their own.
// Leaves out: picking one colleague (spec 0037's reach brings that), and colleagues' calendar events, which never show.
import type { BookingHosts } from '@crm/data';
import { SegmentedControl } from '@crm/ui';
import { strings } from './strings.ts';

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
