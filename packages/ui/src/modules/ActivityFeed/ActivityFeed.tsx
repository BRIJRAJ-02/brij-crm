// A record's timeline (spec 0003, the record views): what happened to it,
// newest first, under period headings, each entry its actor, what they did
// and when. Entries come through a ListSource and only those on screen draw.
import type { ActorDisplay } from '@crm/contracts/values';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
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
      /** A note, task, comment, email or meeting: its title or subject, a line of its text, and its page. */
      readonly kind: 'note' | 'task' | 'comment' | 'email' | 'meeting';
      readonly title?: string;
      readonly excerpt?: string;
      readonly href?: string;
      /** Tasks only: it was completed, not added. */
      readonly isDone?: boolean;
    });

/** Props for ActivityFeed. */
export interface ActivityFeedProps {
  /** The feed's name ("Activity"). */
  readonly label: string;
  /** The entries, newest first. */
  readonly entries: ListSource<ActivityEntry>;
  /** The first page is still coming: skeleton entries after the loading delay. */
  readonly isLoading?: boolean;
  /** The entries failed to load; Try again calls this. */
  readonly onRetry?: () => void;
}

const KIND_ICONS: Readonly<Record<Exclude<ActivityEntry['kind'], 'change'>, IconName>> = {
  created: 'plus',
  note: 'notebook',
  task: 'square-check',
  comment: 'message-square',
  email: 'mail',
  meeting: 'calendar',
};

const OVERSCAN = 4;

/** The verb after the actor: "changed", "set" or "cleared" for a value, or what was added. */
function verbOf(entry: ActivityEntry): string {
  switch (entry.kind) {
    case 'change':
      if (isEmptyValue(entry.from)) return strings.verbs.set;
      return isEmptyValue(entry.to) ? strings.verbs.cleared : strings.verbs.changed;
    case 'created':
      return strings.verbs.created;
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

/**
 * A record's timeline, newest first: value changes (the old and new values in
 * their one display), notes, tasks, comments, emails and meetings, under
 * period headings. It is a feed: one tab stop, and the arrows or Page Up and
 * Page Down move between entries. Only the entries on screen draw, and those
 * not loaded yet draw as skeletons.
 */
export function ActivityFeed({ label, entries, isLoading = false, onRetry }: ActivityFeedProps) {
  const { locale, timeZone } = useFormatSettings();
  const now = useNow();
  const labelOf = usePeriodLabel();
  const showSkeleton = useDelayedLoading(isLoading);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const pendingFocus = useRef(false);
  const idBase = useId();
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual hands back new functions each render, so the feed stays outside the compiler's memoisation.
  const virtualizer = useVirtualizer({
    count: entries.count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 2 * sizeToken('size-row'),
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

  if (onRetry !== undefined) {
    return <EmptyState tone="error" icon="activity" title={strings.failed} onRetry={onRetry} />;
  }
  if (isLoading) {
    return (
      <div className={styles.root} aria-busy="true">
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

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(entries.count - 1, index));
    pendingFocus.current = true;
    setActive(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  };
  // Keys move between entries from the entry itself; inside one (on a link) they do what they always do.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'article') return;
    const from = Number(event.target.dataset.index);
    const step: Partial<Record<string, number>> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };
    const by = step[event.key];
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : entries.count - 1);
    } else if (by !== undefined) {
      event.preventDefault();
      moveTo(from + by);
    }
  };

  const busy = items.some((item) => entries.getItem(item.index) === undefined);
  return (
    // The feed pattern: its articles take focus, and the feed moves it between them.
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
    <div
      ref={scrollRef}
      className={styles.root}
      role="feed"
      aria-label={label}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
    >
      <div className={styles.body} style={{ '--feed-height': `${String(virtualizer.getTotalSize())}px` }}>
        {items.map((item) => {
          const entry = entries.getItem(item.index);
          const previous = item.index === 0 ? undefined : entries.getItem(item.index - 1);
          const period = entry === undefined ? undefined : periodOf(entry.at, now, timeZone, locale);
          const startsPeriod =
            period !== undefined &&
            (item.index === 0 || (previous !== undefined && periodOf(previous.at, now, timeZone, locale) !== period));
          return (
            <div
              key={entry === undefined ? `index:${String(item.index)}` : entries.getKey(entry)}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={styles.slot}
              style={{ '--entry-offset': `${String(item.start)}px` }}
              {...(entry === undefined
                ? {}
                : {
                    role: 'article',
                    'aria-posinset': item.index + 1,
                    'aria-setsize': entries.count,
                    'aria-labelledby': `${idBase}-${String(item.index)}`,
                    tabIndex: item.index === active ? 0 : -1,
                    onFocus: (event: FocusEvent<HTMLDivElement>) => {
                      if (event.target === event.currentTarget) setActive(item.index);
                    },
                  })}
            >
              {startsPeriod && <h3 className={styles.period}>{labelOf(period)}</h3>}
              {entry === undefined ? (
                <SkeletonEntry />
              ) : (
                <Entry
                  entry={entry}
                  lineId={`${idBase}-${String(item.index)}`}
                  isLast={item.index === entries.count - 1}
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

interface EntryProps {
  readonly entry: ActivityEntry;
  /** Names the article: the actor and what they did. */
  readonly lineId: string;
  readonly isLast: boolean;
}

/** One entry: its marker on the rail, the actor and verb, the time, and what changed or was added. */
function Entry({ entry, lineId, isLast }: EntryProps) {
  const icon = entry.kind === 'change' ? fieldTypeOf(entry.attribute.type).icon : KIND_ICONS[entry.kind];
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
  } else if (entry.kind !== 'created' && (entry.title !== undefined || entry.excerpt !== undefined)) {
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
            <span>{verbOf(entry)}</span>
            {entry.kind === 'change' && <span className={styles.attribute}>{entry.attribute.name}</span>}
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
