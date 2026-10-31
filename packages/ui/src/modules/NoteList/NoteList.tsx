// Notes (spec 0019, a record's Notes tab): each note's title, a two line
// excerpt, its author and when it was last edited; a row opens the note.
// Notes come through a ListSource, and only the rows on screen draw.
import type { ActorDisplay, Hue, RecordRefDisplay } from '@crm/contracts/values';
import { useMemo, type ReactNode } from 'react';
import { GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { useFontsSettled } from '../../lib/fonts-settled.ts';
import { keyedRows, itemOfKey, type KeyedRow } from '../../lib/keyed-rows.ts';
import type { ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { RowShown, useRangeReporter } from '../../lib/range-reporter.tsx';
import { sizeToken } from '../../lib/token-values.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './NoteList.module.css';
import { strings } from './strings.ts';

/** A call or meeting logged on a record (migration 0137), as a note's row shows it. */
export interface NoteListActivity {
  readonly kind: 'call' | 'meeting';
  /** When it happened, ISO 8601 in UTC: the row shows this in place of "Edited …". */
  readonly occurredAt: string;
  /** Its length, already worded by the screen ("30 min"). */
  readonly duration?: string;
  /** How it went, as a coloured tag: the label already worded by the screen. */
  readonly outcome?: { readonly label: string; readonly hue: Hue };
}

/** One note, as a list shows it. */
export interface NoteListItem {
  readonly id: string;
  /** Its title; an empty one reads "Untitled note". */
  readonly title: string;
  /** The start of its text, plain; cut at two lines. */
  readonly excerpt: string;
  /** Who wrote it. */
  readonly author: ActorDisplay;
  /** When it was last edited, ISO 8601 in UTC. */
  readonly updatedAt: string;
  /** The record it is on, where notes of many records mix (the workspace's Notes page): a flat chip first in its line. */
  readonly record?: RecordRefDisplay;
  /** A logged call or meeting: its icon leads the title, its outcome tags it, and its line tells when and how long. */
  readonly activity?: NoteListActivity;
}

/** Props for NoteList. */
export interface NoteListProps {
  /** The list's name ("Notes"). */
  readonly label: string;
  readonly notes: ListSource<NoteListItem>;
  /** Enter or a click on a row: open the note. */
  readonly onAction: (id: string) => void;
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
  /** What an empty list says, in place of the library's own words ("No notes yet. Write the first one."). */
  readonly emptyTitle?: string;
  /** The line under `emptyTitle`. */
  readonly emptyBody?: string;
  /** The empty state's action, under its words ("New note"), so the way to start is where the eye lands. */
  readonly emptyActions?: ReactNode;
  /** Drawn above the list in every state ("New note"). */
  readonly toolbar?: ReactNode;
  /**
   * `block` (the default): the empty state centred with its icon. `row`: one quiet line, for a list whose toolbar
   * already holds the way to start (a record's "Write a note…"), so an empty tab is not a sea of white under a big
   * icon (owner, 31 Oct).
   */
  readonly emptyLayout?: 'block' | 'row';
}

/** A row's estimated height before it is measured: a title, two lines of excerpt and the author, about three rows. */
const ESTIMATED_ROW = 3;

/** The skeleton a row draws while its note loads: a title and two lines. */
function RowSkeleton() {
  return (
    <span className={styles.skeleton}>
      <Skeleton width="medium" />
      <Skeleton lines={2} />
    </span>
  );
}

/**
 * Notes as a React Aria grid list, last edited first as the screen orders
 * them: the title, a two line excerpt, the author's avatar and name, and
 * "Edited 3 hours ago". The arrows move between rows and Enter opens one.
 * Only the rows on screen draw, and those not loaded yet draw as skeletons.
 */
export function NoteList({ toolbar, ...props }: NoteListProps) {
  if (toolbar === undefined) return <NoteListContent {...props} />;
  return (
    <div className={styles.frame}>
      <div className={styles.toolbar}>{toolbar}</div>
      <div className={styles.body}>
        <NoteListContent {...props} />
      </div>
    </div>
  );
}

/** The list itself, in whichever state it is. */
function NoteListContent({
  label,
  notes,
  onAction,
  status = 'ready',
  onRetry,
  emptyTitle,
  emptyBody,
  emptyActions,
  emptyLayout = 'block',
}: Omit<NoteListProps, 'toolbar'>) {
  const showSkeleton = useDelayedLoading(status === 'loading');
  const onShown = useRangeReporter(notes);
  const rows = useMemo(() => keyedRows(notes), [notes]);
  const fontsSettled = useFontsSettled();

  if (status === 'error') {
    return (
      <EmptyState tone="error" icon="notebook" title={strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />
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
      <div className={styles.root} aria-busy="true">
        {showSkeleton &&
          [0, 1, 2].map((row) => (
            <div key={row} className={styles.row}>
              <RowSkeleton />
            </div>
          ))}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="notebook"
        layout={emptyLayout}
        title={emptyTitle ?? strings.empty}
        {...(emptyActions === undefined ? {} : { actions: emptyActions })}
      >
        {emptyBody}
      </EmptyState>
    );
  }

  const renderRow = (row: KeyedRow): ReactNode => {
    const note = notes.getItem(row.index);
    if (note === undefined) {
      return (
        <GridListItem id={row.id} className={styles.row} textValue="" isDisabled data-loading="">
          <RowShown index={row.index} onShown={onShown} />
          <RowSkeleton />
        </GridListItem>
      );
    }
    const activity = note.activity;
    const isUntitled = note.title.trim() === '';
    const title = !isUntitled
      ? note.title
      : activity === undefined
        ? strings.untitled
        : activity.kind === 'call'
          ? strings.call
          : strings.meeting;
    return (
      <GridListItem id={row.id} className={styles.row} textValue={title} data-pressable="">
        <RowShown index={row.index} onShown={onShown} />
        {activity === undefined ? (
          <span className={styles.title} data-untitled={isUntitled || undefined}>
            <TruncatedText>{title}</TruncatedText>
          </span>
        ) : (
          <span className={styles.heading}>
            <Icon name={activity.kind === 'call' ? 'phone' : 'users'} size="sm" tone="muted" />
            <span className={styles.title}>
              <TruncatedText>{title}</TruncatedText>
            </span>
            {activity.outcome !== undefined && <Tag hue={activity.outcome.hue}>{activity.outcome.label}</Tag>}
          </span>
        )}
        {note.excerpt !== '' && (
          <span className={styles.excerpt}>
            <TruncatedText lines={2}>{note.excerpt}</TruncatedText>
          </span>
        )}
        <span className={styles.meta}>
          {note.record !== undefined && (
            <>
              <span className={styles.record}>
                <RecordChip display={note.record} isFlat />
              </span>
              <span aria-hidden="true">{strings.separator}</span>
            </>
          )}
          <Avatar
            name={note.author.name}
            id={note.author.id ?? note.author.name}
            size="xs"
            isDecorative
            {...(note.author.imageSrc === undefined ? {} : { src: note.author.imageSrc })}
            {...(note.author.hue === undefined ? {} : { hue: note.author.hue })}
          />
          <VisuallyHidden>{`${strings.by} `}</VisuallyHidden>
          <span className={styles.author}>{note.author.name}</span>
          <span aria-hidden="true">{strings.separator}</span>
          <span className={styles.time}>
            {activity === undefined ? (
              <>
                {`${strings.edited} `}
                <RelativeTime value={note.updatedAt} />
              </>
            ) : (
              <>
                <RelativeTime value={activity.occurredAt} />
                {activity.duration !== undefined && ` ${strings.separator} ${activity.duration}`}
              </>
            )}
          </span>
        </span>
      </GridListItem>
    );
  };

  return (
    <Virtualizer layout={ListLayout} layoutOptions={{ estimatedRowHeight: ESTIMATED_ROW * sizeToken('size-row') }}>
      <GridList
        className={styles.root}
        aria-label={label}
        items={rows}
        // Fonts in: each row built, and so measured, again (a row measured in the fallback face is too short).
        dependencies={[notes, fontsSettled]}
        onAction={(key) => {
          const note = itemOfKey(notes, rows, key);
          if (note !== undefined) onAction(note.id);
        }}
      >
        {renderRow}
      </GridList>
    </Virtualizer>
  );
}
