// A record's timeline (spec 0003, the record views; spec 0017): what happened
// to it, newest first, under period headings, each entry its actor, what they
// did and when. Entries come through a ListSource. The feed layout draws only
// those on screen and keeps the entry being read in place when newer ones
// arrive above it; the inline layout draws a few in place, for Overview.
import type { ActorDisplay, Hue, RecordRefDisplay } from '@crm/contracts/values';
import { defaultRangeExtractor, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Link } from '../../atoms/Link/Link.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { iconOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { isEmptyValue } from '../../fields/values.ts';
import { formatTimeRange } from '../../lib/format.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { safeHref } from '../../lib/safe-href.ts';
import type { ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { sizeToken } from '../../lib/token-values.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './ActivityFeed.module.css';
import { periodOf, type Period } from './periods.ts';
import { strings } from './strings.ts';

interface EntryBase {
  readonly id: string;
  /** When it happened, ISO 8601 in UTC. */
  readonly at: string;
  readonly actor: ActorDisplay;
}

/** A record a link entry names: its chip, and its page when it has one. */
export interface LinkedRecord {
  readonly display: RecordRefDisplay;
  /** The record's page, routed. */
  readonly href?: string;
}

/** A value changed: its attribute, and the value before and after, with their display shapes. */
export type ChangeEntry = EntryBase & {
  readonly kind: 'change';
  readonly attribute: FieldAttribute;
  readonly from: unknown;
  readonly to: unknown;
  readonly fromDisplay?: unknown;
  readonly toDisplay?: unknown;
};

/** One thing that happened to the record. */
export type ActivityEntry =
  | ChangeEntry
  | (EntryBase & {
      /**
       * One actor's changes at one moment (a save of several fields, an
       * import's row): "changed 3 attributes", their names, and Show all.
       */
      readonly kind: 'changes';
      readonly changes: readonly ChangeEntry[];
    })
  | (EntryBase & { readonly kind: 'created' })
  | (EntryBase & {
      /** The record moved to the trash: "moved this record to the trash". */
      readonly kind: 'deleted';
    })
  | (EntryBase & {
      /**
       * Records one write linked and unlinked on a relationship side: up to 3
       * named each way, and how many in all ("and 97 others").
       */
      readonly kind: 'links';
      readonly attribute: FieldAttribute;
      readonly added: readonly LinkedRecord[];
      readonly addedCount: number;
      readonly removed: readonly LinkedRecord[];
      readonly removedCount: number;
    })
  | (EntryBase & {
      /**
       * A note, task, comment or email: its title or subject, a line of its text, and its page. A `call` or
       * `logged_meeting` is one a person logged (migration 0141), at the moment it happened.
       */
      readonly kind: 'note' | 'task' | 'comment' | 'email' | 'call' | 'logged_meeting';
      readonly title?: string;
      readonly excerpt?: string;
      readonly href?: string;
      /** Tasks only: it was completed, not added. */
      readonly isDone?: boolean;
      /** A call or logged meeting: its length, already worded by the screen ("30 min"). */
      readonly duration?: string;
      /** A call or logged meeting: how it went, as a coloured tag with the label worded by the screen. */
      readonly outcome?: { readonly label: string; readonly hue: Hue };
    })
  | (EntryBase & {
      /**
       * A meeting with the record's people (spec 0024), at its start: its
       * title, its time, who comes and their answers, and the video link.
       * A private one the reader doesn't hold has `detailsHidden`: its time
       * only, under the title it was given ("Private meeting").
       */
      readonly kind: 'meeting';
      readonly title: string;
      /** ISO 8601 in UTC. An all day meeting starts and ends at midnight UTC (its end the day after). */
      readonly startsAt: string;
      readonly endsAt: string;
      readonly allDay?: boolean;
      readonly attendees: readonly MeetingAttendee[];
      readonly videoUrl?: string;
      readonly detailsHidden?: boolean;
      /** A meeting a booking made: the visitor's answers to its page's questions (spec 0057), each as plain words. */
      readonly answers?: readonly { readonly label: string; readonly text: string }[];
    })
  | (EntryBase & {
      /**
       * A form submission that touched the record (spec 0023): the form is
       * the actor ("Contact us created this record from a submission").
       */
      readonly kind: 'submission';
      readonly action: 'created' | 'updated' | 'matched' | 'linked';
      /** The submission's page, routed. */
      readonly href?: string;
    });

/** One attendee of a meeting entry: a person or member (their chip), or an address alone, and their answer. */
export interface MeetingAttendee {
  readonly email: string;
  /** The name the calendar gives them, shown for an address with no chip. */
  readonly name?: string;
  /** A person in the CRM, or a member of the workspace. */
  readonly display?: RecordRefDisplay | ActorDisplay;
  /** The person's page, routed. */
  readonly href?: string;
  readonly response: 'accepted' | 'declined' | 'tentative' | 'needs_action';
  /**
   * How the calendar's address matched the CRM (spec 0024): `unknown` offers
   * Add as person (when the feed has `onAddPerson`), `ambiguous` says several
   * people hold the address and links none.
   */
  readonly match?: 'linked' | 'ambiguous' | 'unknown' | 'member';
}

/** A meeting entry, as `onAddPerson` hands it back. */
export type MeetingEntry = Extract<ActivityEntry, { kind: 'meeting' }>;

/** How the feed lays out: scrolling inside its slot, or a few entries drawn in place. */
export type ActivityFeedLayout = 'feed' | 'inline';

/** The most entries the inline layout draws. */
export const INLINE_MAX = 10;

/** Props for ActivityFeed. */
export interface ActivityFeedProps {
  /** The feed's name ("Activity"). */
  readonly label: string;
  /** The entries, newest first. */
  readonly entries: ListSource<ActivityEntry>;
  /**
   * `feed` (the default): virtualised, scrolling inside its slot, and the
   * entry being read stays where it is when newer ones arrive above it.
   * `inline`: the first entries given (at most 10) drawn in place with no
   * scroll of their own, for a short block such as Overview's "Recent activity".
   */
  readonly layout?: ActivityFeedLayout;
  /** `loading` (the first page: skeleton entries after the loading delay), `error`, or `no-access`. */
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
  /**
   * Adds a meeting's attendee the CRM doesn't know as a person (spec 0024,
   * AC-609). Its button shows on each `unknown` attendee while given, and
   * spins until the promise settles; the screen says how it went.
   */
  readonly onAddPerson?: (meeting: MeetingEntry, attendee: MeetingAttendee) => Promise<void>;
  /** Drawn above the feed in every state (the Activity tab's filter); the feed takes the height left. */
  readonly toolbar?: ReactNode;
}

const KIND_ICONS: Readonly<Record<Exclude<ActivityEntry['kind'], 'change' | 'links'>, IconName>> = {
  created: 'plus',
  changes: 'pencil',
  deleted: 'trash',
  note: 'notebook',
  task: 'square-check',
  comment: 'message-square',
  email: 'mail',
  call: 'phone',
  logged_meeting: 'users',
  meeting: 'calendar',
  submission: 'clipboard-list',
};

const OVERSCAN = 4;

/** How far down the list a prepend is looked for: a live refresh adds at most a page (50) above. */
const PREPEND_SEARCH = 200;

/**
 * A checkbox's change: its verb says it all ("checked Email opt out"), so no
 * values draw under it. Two boxes and an arrow read as controls to tick and
 * took a line of their own (the owner, 21 October 2026).
 */
function isToggle(entry: ActivityEntry): boolean {
  return entry.kind === 'change' && entry.attribute.type === 'checkbox';
}

/** The verb after the actor: "changed", "set" or "cleared" for a value, "added" or "removed" for links, or what was added. */
function verbOf(entry: ActivityEntry): string {
  switch (entry.kind) {
    case 'change':
      if (isToggle(entry)) return entry.to === true ? strings.verbs.checked : strings.verbs.unchecked;
      if (isEmptyValue(entry.from)) return strings.verbs.set;
      return isEmptyValue(entry.to) ? strings.verbs.cleared : strings.verbs.changed;
    case 'created':
      return strings.verbs.created;
    case 'deleted':
      return strings.verbs.deleted;
    case 'changes':
      return strings.verbs.changedMany(entry.changes.length);
    case 'links':
      return entry.addedCount > 0 ? strings.verbs.added : strings.verbs.removed;
    case 'task':
      return entry.isDone === true ? strings.verbs.taskDone : strings.verbs.task;
    case 'meeting':
      return strings.meeting;
    case 'submission':
      return strings.verbs.submission[entry.action];
    default:
      return strings.verbs[entry.kind];
  }
}

/** A period's heading: Today, Yesterday, Earlier this week, or the month (with its year when not this one). */
function usePeriodLabel(): (period: Period) => string {
  const { locale, timeZone } = useFormatSettings();
  const now = useNow();
  const thisYear = memoIntl(
    `year:${timeZone}`,
    () => new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }),
  ).format(now);
  return (period) => {
    if (period === 'upcoming') return strings.upcoming;
    if (period === 'today') return strings.today;
    if (period === 'yesterday') return strings.yesterday;
    if (period === 'week') return strings.week;
    const [year = '', month = ''] = period.split('-');
    const withYear = year !== thisYear;
    const format = memoIntl(
      `period:${locale}:${String(withYear)}`,
      () =>
        new Intl.DateTimeFormat(locale, { month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }),
    );
    return format.format(Date.UTC(Number(year), Number(month) - 1, 15));
  };
}

