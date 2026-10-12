// Brief
// Purpose: a record at a glance, the first tab of its page.
// Main task: see the newest things that happened to it, and go on to the whole timeline.
// Leaves out: Related cards (milestone 3), Highlights (#18) and Open tasks (#19).
import type { ActivityFeed } from '@crm/data';
import { Card, Link } from '@crm/ui';
import { ActivityTab } from './ActivityTab.tsx';
import { strings } from './strings.ts';

/** Props for the Overview tab. */
export interface OverviewTabProps {
  /** The record's timeline cut to its newest five entries. */
  readonly recent: ActivityFeed;
  /** The Activity tab's address, for "View all". */
  readonly activityHref: string;
}

/** Overview: "Recent activity" in a Card, with "View all" opening the Activity tab. */
export function OverviewTab({ recent, activityHref }: OverviewTabProps) {
  return (
    <Card title={strings.recentActivity} actions={<Link href={activityHref}>{strings.viewAll}</Link>}>
      <ActivityTab feed={recent} label={strings.recentActivity} />
    </Card>
  );
}
