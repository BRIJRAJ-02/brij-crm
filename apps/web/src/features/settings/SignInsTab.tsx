// Brief
// Purpose: History › Your sign ins (spec 0046, AC-4619): the reader's own sign ins and sign in changes, the same list Account › Sign in and devices shows.
// Main task: check recent sign ins on this account, in every workspace, for the last 90 days.
// Leaves out: anyone else's sign ins (owners included, AC-4620), IP addresses, and the devices list (Sign in and devices keeps it).
import type { ActivityPage, DataLayer } from '@crm/data';
import { RecentActivityPending, RecentActivitySection } from './RecentActivitySection.tsx';
import { strings } from './history-strings.ts';

/** Props for Your sign ins. */
export interface SignInsTabProps {
  readonly data: DataLayer;
  /** The first page as the route's loader started it; undefined once read when that read failed. */
  readonly first: Promise<ActivityPage | undefined>;
  /** Reads the first page again (this route's loader alone). */
  readonly onRetry: () => void;
}

/** Your sign ins: Recent activity as it is, two doors to one list (owner decision 2), under the tab's own heading. */
export function SignInsTab({ data, first, onRetry }: SignInsTabProps) {
  return (
    <RecentActivitySection
      data={data}
      first={first}
      onRetry={onRetry}
      title={strings.signInsTitle}
      description={strings.signInsText}
    />
  );
}

/**
 * Your sign ins while its route loads: the same heading and line over the section's own loading rows, so nothing
 * changes when it arrives.
 */
export function SignInsPending() {
  return <RecentActivityPending title={strings.signInsTitle} description={strings.signInsText} />;
}