interface KeepReadingInput {
  readonly entries: ListSource<ActivityEntry>;
  readonly isActive: boolean;
  /** The feed scrolls in its slot: the entry being read is kept in place too (the inline layout only moves its tab stop). */
  readonly isScrolling: boolean;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Entries arrived above: the tab stop moves down by as many, so it stays on the same entry. */
  readonly onShift: (by: number) => void;
}

/**
 * Keeps the entry being read where it is on screen when newer entries arrive
 * above it (spec 0017, AC-381). After each render it notes the first entry
 * on screen and how far into it the feed is scrolled; when the first entry's
 * key moves down the list, the feed scrolls by the room the new ones take.
 * At the very top nothing moves, so the newest entries show.
 */
function useKeepReading({ entries, isActive, isScrolling, scrollRef, virtualizer, onShift }: KeepReadingInput): void {
  // The newest entry's key at the last render.
  const firstKey = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!isActive || element === null) return;
    const newest = entries.getItem(0);
    const key = newest === undefined ? undefined : entries.getKey(newest);
    const before = firstKey.current;
    firstKey.current = key;
    if (before === undefined || key === undefined || key === before) return;
    let added = -1;
    for (let index = 1; index < Math.min(entries.count, PREPEND_SEARCH); index += 1) {
      const item = entries.getItem(index);
      if (item !== undefined && entries.getKey(item) === before) {
        added = index;
        break;
      }
    }
    if (added <= 0) return;
    onShift(added);
    if (!isScrolling) return;
    // Sizes are kept by entry, so everything that was there moved down by exactly the new entries' room.
    const room = virtualizer.measurementsCache[added]?.start ?? 0;
    // Before paint, so the entry being read never visibly jumps; the scroll event that follows tells the virtualiser.
    if (element.scrollTop > 0) element.scrollTop += room;
  });
}

