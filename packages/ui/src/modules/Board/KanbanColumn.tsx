// One column of the board: its option's dot, title and count, then its cards
// as a virtualised React Aria GridList. The column is a drop zone of the
// library's drag wrapper, and each card a sortable item in it, moved by
// pointer from anywhere on the card, or by keyboard from its grip.
import { useId, useMemo } from 'react';
import { GridList, GridListItem, ListLayout, Virtualizer, type Key } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { FieldAttribute } from '../../fields/types.ts';
import { SortableGroup, useDropZone, useSortableItem } from '../../lib/drag/drag.tsx';
import { useFontsSettled } from '../../lib/fonts-settled.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { itemOfKey, keyedRows, type KeyedRow } from '../../lib/keyed-rows.ts';
import { RowShown, useRangeReporter } from '../../lib/range-reporter.tsx';
import { sizeToken, spaceToken } from '../../lib/token-values.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './KanbanColumn.module.css';
import { KanbanCard } from './KanbanCard.tsx';
import { strings } from './strings.ts';
import type { BoardCard, BoardColumn } from './types.ts';

/** Why a column takes no card while one moves: its own reason, or the archived option's. */
export function refusalOf(column: BoardColumn): string | undefined {
  return column.refusesDrop?.reason ?? (column.isArchived === true ? strings.archivedRefuses : undefined);
}

/** Props for KanbanColumn. */
export interface KanbanColumnProps {
  readonly column: BoardColumn;
  readonly fields: readonly FieldAttribute[];
  readonly canMove: boolean;
  readonly isReorderable: boolean;
  /** The column a card is being dragged from, while one is. */
  readonly draggingFrom: string | undefined;
  /** A moving card is over this column or one of its cards. */
  readonly isOver: boolean;
  /** A slim strip: the title down its length and the count, no cards (an empty "No <field>" column). */
  readonly isCollapsed?: boolean;
  readonly onOpen?: (card: BoardCard) => void;
  /** The head's "+": add a card with this column's value. Absent, there is no button. */
  readonly onAddCard?: () => void;
  /** Folds the column into a strip (the head's collapse button). Absent, there is no button. */
  readonly onCollapse?: () => void;
  /** Opens a strip the viewer folded (the strip's expand button). */
  readonly onExpand?: () => void;
}

/** A card's row content: binds its row as a sortable item, and drags from anywhere on it. */
function SortableCard({
  id,
  card,
  fields,
  columnId,
  canMove,
  refusesDrop,
}: {
  readonly id: string;
  readonly card: BoardCard;
  readonly fields: readonly FieldAttribute[];
  readonly columnId: string;
  readonly canMove: boolean;
  readonly refusesDrop: boolean;
}) {
  const isLocked = card.readOnlyReason !== undefined;
  const { bind, grip, onPointerDown } = useSortableItem(id, {
    isDisabled: !canMove || isLocked,
    refusesDrop,
    group: columnId,
    within: 'row',
  });
  return (
    <span ref={bind} className={styles.content} onPointerDown={onPointerDown}>
      <KanbanCard card={card} fields={fields} grip={canMove && !isLocked ? grip : undefined} />
    </span>
  );
}

/**
 * A board column: the option's dot, its title and count, and its cards. It
 * takes cards dropped on it from other columns (and, on a reorderable board,
 * from itself, between cards). An archived column takes none, and says so
 * while a card is moving.
 */
