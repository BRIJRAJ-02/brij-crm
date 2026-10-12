// A record's timeline (spec 0003, the record views; spec 0017): what happened
// to it, newest first, under period headings, each entry its actor, what they
// did and when. Entries come through a ListSource. The feed layout draws only
// those on screen and keeps the entry being read in place when newer ones
// arrive above it; the inline layout draws a few in place, for Overview.
import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import { defaultRangeExtractor, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import {
  Fragment,
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
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Link } from '../../atoms/Link/Link.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { isEmptyValue } from '../../fields/values.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
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

/** One thing that happened to the record. */
export type ActivityEntry =
  | (EntryBase & {
      /** A value changed: its attribute, and the value before and after, with their display shapes. */
      readonly kind: 'change';
      readonly attribute: FieldAttribute;
      readonly from: unknown;
      readonly to: unknown;
      readonly fromDisplay?: unknown;
      readonly toDisplay?: unknown;
    })
  | (EntryBase & { readonly kind: 'created' })
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
      /** A note, task, comment, email or meeting: its title or subject, a line of its text, and its page. */
      readonly kind: 'note' | 'task' | 'comment' | 'email' | 'meeting';
      readonly title?: string;
      readonly excerpt?: string;
      readonly href?: string;
      /** Tasks only: it was completed, not added. */
      readonly isDone?: boolean;
    });

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
}

const KIND_ICONS: Readonly<Record<Exclude<ActivityEntry['kind'], 'change' | 'links'>, IconName>> = {
  created: 'plus',
  note: 'notebook',
  task: 'square-check',
  comment: 'message-square',
  email: 'mail',
  meeting: 'calendar',
};

const OVERSCAN = 4;

/** How far down the list a prepend is looked for: a live refresh adds at most a page (50) above. */
const PREPEND_SEARCH = 200;

