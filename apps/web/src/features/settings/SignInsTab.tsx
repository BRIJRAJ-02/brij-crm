// Brief
// Purpose: History › Your sign ins (spec 0046, AC-4619): the reader's own sign ins and sign in changes, the same list Account › Sign in and devices shows.
// Main task: check recent sign ins on this account, in every workspace, for the last 90 days.
// Leaves out: anyone else's sign ins (owners included, AC-4620), IP addresses, and the devices list (Sign in and devices keeps it).
import type { ActivityPage, DataLayer } from '@crm/data';
import { Card, SettingsRow, SettingsSection, Skeleton } from '@crm/ui';
import { RecentActivitySection } from './RecentActivitySection.tsx';
import { strings as security } from './security-strings.ts';

/** Props for Your sign ins. */
export interface SignInsTabProps {
  readonly data: DataLayer;
  /** The first page as the route's loader started it; undefined once read when that read failed. */
  readonly first: Promise<ActivityPage | undefined>;
  /** Reads the first page again (this route's loader alone). */
  readonly onRetry: () => void;
}

/**
 * Your sign ins: Recent activity as it is, two doors to one list (owner decision 2). Its heading becomes "Your sign
 * ins" with "In every workspace, for the last 90 days." once the account lane's `title` and `description` land.
 */
export function SignInsTab({ data, first, onRetry }: SignInsTabProps) {
  return <RecentActivitySection data={data} first={first} onRetry={onRetry} />;
}

/**
 * Your sign ins while its route loads: the section as Recent activity draws it while its first page loads, under the
 * same heading and line, so nothing changes when it arrives. Both move to "Your sign ins" together once
 * RecentActivitySection takes `title` and `description` (the account lane), with `history-strings.ts`'s
 * `signInsTitle` and `signInsText`.
 */
export function SignInsPending() {
  return (
    <SettingsSection title={security.activity.section} description={security.activity.description}>
      <Card isBusy>
        {[0, 1, 2].map((index) => (
          <SettingsRow key={index} title="" description={<Skeleton width="medium" />} />
        ))}
      </Card>
    </SettingsSection>
  );
}
