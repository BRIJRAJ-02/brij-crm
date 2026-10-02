// The board (spec 0003, the board): a row of columns, one per option of the
// grouping attribute, whose cards move between columns by drag and drop.
import { useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { FieldAttribute } from '../../fields/types.ts';
import { focusLater } from '../../lib/focus-later.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './Board.module.css';
import { KanbanColumn } from './KanbanColumn.tsx';
import { strings } from './strings.ts';
import type { BoardCard, BoardColumn, BoardMove } from './types.ts';

/** Props for Board. */
export interface BoardProps {
  /** The board's name ("Deals by stage"). */
  readonly label: string;
  readonly columns: readonly BoardColumn[];
  /** Which fields each card shows, in order (the view's card fields). */
  readonly cardFields: readonly FieldAttribute[];
  /** A card moved. The data layer writes the grouping attribute, optimistically. */
  readonly onMove: (move: BoardMove) => void;
  /** Cards can move within a column too, and moves say which card they now sit before. Off by default. */
  readonly isReorderable?: boolean;
  /** The grouping attribute is read only, so no card moves. */
  readonly isReadOnly?: boolean;
  readonly showEmptyColumns: boolean;
  readonly onShowEmptyColumnsChange?: (show: boolean) => void;
  /** Enter or a click on a card: open its record. */
  readonly onOpen?: (card: BoardCard) => void;
  /** `loading` (skeleton columns after the loading delay), `error`, or `no-access`. */
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
}

/**
 * A board: a column per option, each a list of cards. Cards move between
 * columns by pointer, or by keyboard and screen reader through React Aria's
 * drag and drop (Enter on a card's handle picks it up and lands on the first
 * column that takes it, Tab moves on, Enter drops it, and focus follows the
 * card). Archived columns show only while they hold cards and never take one.
 * Empty columns hide behind "N hidden columns", and come back as drop targets
 * while a card is moving.
 */
export function Board({
  label,
  columns,
  cardFields,
  onMove,
  isReorderable = false,
  isReadOnly = false,
  showEmptyColumns,
  onShowEmptyColumnsChange,
  onOpen,
  status = 'ready',
  onRetry,
}: BoardProps) {
  const { locale } = useFormatSettings();
  const showSkeleton = useDelayedLoading(status === 'loading');
  const [draggingFrom, setDraggingFrom] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  if (status === 'error') {
    return (
      <EmptyState tone="error" icon="kanban" title={strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />
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
          [0, 1, 2].map((column) => (
            <div key={column} className={styles.column}>
              <Skeleton width="short" />
              <Skeleton shape="block" />
            </div>
          ))}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  if (columns.length === 0) {
    return (
      <EmptyState icon="kanban" title={strings.noColumns}>
        {strings.noColumnsBody}
      </EmptyState>
    );
  }
  // An archived option shows only while it still has cards. Other empty columns follow the
  // setting, and show while a card is moving, so there is always somewhere to drop it.
  const isMoving = draggingFrom !== undefined;
  const visible = columns.filter((column) =>
    column.count > 0 ? true : column.isArchived !== true && (showEmptyColumns || isMoving),
  );
  const hiddenEmpty = columns.filter((column) => column.count === 0 && column.isArchived !== true).length;
  const number = memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(hiddenEmpty);
  const plural = memoIntl(`plural:${locale}`, () => new Intl.PluralRules(locale)).select(hiddenEmpty);
  const move = (next: BoardMove) => {
    onMove(next);
    // Focus follows the card to where it landed (a keyboard drop), once the drag's overlays settle.
    focusLater(() => {
      const root = rootRef.current;
      const active = document.activeElement;
      if (root === null || (active !== null && active !== document.body && !root.contains(active))) return null;
      return root.querySelector<HTMLElement>(`[role="row"][data-key="${CSS.escape(next.cardId)}"]`);
    });
  };
  return (
    <div ref={rootRef} className={styles.root} role="group" aria-label={label}>
      {visible.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          fields={cardFields}
          canMove={!isReadOnly}
          isReorderable={isReorderable}
          draggingFrom={draggingFrom}
          onDragChange={setDraggingFrom}
          onMove={move}
          {...(onOpen === undefined ? {} : { onOpen })}
        />
      ))}
      {onShowEmptyColumnsChange !== undefined && hiddenEmpty > 0 && !isMoving && (
        <span className={styles.hidden}>
          {showEmptyColumns ? (
            <Button
              variant="ghost"
              icon="eye-off"
              onPress={() => {
                onShowEmptyColumnsChange(false);
              }}
            >
              {strings.hideEmpty}
            </Button>
          ) : (
            <Button
              variant="dashed"
              icon="eye"
              onPress={() => {
                onShowEmptyColumnsChange(true);
              }}
            >
              {strings.hiddenColumns(number, plural)}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
