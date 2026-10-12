// Brief
// Purpose: what happened to a record, newest first, on its page's Activity tab (and Overview's Recent activity).
// Main task: read who did what and when; in milestone 1 that is who made the record.
// Leaves out: changes and link entries, paging as it scrolls and live updates (milestone 2), notes, tasks and comments.
import type { ActivityFeed as ActivityFeedSource, ActivityState } from '@crm/data';
import { useActivity } from '@crm/data/react';
import { ActivityFeed } from '@crm/ui';
import { strings } from './strings.ts';

/** The feed's status, as the library draws it: a record that isn't available can't be read, so no Try again. */
export function feedStatus(state: ActivityState): 'loading' | 'ready' | 'error' | 'no-access' {
  if (state.status === 'unavailable') return 'no-access';
  return state.status;
}

/** Props for a record's timeline. */
export interface ActivityTabProps {
  readonly feed: ActivityFeedSource;
  /** The feed's name: "Activity" on its tab, "Recent activity" on Overview. */
  readonly label?: string;
}

/** A record's timeline, filling its slot and scrolling inside it, with Try again when it fails. */
export function ActivityTab({ feed, label = strings.activity }: ActivityTabProps) {
  const state = useActivity(feed);
  return <ActivityFeed label={label} entries={state.source} status={feedStatus(state)} onRetry={feed.retry} />;
}