/** The verb after the actor: "changed", "set" or "cleared" for a value, "added" or "removed" for links, or what was added. */
function verbOf(entry: ActivityEntry): string {
  switch (entry.kind) {
    case 'change':
      if (isEmptyValue(entry.from)) return strings.verbs.set;
      return isEmptyValue(entry.to) ? strings.verbs.cleared : strings.verbs.changed;
    case 'created':
      return strings.verbs.created;
    case 'links':
      return entry.addedCount > 0 ? strings.verbs.added : strings.verbs.removed;
    case 'task':
      return entry.isDone === true ? strings.verbs.taskDone : strings.verbs.task;
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
function useKeepReading({ entries, isActive, scrollRef, virtualizer, onShift }: KeepReadingInput): void {
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
export function ActivityFeed({ label, entries, layout = 'feed', status = 'ready', onRetry }: ActivityFeedProps) {
  const isInline = layout === 'inline';
  const { locale, timeZone } = useFormatSettings();
  const now = useNow();
  const labelOf = usePeriodLabel();
  const showSkeleton = useDelayedLoading(status === 'loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
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
      return indexes.includes(active) || active >= entries.count ? indexes : [...indexes, active].sort((a, b) => a - b);
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
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)?.focus();
  });
  // The focused entry was drawn again under its own key (it loaded) and the browser dropped focus without a
  // blur: it goes back to the entry holding the tab stop, so the next key still moves through the feed.
  useEffect(() => {
    if (!holdsFocus.current) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)?.focus();
  });
  useKeepReading({
    entries,
    isActive: !isInline && status === 'ready',
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
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : shownCount - 1);
    } else if (by !== undefined) {
      event.preventDefault();
      moveTo(from + by);
    }
  };

  const busy = drawn.some((item) => entries.getItem(item.index) === undefined);
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
          scrollRef.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)?.focus();
        });
      }}
    >
      <div
        className={styles.body}
        {...(isInline ? {} : { style: { '--feed-height': `${String(virtualizer.getTotalSize())}px` } })}
      >
        {drawn.map((item) => {
          const entry = entries.getItem(item.index);
          const previous = item.index === 0 ? undefined : entries.getItem(item.index - 1);
          const period = entry === undefined ? undefined : periodOf(entry.at, now, timeZone, locale);
          const startsPeriod =
            period !== undefined &&
            (item.index === 0 || (previous !== undefined && periodOf(previous.at, now, timeZone, locale) !== period));
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
              aria-setsize={shownCount}
              tabIndex={item.index === active ? 0 : -1}
              onFocus={(event: FocusEvent<HTMLDivElement>) => {
                if (event.target === event.currentTarget) setActive(item.index);
              }}
              {...(entry === undefined
                ? { 'aria-busy': true, 'aria-label': strings.loadingEntry }
                : { 'aria-labelledby': `${idBase}-${String(item.index)}` })}
            >
              {startsPeriod && <h3 className={styles.period}>{labelOf(period)}</h3>}
              {entry === undefined ? (
                <SkeletonEntry />
              ) : (
                <Entry
                  entry={entry}
                  lineId={`${idBase}-${String(item.index)}`}
                  isLast={item.index === shownCount - 1}
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
  return (
    <>
      {records.map((record, index) => {
        const isLastName = index === records.length - 1;
        // A comma after every name but the last, and before "and" only when more names follow it.
        const separator = !isLastName && (index < records.length - 2 || others > 0) ? strings.listSeparator : '';
        return (
          <Fragment key={record.display.recordId}>
            {isLastName && index > 0 && others === 0 && <span>{strings.listLast}</span>}
            <span className={styles.name}>
              <RecordChip
                display={record.display}
                isFlat
                {...(record.href === undefined ? {} : { href: record.href })}
              />
              {separator}
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
  readonly isLast: boolean;
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
          <span className={styles.name}>
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

/** One entry: its marker on the rail, the actor and verb, the time, and what changed or was added. */
function Entry({ entry, lineId, isLast }: EntryProps) {
  const icon =
    entry.kind === 'change' || entry.kind === 'links' ? fieldTypeOf(entry.attribute.type).icon : KIND_ICONS[entry.kind];
  let detail: ReactNode;
  if (entry.kind === 'change') {
    const valueOf = (value: unknown, display: unknown) => (
      <AttributeDisplay
        attribute={entry.attribute}
        value={value ?? null}
        surface="panel"
        {...(display === undefined ? {} : { display: display as never })}
      />
    );
    const hasFrom = !isEmptyValue(entry.from);
    const hasTo = !isEmptyValue(entry.to);
    detail = (
      <span className={styles.change}>
        {hasFrom && valueOf(entry.from, entry.fromDisplay)}
        {hasFrom && hasTo && (
          <>
            <Icon name="arrow-right" size="xs" tone="muted" />
            <VisuallyHidden>{strings.to}</VisuallyHidden>
          </>
        )}
        {hasTo && valueOf(entry.to, entry.toDisplay)}
      </span>
    );
  } else if (
    entry.kind !== 'created' &&
    entry.kind !== 'links' &&
    (entry.title !== undefined || entry.excerpt !== undefined)
  ) {
    detail = (
      <span className={styles.card}>
        {entry.title !== undefined &&
          (entry.href === undefined ? (
            <span className={styles.title}>{entry.title}</span>
          ) : (
            <Link href={entry.href}>{entry.title}</Link>
          ))}
        {entry.excerpt !== undefined && <span className={styles.excerpt}>{entry.excerpt}</span>}
      </span>
    );
  }
  return (
    <div className={styles.entry} data-last={isLast || undefined}>
      <span className={styles.marker}>
        <Icon name={icon} size="xs" tone="muted" />
      </span>
      <span className={styles.main}>
        <span className={styles.line}>
          <span id={lineId} className={styles.what}>
            <RecordChip display={entry.actor} isFlat />
            {entry.kind === 'links' ? (
              <LinksLine entry={entry} />
            ) : (
              <>
                <span>{verbOf(entry)}</span>
                {entry.kind === 'change' && <span className={styles.attribute}>{entry.attribute.name}</span>}
              </>
            )}
          </span>
          <span className={styles.time}>
            <RelativeTime value={entry.at} />
          </span>
        </span>
        {detail}
      </span>
    </div>
  );
}
