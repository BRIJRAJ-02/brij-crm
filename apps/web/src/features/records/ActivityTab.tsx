// Brief
// Purpose: what happened to a record, newest first, on its page's Activity tab (and Overview's Recent activity).
// Main task: read who changed what and when, and which records were linked, as it happens.
// Leaves out: notes, tasks (#19) and comments (#29), filters, and the record's own delete and restore (#36).
import type { ActivityEntryShape, ActivityFeed as ActivityFeedSource, ActivityState } from '@crm/data';
import { useActivity } from '@crm/data/react';
import { ActivityFeed, type ActivityFeedLayout } from '@crm/ui';
import { useMemo, useState } from 'react';
import { strings } from './strings.ts';
import { linkedSource, type RecordLink } from './timeline.ts';

/** The feed's status, as the library draws it: a record that isn't available can't be read, so no Try again. */
export function feedStatus(state: ActivityState): 'loading' | 'ready' | 'error' | 'no-access' {
  if (state.status === 'unavailable') return 'no-access';
  return state.status;
}

/** Props for a record's timeline. */
export interface ActivityTabProps {
  readonly feed: ActivityFeedSource;
  /** A linked record's page, for the names a link entry shows. */
  readonly link: RecordLink;
  /** The feed's name: "Activity" on its tab, "Recent activity" on Overview. */
  readonly label?: string;
  /** `feed` fills its slot and scrolls inside it (the Activity tab); `inline` draws a few in place (Overview). */
  readonly layout?: ActivityFeedLayout;
}

/** A record's timeline, paging as it scrolls and live, with Try again when it fails. */
export function ActivityTab({ feed, link, label = strings.activity, layout = 'feed' }: ActivityTabProps) {
  const state = useActivity(feed);
  // One linked copy per entry for the feed's life, so an entry draws again only when it changes.
  const [cache] = useState(() => new WeakMap<object, ActivityEntryShape>());
  const source = useMemo(() => linkedSource(state.source, link, cache), [state.source, link, cache]);
  return (
    <ActivityFeed label={label} entries={source} layout={layout} status={feedStatus(state)} onRetry={feed.retry} />
  );
}
