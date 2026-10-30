// The board (spec 0003, the board): a row of columns, one per option of the
// grouping attribute, whose cards move between columns by drag and drop.
import { useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { FieldAttribute } from '../../fields/types.ts';
import { DragArea, type DragDrop, type DragWords } from '../../lib/drag/drag.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './Board.module.css';
import { KanbanCardOverlay, KanbanColumn, refusalOf } from './KanbanColumn.tsx';
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
  /**
   * The "+" on each column's head: add a record with that column's value. Leave it out where the viewer may not
   * create; a collapsed strip and a column that refuses cards show no "+".
   */
  readonly onAddCard?: (columnId: string) => void;
  /** A card was picked up (true) or dropped or put back (false): the screen holds its columns still meanwhile. */
  readonly onMovingChange?: (isMoving: boolean) => void;
  /** `loading` (skeleton columns after the loading delay), `error`, or `no-access`. */
  readonly status?: LoadStatus;
  /** Try again, when `status` is `error`. */
  readonly onRetry?: () => void;
}

/** A loaded card and its column, by the card's key. */
function findCard(columns: readonly BoardColumn[], id: string): { card: BoardCard; column: BoardColumn } | undefined {
  for (const column of columns) {
    for (let index = 0; index < column.cards.count; index += 1) {
      const card = column.cards.getItem(index);
      if (card !== undefined && column.cards.getKey(card) === id) return { card, column };
    }
  }
  return undefined;
}

/** The key of the card after `id` in its column, if one is loaded. */
function cardAfter(column: BoardColumn, id: string): string | undefined {
  for (let index = 0; index < column.cards.count; index += 1) {
    const card = column.cards.getItem(index);
    if (card === undefined || column.cards.getKey(card) !== id) continue;
    const next = column.cards.getItem(index + 1);
    return next === undefined ? undefined : column.cards.getKey(next);
  }
  return undefined;
}

/**
 * A board: a column per option, each a list of cards. Cards move between
 * columns through the library's drag wrapper (dnd-kit): by pointer from
 * anywhere on a card, the card lifting and following it, or by keyboard on a
 * card's grip (Space or Enter picks it up, the arrows move it between columns
 * and, on a reorderable board, between cards, Space or Enter drops it, Escape
 * puts it back), each step said to screen readers, and focus comes back to
 * the card where it landed. Archived columns show only while they hold cards and never
 * take one. Empty columns hide behind "N hidden columns", and come back as
 * drop targets while a card is moving.
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
  onAddCard,
  onMovingChange,
  status = 'ready',
  onRetry,
}: BoardProps) {
  const { locale } = useFormatSettings();
  const showSkeleton = useDelayedLoading(status === 'loading');
  const [draggingFrom, setDraggingFrom] = useState<string | undefined>(undefined);
  // The column a moving card is over (itself or one of its cards): told once per change, not per frame.
  const [overGroup, setOverGroup] = useState<string | undefined>(undefined);
  // Columns that have held cards while this board is up: a strip that filled never snaps shut under the pointer.
  const [hasHeld, setHasHeld] = useState<ReadonlySet<string>>(() => new Set());
  const holding = columns.filter((column) => column.count > 0 && !hasHeld.has(column.id));
  if (holding.length > 0) setHasHeld(new Set([...hasHeld, ...holding.map((column) => column.id)]));
  // A press that ends a drag never opens the card it dropped.
  const isMovingRef = useRef(false);
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
  const titleOf = (id: string | undefined) => columns.find((column) => column.id === id)?.title ?? '';
  const nameOf = (id: string) => findCard(columns, id)?.card.record.name ?? id;
  const words: DragWords = {
    lifted: (id) => strings.lifted(nameOf(id), titleOf(findCard(columns, id)?.column.id)),
    // A column that takes no card is never a target, so it is never said to be one.
    over: (id, drop) => (drop?.overGroup === undefined ? undefined : strings.over(nameOf(id), titleOf(drop.overGroup))),
    dropped: (id, drop) => {
      const column = columns.find((each) => each.id === drop?.overGroup);
      return column === undefined || refusalOf(column) !== undefined
        ? strings.putBack(nameOf(id))
        : strings.dropped(nameOf(id), column.title);
    },
    cancelled: (id) => strings.putBack(nameOf(id)),
    moving: (id) => strings.moving(nameOf(id)),
  };
  const drop = (dropped: DragDrop) => {
    const { id, fromGroup, overGroup } = dropped;
    const column = columns.find((each) => each.id === overGroup);
    if (fromGroup === undefined || column === undefined || refusalOf(column) !== undefined) return;
    const isSame = fromGroup === column.id;
    // Between cards only where order means something; otherwise the column as a whole.
    let beforeCardId: string | undefined;
    if (isReorderable && !dropped.overIsZone && dropped.overId !== undefined && dropped.overId !== id) {
      const keys = Array.from({ length: column.cards.count }, (_, index) => {
        const card = column.cards.getItem(index);
        return card === undefined ? undefined : column.cards.getKey(card);
      });
      // In its own column the card lands where the others made room: after the target when moving down.
      const side = isSame ? (keys.indexOf(id) < keys.indexOf(dropped.overId) ? 'after' : 'before') : dropped.side;
      beforeCardId = side === 'before' ? dropped.overId : cardAfter(column, dropped.overId);
    }
    if (isSame && (!isReorderable || dropped.overIsZone || dropped.overId === id)) return;
    onMove({
      cardId: id,
      fromColumnId: fromGroup,
      toColumnId: column.id,
      ...(beforeCardId === undefined ? {} : { beforeCardId }),
    });
  };
  return (
    <DragArea
      words={words}
      collision="items-first"
      focusAfter="row"
      onOver={(over) => {
        setOverGroup(over?.overGroup);
      }}
      onDrop={drop}
      onLift={(_, group) => {
        isMovingRef.current = true;
        setDraggingFrom(group);
        onMovingChange?.(true);
      }}
      onEnd={() => {
        setDraggingFrom(undefined);
        setOverGroup(undefined);
        onMovingChange?.(false);
        // The press that ended the drag lands first; open again after it.
        requestAnimationFrame(() => {
          isMovingRef.current = false;
        });
      }}
      overlay={(id) => {
        const found = findCard(columns, id);
        return found === undefined ? null : <KanbanCardOverlay card={found.card} fields={cardFields} />;
      }}
    >
      <div className={styles.root} role="group" aria-label={label}>
        {visible.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            fields={cardFields}
            canMove={!isReadOnly}
            isReorderable={isReorderable}
            draggingFrom={draggingFrom}
            isOver={overGroup === column.id}
            // A strip stays a strip while a card moves (it takes the drop as it is, so no column shifts under the
            // pointer), and one that has held cards on this board stays wide when its last card leaves.
            isCollapsed={column.isCollapsedWhenEmpty === true && column.count === 0 && !hasHeld.has(column.id)}
            {...(onAddCard === undefined || isMoving ? {} : { onAddCard: () => onAddCard(column.id) })}
            {...(onOpen === undefined
              ? {}
              : {
                  onOpen: (card: BoardCard) => {
                    if (!isMovingRef.current) onOpen(card);
                  },
                })}
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
    </DragArea>
  );
}
