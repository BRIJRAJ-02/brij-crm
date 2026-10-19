// Brief
// Purpose: the workspace's upcoming bookings, a sidebar destination after Records.
// Main task: see what is coming up; until the booking lane lands, find the way to the booking links.
// Leaves out: the upcoming list itself, availability and booking pages (the booking lane brings them).
import { EmptyState, Link, TopBar } from '@crm/ui';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
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
            actions={<Link href={linksHref(slug)}>{strings.openLinks}</Link>}
          >
            {strings.emptyText}
          </EmptyState>
        ),
      }}
    />
  );
}
