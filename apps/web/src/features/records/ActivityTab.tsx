// Brief
// Purpose: what happened to a record, newest first, on its page's Activity tab (and Overview's Recent activity).
// Main task: read who changed what and when (one save's changes as one entry), with its notes, tasks, threads and meetings, as it happens.
// Leaves out: emails (#43), a restore's own entry (the record keeps no history of it), and which job made a change.
import type {
  ActivityEntryShape,
  ActivityFeed as ActivityFeedSource,
  ActivityKind,
  ActivityState,
  EntrySource,
} from '@crm/data';
import { useActivity } from '@crm/data/react';
import { ActivityFeed, Select, type ActivityFeedLayout, type MeetingAttendee, type MeetingEntry } from '@crm/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  /** The timeline cut to some kinds: given, the tab shows its filter (All, Changes, Notes, Calls, Tasks, Comments, Meetings). */
  readonly feedFor?: (kinds: readonly ActivityKind[]) => Promise<ActivityFeedSource>;
}

/** The filter's choices and the kinds each reads; All reads the whole feed. */
const FILTERS: readonly { readonly id: string; readonly label: string; readonly kinds?: readonly ActivityKind[] }[] = [
  { id: 'all', label: strings.filterAll },
  { id: 'changes', label: strings.filterChanges, kinds: ['created', 'change', 'links', 'deleted', 'submission'] },
  { id: 'notes', label: strings.filterNotes, kinds: ['note'] },
  { id: 'calls', label: strings.filterCalls, kinds: ['call'] },
  { id: 'tasks', label: strings.filterTasks, kinds: ['task'] },
  { id: 'comments', label: strings.filterComments, kinds: ['comment'] },
  { id: 'meetings', label: strings.filterMeetings, kinds: ['meeting', 'logged_meeting'] },
];

/**
 * The Activity tab: the filter over the timeline. All shows the whole feed the
 * page holds; another choice reads its own feed (live as the whole one is),
 * which shows loading in place until it arrives.
 */
export function ActivityTab(props: ActivityTabProps) {
  const { feed, feedFor } = props;
  const [filter, setFilter] = useState('all');
  const [filtered, setFiltered] = useState<{ readonly id: string; readonly feed: ActivityFeedSource } | undefined>(
    undefined,
  );
  const kinds = FILTERS.find((each) => each.id === filter)?.kinds;
  useEffect(() => {
    if (kinds === undefined || feedFor === undefined) return;
    let isLive = true;
    void feedFor(kinds).then(
      (made) => {
        if (isLive) setFiltered({ id: filter, feed: made });
      },
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [filter, kinds, feedFor]);
  if (feedFor === undefined) return <Timeline {...props} />;
  const shown = kinds === undefined ? feed : filtered?.id === filter ? filtered.feed : undefined;
  return (
    <Timeline
      {...props}
      feed={shown ?? feed}
      isSwitching={shown === undefined}
      toolbar={
        <Select
          label={strings.activityFilter}
          isLabelHidden
          size="sm"
          items={FILTERS.map(({ id, label }) => ({ id, label }))}
          value={filter}
          onChange={(next) => {
            if (typeof next === 'string') setFilter(next);
          }}
        />
      }
    />
  );
}

/** A record's timeline, paging as it scrolls and live, with Try again when it fails. */
function Timeline({
  feed,
  link,
  taskHref,
  label = strings.activity,
  layout = 'feed',
  onAddPerson,
  toolbar,
  isSwitching = false,
}: ActivityTabProps & { readonly toolbar?: ReactNode; readonly isSwitching?: boolean }) {
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
      // A filter's own feed on its way: the feed loads in place, never showing the last choice's entries as this one's.
      status={isSwitching ? 'loading' : feedStatus(state)}
      onRetry={feed.retry}
      {...(toolbar === undefined ? {} : { toolbar })}
      {...(addPerson === undefined ? {} : { onAddPerson: addPerson })}
    />
  );
}
