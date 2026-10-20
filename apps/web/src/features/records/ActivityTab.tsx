// Brief
// Purpose: what happened to a record, newest first, on its page's Activity tab (and Overview's Recent activity).
// Main task: read who changed what and when, and which records were linked, as it happens.
// Leaves out: notes (#19 milestone 3) and comments (#29), filters, and the record's own delete and restore (#36).
import type { ActivityEntryShape, ActivityFeed as ActivityFeedSource, ActivityState, EntrySource } from '@crm/data';
import { useActivity } from '@crm/data/react';
import { ActivityFeed, type ActivityFeedLayout, type MeetingAttendee, type MeetingEntry } from '@crm/ui';
import { useMemo } from 'react';
import { strings } from './strings.ts';
import { linkedSource, type RecordLink, type TaskLink } from './timeline.ts';

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
  /** A task entry's dialog over the page (spec 0019). */
  readonly taskHref?: TaskLink;
  /** The feed's name: "Activity" on its tab, "Recent activity" on Overview. */
  readonly label?: string;
  /** `feed` fills its slot and scrolls inside it (the Activity tab); `inline` draws a few in place (Overview). */
  readonly layout?: ActivityFeedLayout;
  /** Adds a meeting's unknown attendee as a person (spec 0024, AC-609): the meeting's id and the attendee. */
  readonly onAddPerson?: (meetingId: string, attendee: MeetingAttendee) => Promise<void>;
}

/** A record's timeline, paging as it scrolls and live, with Try again when it fails. */
export function ActivityTab({
  feed,
  link,
  taskHref,
  label = strings.activity,
  layout = 'feed',
  onAddPerson,
}: ActivityTabProps) {
  const state = useActivity(feed);
  // One linked copy per entry while the links stay the same, so an entry draws again only when it changes.
  const linking = useMemo(() => {
    const cache = new WeakMap<object, ActivityEntryShape>();
    return (entries: EntrySource) => linkedSource(entries, link, cache, taskHref);
  }, [link, taskHref]);
  const source = useMemo(() => linking(state.source), [linking, state.source]);
  // The feed hands back its own entry: the data layer's, which carries the meeting's id.
  const addPerson = useMemo(
    () =>
      onAddPerson === undefined
        ? undefined
        : (meeting: MeetingEntry, attendee: MeetingAttendee) =>
            'itemId' in meeting && typeof meeting.itemId === 'string'
              ? onAddPerson(meeting.itemId, attendee)
              : Promise.resolve(),
    [onAddPerson],
  );
  return (
    <ActivityFeed
      label={label}
      entries={source}
      layout={layout}
      status={feedStatus(state)}
      onRetry={feed.retry}
      {...(addPerson === undefined ? {} : { onAddPerson: addPerson })}
    />
  );
}
