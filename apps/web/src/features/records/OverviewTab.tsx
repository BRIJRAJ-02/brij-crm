// Brief
// Purpose: a record at a glance, the first tab of its page.
// Main task: see the newest things that happened to it, and go on to the whole timeline.
// Leaves out: Related cards (milestone 3) and Highlights (#18). Open tasks (#19) sit above it, from the page.
import type { ActivityFeed } from '@crm/data';
import { Button, Card } from '@crm/ui';
import { ActivityTab } from './ActivityTab.tsx';
import { strings } from './strings.ts';
import type { RecordLink, TaskLink } from './timeline.ts';

/** Props for the Overview tab. */
export interface OverviewTabProps {
  /** The record's timeline cut to its newest five entries. */
  readonly recent: ActivityFeed;
  /** A linked record's page, for the names a link entry shows. */
  readonly link: RecordLink;
  /** A task entry's dialog over the page (spec 0019). */
  readonly taskHref?: TaskLink;
  /** Opens the Activity tab, as choosing the tab does (the address is replaced, focus moves to the tab). */
  readonly onViewAll: () => void;
}

/**
 * Overview: "Recent activity" in a Card, its newest five entries drawn in
 * place (never empty: the creation is always there), with "View all"
 * opening the Activity tab.
 */
export function OverviewTab({ recent, link, taskHref, onViewAll }: OverviewTabProps) {
  return (
    <Card
      title={strings.recentActivity}
      actions={
        <Button variant="ghost" label={strings.viewAllActivity} onPress={onViewAll}>
          {strings.viewAll}
        </Button>
      }
    >
      <ActivityTab
        feed={recent}
        link={link}
        {...(taskHref === undefined ? {} : { taskHref })}
        label={strings.recentActivity}
        layout="inline"
      />
    </Card>
  );
}
