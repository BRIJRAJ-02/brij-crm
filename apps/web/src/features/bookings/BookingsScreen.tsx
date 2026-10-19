// Brief
// Purpose: the workspace's upcoming bookings, a sidebar destination after Records.
// Main task: see what is coming up; until the list lands, find the way to the booking links and Availability.
// Leaves out: the upcoming list itself (spec 0025, milestone 2).
import { EmptyState, Link, TopBar } from '@crm/ui';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { availabilityHref } from '../booking/links.ts';
import { linksHref } from '../captures/tabs.ts';
import { strings } from './strings.ts';

/** Bookings: for now, its empty state with the way to Captures › Links. */
export function BookingsScreen({ slug }: { readonly slug: string }) {
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.title} icon="calendar-days" />,
        body: (
          <EmptyState
            icon="calendar-days"
            title={strings.emptyTitle}
            actions={
              <>
                <Link href={linksHref(slug)}>{strings.openLinks}</Link>
                <Link href={availabilityHref(slug)}>{strings.openAvailability}</Link>
              </>
            }
          >
            {strings.emptyText}
          </EmptyState>
        ),
      }}
    />
  );
}