/**
 * A record's timeline, newest first: value changes (the old and new values in
 * their one display), records linked and unlinked, notes, tasks, comments,
 * emails and meetings, under period headings. It is a feed: one tab stop, and
 * the arrows or Page Up and Page Down move between entries. In the feed
 * layout only the entries on screen draw, and those not loaded yet draw as
 * skeletons.
 */
export function ActivityFeed({ toolbar, ...props }: ActivityFeedProps) {
  if (toolbar === undefined) return <FeedContent {...props} />;
  return (
    <div className={styles.framed}>
      <div className={styles.toolbarRow}>{toolbar}</div>
      <div className={styles.framedBody}>
        <FeedContent {...props} />
      </div>
    </div>
  );
}

/** The feed itself, in whichever state it is. */
function FeedContent({
  label,
  entries,
  layout = 'feed',
  status = 'ready',
  onRetry,
  onAddPerson,
}: Omit<ActivityFeedProps, 'toolbar'>) {
  const isInline = layout === 'inline';
  const { locale, timeZone, weekStart } = useFormatSettings();
  const now = useNow();
  const labelOf = usePeriodLabel();
  const showSkeleton = useDelayedLoading(status === 'loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // The tab stop, kept inside the entries there are: a feed read afresh with fewer keeps one.
  const tabStop = Math.max(0, Math.min(active, (isInline ? Math.min(entries.count, INLINE_MAX) : entries.count) - 1));
  const pendingFocus = useRef(false);
  // Focus is on one of the feed's entries (or inside one).
  const holdsFocus = useRef(false);
  const idBase = useId();
  // Sizes are kept by entry, not by place, so entries arriving above keep every measured height. A new function
  // only with a new source, since the virtualiser measures everything again when it changes.
  const keyAt = useCallback(
    (index: number) => {
      const item = entries.getItem(index);
      return item === undefined ? `index:${String(index)}` : entries.getKey(item);
    },
    [entries],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual hands back new functions each render, so the feed stays outside the compiler's memoisation.
  const virtualizer = useVirtualizer({
    // The inline layout draws its few entries itself.
    count: isInline ? 0 : entries.count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 2 * sizeToken('size-row'),
    getItemKey: keyAt,
    overscan: OVERSCAN,
    // The entry holding the tab stop stays drawn, so focus never drops to the page.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return indexes.includes(tabStop) || tabStop >= entries.count
        ? indexes
        : [...indexes, tabStop].sort((a, b) => a - b);
    },
  });
  const items = virtualizer.getVirtualItems();
  // The range on screen, without the kept entry holding the tab stop.
  const first = virtualizer.range?.startIndex;
  const last = virtualizer.range?.endIndex;
  const onRangeChange = entries.onRangeChange;
  useEffect(() => {
    if (first === undefined || last === undefined) return;
    onRangeChange?.({ start: first, end: last + 1 });
  }, [first, last, onRangeChange]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(tabStop)}"]`)?.focus();
  });
  // The focused entry was drawn again under its own key (it loaded) and the browser dropped focus without a
  // blur: it goes back to the entry holding the tab stop, so the next key still moves through the feed.
  useEffect(() => {
    if (!holdsFocus.current) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(tabStop)}"]`)?.focus();
  });
  useKeepReading({
    entries,
    isActive: status === 'ready',
    isScrolling: !isInline,
    scrollRef,
    virtualizer,
    onShift: (by) => {
      setActive((index) => index + by);
    },
  });

  if (status === 'error') {
    return (
      <EmptyState tone="error" icon="activity" title={strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />
    );
  }
  if (status === 'no-access') {
    return (
      <EmptyState tone="locked" title={strings.noAccess}>
        {strings.noAccessBody}
      </EmptyState>
    );
  }
  if (status === 'loading') {
    return (
      <div className={styles.root} data-layout={layout} aria-busy="true">
        {showSkeleton && [0, 1, 2].map((row) => <SkeletonEntry key={row} />)}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  if (entries.count === 0) {
    return (
      <EmptyState icon="activity" title={strings.empty}>
        {strings.emptyBody}
      </EmptyState>
    );
  }

  // Inline: the first entries in place, each at its own height, with nothing virtual.
  const drawn = isInline
    ? Array.from({ length: Math.min(entries.count, INLINE_MAX) }, (_, index) => ({ index, start: 0 }))
    : items;
  const shownCount = isInline ? drawn.length : entries.count;
  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(shownCount - 1, index));
    pendingFocus.current = true;
    setActive(next);
    if (!isInline) virtualizer.scrollToIndex(next, { align: 'auto' });
  };
  // Keys move between entries from the entry itself; inside one (on a link) they do what they always do.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'article') return;
    const from = Number(event.target.dataset.index);
    const step: Partial<Record<string, number>> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };
    const by = step[event.key];
    // The feed pattern's way out: Ctrl (or Cmd) with End or Home leaves for what comes after or before the feed,
    // so a long feed's linked names never stand between the reader and the rest of the page.
    if ((event.ctrlKey || event.metaKey) && (event.key === 'Home' || event.key === 'End')) {
      const root = scrollRef.current;
      const target = root === null ? undefined : tabbableBeside(root, event.key === 'End' ? 'after' : 'before');
      if (target !== undefined) {
        event.preventDefault();
        target.focus();
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : shownCount - 1);
    } else if (by !== undefined) {
      event.preventDefault();
      moveTo(from + by);
    }
  };

  const busy = drawn.some((item) => entries.getItem(item.index) === undefined);
  // The feed's last entry still loading: more pages wait past it.
  const hasTail = !isInline && entries.count > 0 && entries.getItem(entries.count - 1) === undefined;
  // Inline sits under its block's own heading (a Card's h3), so its periods are a level below.
  const Heading = isInline ? 'h4' : 'h3';
  return (
    // The feed pattern: its articles take focus, and the feed moves it between them.
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
    <div
      ref={scrollRef}
      className={styles.root}
      data-layout={layout}
      role="feed"
      aria-label={label}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        holdsFocus.current = true;
      }}
      // An entry that loads while focused is drawn again under its own key; focus follows it.
      onBlur={(event) => {
        const lost = event.target;
        const next = event.relatedTarget;
        if (next instanceof Node && scrollRef.current?.contains(next) === true) return;
        queueMicrotask(() => {
          const focused = document.activeElement;
          if (lost.isConnected || (focused !== null && focused !== document.body)) {
            holdsFocus.current = false;
            return;
          }
          scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(tabStop)}"]`)?.focus();
        });
      }}
    >
      <div
        className={styles.body}
        {...(isInline ? {} : { style: { '--feed-height': `${String(virtualizer.getTotalSize())}px` } })}
      >
        {drawn.map((item) => {
          const entry = entries.getItem(item.index);
          // Whether the entry at `index` opens a new period under its own heading (unknown while it loads: no).
          const startsNewPeriod = (index: number) => {
            const next = entries.getItem(index);
            const before = entries.getItem(index - 1);
            return (
              next !== undefined &&
              before !== undefined &&
              periodOf(next.at, now, timeZone, locale, weekStart) !==
                periodOf(before.at, now, timeZone, locale, weekStart)
            );
          };
          const previous = item.index === 0 ? undefined : entries.getItem(item.index - 1);
          const period = entry === undefined ? undefined : periodOf(entry.at, now, timeZone, locale, weekStart);
          const startsPeriod =
            period !== undefined &&
            (item.index === 0 ||
              (previous !== undefined && periodOf(previous.at, now, timeZone, locale, weekStart) !== period));
          return (
            <div
              key={entry === undefined ? `index:${String(item.index)}` : entries.getKey(entry)}
              {...(isInline
                ? {}
                : { ref: virtualizer.measureElement, style: { '--entry-offset': `${String(item.start)}px` } })}
              data-index={item.index}
              className={styles.slot}
              // Every entry is an article that takes the tab stop, loaded or not, so focus never lands nowhere.
              role="article"
              aria-posinset={item.index + 1}
              // While the last one is still loading (more to come), how many in all isn't known yet.
              aria-setsize={hasTail ? -1 : shownCount}
              tabIndex={item.index === tabStop ? 0 : -1}
              onFocus={(event: FocusEvent<HTMLDivElement>) => {
                if (event.target === event.currentTarget) setActive(item.index);
              }}
              {...(entry === undefined
                ? { 'aria-busy': true, 'aria-label': strings.loadingEntry }
                : {
                    'aria-labelledby': `${idBase}-${String(item.index)}`,
                    // What changed and when: read after the line on focus.
                    'aria-describedby': [
                      `${idBase}-${String(item.index)}-time`,
                      ...(hasDetail(entry) ? [`${idBase}-${String(item.index)}-detail`] : []),
                    ].join(' '),
                  })}
            >
              {startsPeriod && (
                <Heading className={styles.period} data-first={(isInline && item.index === 0) || undefined}>
                  {labelOf(period)}
                </Heading>
              )}
              {entry === undefined ? (
                <SkeletonEntry />
              ) : (
                <Entry
                  entry={entry}
                  lineId={`${idBase}-${String(item.index)}`}
                  endsRail={item.index === shownCount - 1 || startsNewPeriod(item.index + 1)}
                  onAddPerson={onAddPerson}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkeletonEntry() {
  return (
    <div className={styles.entry} aria-hidden="true">
      <span className={styles.marker}>
        <Skeleton shape="circle" />
      </span>
      <span className={styles.main}>
        <Skeleton width="medium" />
        <Skeleton width="long" />
      </span>
    </div>
  );
}

interface NamesProps {
  readonly records: readonly LinkedRecord[];
  /** How many records in all: those past the names read "and N others". */
  readonly count: number;
}

/** "Jane Doe, Ada Lovelace, Alan Turing and 97 others": each name a flat chip, linked to its page. */
function Names({ records, count }: NamesProps) {
  const { locale } = useFormatSettings();
  const others = Math.max(0, count - records.length);
  const formatted = memoIntl(`number:${locale}`, () => new Intl.NumberFormat(locale)).format(others);
  // No name could be read (each went away meanwhile): the count alone, "3 records".
  if (records.length === 0) return <span>{strings.records(formatted, others === 1)}</span>;
  return (
    <>
      {records.map((record, index) => {
        const isLastName = index === records.length - 1;
        // A comma after every name but the last, and before "and" only when more names follow it.
        const separator = !isLastName && (index < records.length - 2 || others > 0) ? strings.listSeparator : '';
        return (
          <Fragment key={record.display.recordId}>
            {isLastName && index > 0 && others === 0 && <span>{strings.listLast}</span>}
            <span className={styles.keep}>
              <RecordChip
                display={record.display}
                isFlat
                {...(record.href === undefined ? {} : { href: record.href })}
              />
              {/* The chips' own boxes part the names on screen; the comma is for screen readers. */}
              {separator !== '' && <VisuallyHidden>{separator}</VisuallyHidden>}
            </span>
          </Fragment>
        );
      })}
      {others > 0 && (
        <span>
          {strings.listLast} {strings.others(formatted, others === 1)}
        </span>
      )}
    </>
  );
}

interface EntryProps {
  readonly entry: ActivityEntry;
  /** Names the article: the actor and what they did. */
  readonly lineId: string;
  /** No rail under it: the last entry drawn, or the last of its period (the next sits under a heading). */
  readonly endsRail: boolean;
  readonly onAddPerson: ActivityFeedProps['onAddPerson'];
}

/** What a links entry says after the actor: "added A, B and C to Team, and removed D from Team". */
function LinksLine({ entry }: { readonly entry: Extract<ActivityEntry, { kind: 'links' }> }) {
  const hasAdded = entry.addedCount > 0;
  const hasRemoved = entry.removedCount > 0;
  return (
    <>
      {hasAdded && (
        <>
          <span>{strings.verbs.added}</span>
          <Names records={entry.added} count={entry.addedCount} />
          <span>{strings.linkedTo}</span>
          <span className={styles.keep}>
            <span className={styles.attribute}>{entry.attribute.name}</span>
            {hasRemoved && strings.clauseSeparator}
          </span>
        </>
      )}
      {hasRemoved && (
        <>
          <span>{strings.verbs.removed}</span>
          <Names records={entry.removed} count={entry.removedCount} />
          <span>{strings.linkedFrom}</span>
          <span className={styles.attribute}>{entry.attribute.name}</span>
        </>
      )}
    </>
  );
}

/** Add as person beside an unknown attendee: spins while the person is made. */
function AddPersonButton({ onAdd, nameId }: { readonly onAdd: () => Promise<void>; readonly nameId: string }) {
  const [isAdding, setAdding] = useState(false);
  return (
    <Button
      variant="ghost"
      icon="user-plus"
      isPending={isAdding}
      aria-describedby={nameId}
      onPress={() => {
        if (isAdding) return;
        setAdding(true);
        void onAdd()
          .catch(() => undefined)
          .finally(() => {
            setAdding(false);
          });
      }}
    >
      {isAdding ? strings.addingPerson : strings.addPerson}
    </Button>
  );
}

/** How many of a booked meeting's answers its entry shows (spec 0057). */
const ANSWERS_SHOWN = 3;

/** A meeting's detail: when, who comes (each one's chip, and their answer unless they accepted), and the video link. */
function MeetingDetail({
  entry,
  detailId,
  onAddPerson,
}: {
  readonly entry: MeetingEntry;
  readonly detailId: string;
  readonly onAddPerson: ActivityFeedProps['onAddPerson'];
}) {
  const { locale, timeZone } = useFormatSettings();
  const when = formatTimeRange(entry.startsAt, entry.endsAt, entry.allDay === true, locale, timeZone);
  return (
    <span id={detailId} className={styles.card}>
      <span className={styles.when}>{when}</span>
      {entry.detailsHidden === true ? (
        <span className={styles.excerpt}>{strings.privateMeeting}</span>
      ) : (
        <>
          {entry.attendees.length > 0 && (
            <span className={styles.attendees}>
              <VisuallyHidden>{strings.attendees}</VisuallyHidden>
              {entry.attendees.map((attendee, index) => (
                <span key={attendee.email} className={styles.attendee}>
                  {attendee.display === undefined ? (
                    <span id={`${detailId}-attendee-${String(index)}`} className={styles.address}>
                      {attendee.name ?? attendee.email}
                    </span>
                  ) : (
                    <RecordChip
                      display={attendee.display}
                      isFlat
                      {...(attendee.href === undefined ? {} : { href: attendee.href })}
                    />
                  )}
                  {(attendee.response !== 'accepted' || attendee.match === 'ambiguous') && (
                    <span className={styles.response}>
                      {[
                        ...(attendee.response === 'accepted' ? [] : [strings.responses[attendee.response]]),
                        ...(attendee.match === 'ambiguous' ? [strings.ambiguous] : []),
                      ].join(', ')}
                    </span>
                  )}
                  {attendee.match === 'unknown' && attendee.display === undefined && onAddPerson !== undefined && (
                    <AddPersonButton
                      nameId={`${detailId}-attendee-${String(index)}`}
                      onAdd={() => onAddPerson(entry, attendee)}
                    />
                  )}
                </span>
              ))}
            </span>
          )}
          {entry.videoUrl !== undefined && (
            <span>
              <Link href={entry.videoUrl}>{strings.joinVideo}</Link>
            </span>
          )}
          {/* The visitor's answers, label then answer: text only, never markup, since a visitor typed them. The first
              few, so a long list never crowds the feed; the rest are on the booking. */}
          {entry.answers?.slice(0, ANSWERS_SHOWN).map((answer, index) => (
            <span key={`${answer.label}-${String(index)}`} className={styles.excerpt}>
              {strings.answerLine(answer.label, answer.text)}
            </span>
          ))}
          {entry.answers !== undefined && entry.answers.length > ANSWERS_SHOWN && (
            <span className={styles.excerpt}>{strings.moreAnswers(entry.answers.length - ANSWERS_SHOWN)}</span>
          )}
        </>
      )}
    </span>
  );
}

/**
 * A task's entry: one quiet row, its icon (a check once done) and its title,
 * a step quieter once done, the whole row opening the task when it has a
 * page. A card with an underlined link read heavier than the line above it.
 */
function TaskRow({
  entry,
  title,
  detailId,
}: {
  readonly entry: Extract<ActivityEntry, { kind: 'note' | 'task' | 'comment' | 'email' | 'call' | 'logged_meeting' }>;
  readonly title: string;
  readonly detailId: string;
}) {
  const isDone = entry.isDone === true;
  const face = (
    <>
      <Icon name={isDone ? 'circle-check' : 'list-todo'} size="sm" tone="muted" />
      <span className={styles.taskTitle}>{title}</span>
    </>
  );
  const href = safeHref(entry.href);
  return (
    <span id={detailId} className={styles.task} data-done={isDone || undefined}>
      {href === undefined ? (
        <span className={styles.taskFace}>{face}</span>
      ) : (
        <AriaLink className={styles.taskFace} href={href} data-pressable="">
          {face}
        </AriaLink>
      )}
    </span>
  );
}

/**
 * A logged call or meeting's detail: how it went as a tag and how long it ran, which open the entry when it has a
 * page, then the start of its notes. Nothing draws for one with none of them.
 */
function LoggedDetail({
  entry,
  detailId,
}: {
  readonly entry: Extract<ActivityEntry, { kind: 'note' | 'task' | 'comment' | 'email' | 'call' | 'logged_meeting' }>;
  readonly detailId: string;
}) {
  const href = safeHref(entry.href);
  const facts = (
    <span className={styles.facts}>
      {entry.outcome !== undefined && <Tag hue={entry.outcome.hue}>{entry.outcome.label}</Tag>}
      {entry.duration !== undefined && <span className={styles.duration}>{entry.duration}</span>}
    </span>
  );
  const hasFacts = entry.outcome !== undefined || entry.duration !== undefined;
  return (
    <span id={detailId} className={styles.card}>
      {hasFacts && (href === undefined ? facts : <Link href={href}>{facts}</Link>)}
      {entry.excerpt !== undefined &&
        (href === undefined ? (
          <span className={styles.excerpt}>{entry.excerpt}</span>
        ) : (
          <Link href={href}>
            <span className={styles.excerpt}>{entry.excerpt}</span>
          </Link>
        ))}
    </span>
  );
}

/** What can take focus by Tab, for the feed's way out. */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first element Tab reaches after `feed` (or the last one before it), outside it; undefined when none. */
function tabbableBeside(feed: HTMLElement, side: 'after' | 'before'): HTMLElement | undefined {
  const all = [...feed.ownerDocument.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => !feed.contains(element) && element.getClientRects().length > 0,
  );
  const follows = (element: HTMLElement) =>
    (feed.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return side === 'after' ? all.find(follows) : all.filter((element) => !follows(element)).at(-1);
}

/** Whether an entry draws a detail under its line: a change's values, a note's or task's title and text, a meeting. */
function hasDetail(entry: ActivityEntry): boolean {
  if (isToggle(entry)) return false;
  if (entry.kind === 'change') return !isEmptyValue(entry.from) || !isEmptyValue(entry.to);
  if (entry.kind === 'meeting' || entry.kind === 'changes') return true;
  if (entry.kind === 'call' || entry.kind === 'logged_meeting') {
    return entry.outcome !== undefined || entry.duration !== undefined || entry.excerpt !== undefined;
  }
  if (entry.kind === 'created' || entry.kind === 'deleted' || entry.kind === 'links' || entry.kind === 'submission') {
    return false;
  }
  return entry.title !== undefined || entry.excerpt !== undefined;
}

/** A change's old value, the arrow and the new value, each through the field set's one display (the card surface). */
function ChangeDetail({
  entry,
  detailId,
}: {
  readonly entry: Extract<ActivityEntry, { kind: 'change' }>;
  readonly detailId: string;
}) {
  const valueOf = (value: unknown, display: unknown) => (
    <AttributeDisplay
      attribute={entry.attribute}
      value={value ?? null}
      // One line per value, chips flat as the names around them: a long text is cut, Details holds it whole.
      surface="card"
      {...(display === undefined ? {} : { display: display as never })}
    />
  );
  const hasFrom = !isEmptyValue(entry.from);
  const hasTo = !isEmptyValue(entry.to);
  return (
    <span id={detailId} className={styles.change}>
      {hasFrom && valueOf(entry.from, entry.fromDisplay)}
      {hasFrom && (
        <>
          <Icon name="arrow-right" size="xs" tone="muted" />
          <VisuallyHidden>{strings.to}</VisuallyHidden>
        </>
      )}
      {/* A clear reads as the old value going to the empty mark, never as a value still held. */}
      {(hasTo || hasFrom) && valueOf(hasTo ? entry.to : null, hasTo ? entry.toDisplay : undefined)}
    </span>
  );
}

/**
 * A run of changes at one moment: their attributes' names on one line, and
 * Show all, which lays each change out as the single entry draws it (its name,
 * then the old value, the arrow and the new). The choice is the entry's own,
 * so it resets when the entry scrolls out of the window.
 */
function ChangesDetail({
  entry,
  detailId,
}: {
  readonly entry: Extract<ActivityEntry, { kind: 'changes' }>;
  readonly detailId: string;
}) {
  const [isOpen, setOpen] = useState(false);
  const names = [...new Set(entry.changes.map((change) => change.attribute.name))].join(strings.nameSeparator);
  return (
    <span id={detailId} className={styles.changes}>
      {isOpen ? (
        entry.changes.map((change) => (
          <span key={change.id} className={styles.changesRow}>
            <span className={styles.attribute}>{change.attribute.name}</span>
            {isToggle(change) ? (
              <span>{change.to === true ? strings.verbs.checked : strings.verbs.unchecked}</span>
            ) : (
              <ChangeDetail entry={change} detailId={`${detailId}-${change.id}`} />
            )}
          </span>
        ))
      ) : (
        <span className={styles.changesNames}>{names}</span>
      )}
      <span>
        <Button
          variant="ghost"
          size="sm"
          isExpanded={isOpen}
          onPress={() => {
            setOpen((open) => !open);
          }}
        >
          {isOpen ? strings.showLess : strings.showAll}
        </Button>
      </span>
    </span>
  );
}

/** One entry: its marker on the rail, the actor and verb, the time, and what changed or was added. */
/** Drawn again only when its entry changes, not with every scroll step of the feed. */
const Entry = memo(function Entry({ entry, lineId, endsRail, onAddPerson }: EntryProps) {
  const icon = entry.kind === 'change' || entry.kind === 'links' ? iconOf(entry.attribute) : KIND_ICONS[entry.kind];
  let detail: ReactNode;
  if (entry.kind === 'change') {
    // A checkbox's change draws nothing under its line: the verb says checked or unchecked.
    detail = isToggle(entry) ? undefined : <ChangeDetail entry={entry} detailId={`${lineId}-detail`} />;
  } else if (entry.kind === 'changes') {
    detail = <ChangesDetail entry={entry} detailId={`${lineId}-detail`} />;
  } else if (entry.kind === 'meeting') {
    detail = <MeetingDetail entry={entry} detailId={`${lineId}-detail`} onAddPerson={onAddPerson} />;
  } else if (entry.kind === 'task' && entry.title !== undefined) {
    detail = <TaskRow entry={entry} title={entry.title} detailId={`${lineId}-detail`} />;
  } else if (entry.kind === 'call' || entry.kind === 'logged_meeting') {
    detail = hasDetail(entry) ? <LoggedDetail entry={entry} detailId={`${lineId}-detail`} /> : undefined;
  } else if (
    entry.kind !== 'created' &&
    entry.kind !== 'deleted' &&
    entry.kind !== 'links' &&
    entry.kind !== 'submission' &&
    (entry.title !== undefined || entry.excerpt !== undefined)
  ) {
    // With no title (a comment), the text itself is the way to it.
    const excerptHref = entry.title === undefined ? entry.href : undefined;
    detail = (
      <span id={`${lineId}-detail`} className={styles.card}>
        {entry.title !== undefined &&
          (entry.href === undefined ? (
            <span className={styles.title}>{entry.title}</span>
          ) : (
            <Link href={entry.href}>{entry.title}</Link>
          ))}
        {entry.excerpt !== undefined &&
          (excerptHref !== undefined ? (
            <Link href={excerptHref}>
              <span className={styles.excerpt}>{entry.excerpt}</span>
            </Link>
          ) : (
            <span className={styles.excerpt}>{entry.excerpt}</span>
          ))}
      </span>
    );
  }
  return (
    <div className={styles.entry} data-rail-end={endsRail || undefined}>
      <span className={styles.marker}>
        <Icon name={icon} size="xs" tone="muted" />
      </span>
      <span className={styles.main}>
        <span className={styles.line}>
          <span id={lineId} className={styles.what}>
            {/* A meeting is nobody's doing on the record: "Meeting: Intro with Northwind". */}
            {entry.kind !== 'meeting' && <RecordChip display={entry.actor} isPlain />}
            {entry.kind === 'meeting' ? (
              <span className={styles.phrase}>
                <span>{verbOf(entry)}</span>
                <span className={styles.attribute}>{entry.title}</span>
              </span>
            ) : entry.kind === 'links' ? (
              <LinksLine entry={entry} />
            ) : (
              // The verb and the attribute stay on one line, so a narrow feed never splits "set Owner".
              <span className={styles.phrase}>
                <span>{verbOf(entry)}</span>
                {entry.kind === 'change' && <span className={styles.attribute}>{entry.attribute.name}</span>}
              </span>
            )}
          </span>
          <span id={`${lineId}-time`} className={styles.time}>
            <RelativeTime value={entry.at} />
          </span>
        </span>
        {detail}
      </span>
    </div>
  );
});
