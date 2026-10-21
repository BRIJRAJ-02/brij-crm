// Notes (spec 0019, a record's Notes tab): each note's title, a two line
// excerpt, its author and when it was last edited; a row opens the note.
// Notes come through a ListSource, and only the rows on screen draw.
import type { ActorDisplay } from '@crm/contracts/values';
import { useMemo, type ReactNode } from 'react';
import { GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
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
  /** Drawn above the list in every state ("New note"). */
  readonly toolbar?: ReactNode;
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
      <EmptyState icon="notebook" title={emptyTitle ?? strings.empty}>
        {emptyBody ?? (emptyTitle === undefined ? strings.emptyBody : undefined)}
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
    const title = note.title.trim() === '' ? strings.untitled : note.title;
    return (
      <GridListItem id={row.id} className={styles.row} textValue={title} data-pressable="">
        <RowShown index={row.index} onShown={onShown} />
        <span className={styles.title} data-untitled={note.title.trim() === '' || undefined}>
          <TruncatedText>{title}</TruncatedText>
        </span>
        {note.excerpt !== '' && (
          <span className={styles.excerpt}>
            <TruncatedText lines={2}>{note.excerpt}</TruncatedText>
          </span>
        )}
        <span className={styles.meta}>
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
            {`${strings.edited} `}
            <RelativeTime value={note.updatedAt} />
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