export function KanbanColumn({
  column,
  fields,
  canMove,
  isReorderable,
  draggingFrom,
  isOver,
  isCollapsed = false,
  onOpen,
  onAddCard,
  onCollapse,
  onExpand,
}: KanbanColumnProps) {
  const { locale } = useFormatSettings();
  const onShown = useRangeReporter(column.cards);
  const rows = useMemo(() => keyedRows(column.cards), [column.cards]);
  const fontsSettled = useFontsSettled();
  const number = memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(column.count);
  const plural = memoIntl(`plural:${locale}`, () => new Intl.PluralRules(locale)).select(column.count);
  const isArchived = column.isArchived === true;
  const refusal = refusalOf(column);
  const { bind: bindZone } = useDropZone(column.id, { isDisabled: refusal !== undefined });
  // Only loaded cards sort; the rest are placeholders still on their way.
  const ids = useMemo(
    () => rows.flatMap((row) => (column.cards.getItem(row.index) === undefined ? [] : [row.id])),
    [rows, column.cards],
  );
  const cardAt = (key: Key) => itemOfKey(column.cards, rows, key);
  const titleId = useId();
  return (
    <section
      ref={bindZone}
      className={styles.root}
      aria-labelledby={titleId}
      data-archived={isArchived || undefined}
      data-refusing={(refusal !== undefined && draggingFrom !== undefined) || undefined}
      data-over={(isOver && refusal === undefined) || undefined}
      data-collapsed={isCollapsed || undefined}
    >
      <div className={styles.head}>
        {/* A strip the viewer folded opens again from its top, where the eye lands on its name. */}
        {isCollapsed && onExpand !== undefined && (
          <Button variant="ghost" icon="panel-left-open" label={strings.expand(column.title)} onPress={onExpand} />
        )}
        <h3 id={titleId} className={styles.heading}>
          {column.hue === undefined ? (
            <span className={styles.title}>{column.title}</span>
          ) : (
            <StatusDot hue={column.hue} isArchived={isArchived}>
              {column.title}
            </StatusDot>
          )}
          <span
            className={styles.count}
            aria-label={column.isCountAtLeast === true ? strings.cardsAtLeast(number) : strings.cards(number, plural)}
          >
            {column.isCountAtLeast === true ? strings.atLeast(number) : number}
          </span>
          {/* The column's total: a strip is too narrow for it. */}
          {column.total !== undefined && !isCollapsed && <span className={styles.total}>{column.total}</span>}
        </h3>
        {/* A strip is too narrow for it, and a column that refuses cards (archived, required) takes no new one. */}
        {onAddCard !== undefined && !isCollapsed && refusal === undefined && (
          <Button variant="ghost" icon="plus" label={strings.addCard(column.title)} onPress={onAddCard} />
        )}
        {/* Quiet until the head is hovered or focused (a pointer that can hover), so the "+" stays the head's action. */}
        {onCollapse !== undefined && !isCollapsed && (
          <span className={styles.collapse}>
            <Button
              variant="ghost"
              icon="panel-left-close"
              label={strings.collapse(column.title)}
              onPress={onCollapse}
            />
          </span>
        )}
      </div>
      {/* A strip is too narrow for the sentence: dimmed, it says enough, and a drop there is put back with words. */}
      {refusal !== undefined && draggingFrom !== undefined && !isCollapsed && (
        <p className={styles.refusal}>{refusal}</p>
      )}
      {/* Collapsed, it holds no card: the strip is its title and count alone. */}
      {!isCollapsed && (
        <SortableGroup ids={ids} isShifting={isReorderable && draggingFrom === column.id}>
          <Virtualizer
            layout={ListLayout}
            layoutOptions={{ estimatedRowHeight: 3 * sizeToken('size-row'), gap: spaceToken('space-8') }}
          >
            <GridList
              className={styles.cards}
              aria-labelledby={titleId}
              items={rows}
              // Fonts in: each card built, and so measured, again (a card measured in the fallback face is too short).
              dependencies={[column.cards, fields, canMove, fontsSettled, refusal]}
              renderEmptyState={() => <span className={styles.empty}>{strings.noCards}</span>}
              {...(onOpen === undefined
                ? {}
                : {
                    onAction: (key: Key) => {
                      const card = cardAt(key);
                      if (card !== undefined) onOpen(card);
                    },
                  })}
            >
              {(row: KeyedRow) => {
                const card = column.cards.getItem(row.index);
                if (card === undefined) {
                  return (
                    <GridListItem className={styles.card} textValue="" isDisabled data-loading="">
                      <RowShown index={row.index} onShown={onShown} />
                      <span className={styles.skeleton}>
                        <Skeleton width="medium" />
                        <Skeleton width="short" />
                      </span>
                    </GridListItem>
                  );
                }
                return (
                  <GridListItem
                    className={styles.card}
                    textValue={card.record.name}
                    data-pressable={onOpen === undefined ? undefined : ''}
                    data-locked={card.readOnlyReason === undefined ? undefined : ''}
                  >
                    <RowShown index={row.index} onShown={onShown} />
                    <SortableCard
                      id={column.cards.getKey(card)}
                      card={card}
                      fields={fields}
                      columnId={column.id}
                      canMove={canMove}
                      refusesDrop={refusal !== undefined}
                    />
                  </GridListItem>
                );
              }}
            </GridList>
          </Virtualizer>
        </SortableGroup>
      )}
    </section>
  );
}

/** The lifted copy of a card that follows the pointer or the keys while it moves, above everything. */
export function KanbanCardOverlay({
  card,
  fields,
}: {
  readonly card: BoardCard;
  readonly fields: readonly FieldAttribute[];
}) {
  return (
    <div className={styles.overlay}>
      <KanbanCard card={card} fields={fields} />
    </div>
  );
}
