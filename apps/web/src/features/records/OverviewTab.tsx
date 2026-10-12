// Brief
// Purpose: a record at a glance, the first tab of its page.
// Main task: see the newest things that happened to it, and go on to the whole timeline.
// Leaves out: Related cards (milestone 3), Highlights (#18) and Open tasks (#19).
import type { ActivityFeed } from '@crm/data';
import { Button, Card } from '@crm/ui';
import { ActivityTab } from './ActivityTab.tsx';
import { strings } from './strings.ts';
import type { RecordLink } from './timeline.ts';

/** Props for the Overview tab. */
export interface OverviewTabProps {
  /** The record's timeline cut to its newest five entries. */
  readonly recent: ActivityFeed;
  /** A linked record's page, for the names a link entry shows. */
  readonly link: RecordLink;
  /** Opens the Activity tab, as choosing the tab does (the address is replaced, focus moves to the tab). */
  readonly onViewAll: () => void;
}

/**
 * Overview: "Recent activity" in a Card, its newest five entries drawn in
 * place (never empty: the creation is always there), with "View all"
 * opening the Activity tab.
 */
export function OverviewTab({ recent, link, onViewAll }: OverviewTabProps) {
  return (
    <Card
      title={strings.recentActivity}
      actions={
        <Button variant="ghost" onPress={onViewAll}>
          {strings.viewAll}
        </Button>
      }
    >
      <ActivityTab feed={recent} link={link} label={strings.recentActivity} layout="inline" />
    </Card>
  );
}
