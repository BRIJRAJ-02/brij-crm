// One column of the board: its option's dot, title and count, then its cards
// as a virtualised React Aria GridList that takes and gives cards by drag and
// drop, by pointer, keyboard or screen reader.
import { useId, useMemo } from 'react';
import {
  DropIndicator,
  GridList,
  GridListItem,
  ListLayout,
  useDragAndDrop,
  Virtualizer,
  type DropItem,
  type DropTarget,
  type Key,
} from 'react-aria-components';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { FieldAttribute } from '../../fields/types.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { itemOfKey, keyedRows, type KeyedRow } from '../../lib/keyed-rows.ts';
import { RowShown, useRangeReporter } from '../../lib/range-reporter.tsx';
import { sizeToken, spaceToken } from '../../lib/token-values.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './KanbanColumn.module.css';
import { KanbanCard } from './KanbanCard.tsx';
import { strings } from './strings.ts';
import type { BoardCard, BoardColumn, BoardMove } from './types.ts';

/** A card that can move, as dragged data. A locked card goes as `LOCKED_TYPE`, which no column takes. */
export const CARD_TYPE = 'application/x-crm-board-card';
const LOCKED_TYPE = 'application/x-crm-board-card-locked';

interface DraggedCard {
  readonly cardId: string;
  readonly fromColumnId: string;
}

/** A dragged card's data back as its id and column, or `undefined` for anything else carrying the type. */
function parseDragged(text: string): DraggedCard | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const { cardId, fromColumnId } = value as Record<string, unknown>;
    return typeof cardId === 'string' && typeof fromColumnId === 'string' ? { cardId, fromColumnId } : undefined;
  } catch {
    return undefined;
  }
}

/** Props for KanbanColumn. */
export interface KanbanColumnProps {
  readonly column: BoardColumn;
  readonly fields: readonly FieldAttribute[];
  readonly canMove: boolean;
  readonly isReorderable: boolean;
  /** The column a card is being dragged from, while one is. */
  readonly draggingFrom: string | undefined;
  readonly onDragChange: (fromColumnId: string | undefined) => void;
  readonly onMove: (move: BoardMove) => void;
  readonly onOpen?: (card: BoardCard) => void;
}

/** Reads each dropped card (skipping anything else) and hands it on. */
async function dropAll(items: readonly DropItem[], onCard: (dragged: DraggedCard) => void): Promise<void> {
  for (const item of items) {
    if (item.kind !== 'text' || !item.types.has(CARD_TYPE)) continue;
    const dragged = parseDragged(await item.getText(CARD_TYPE));
    if (dragged !== undefined) onCard(dragged);
  }
}

/** The card a drop lands before: the target itself, or the one after it. */
function beforeCardOf(column: BoardColumn, rows: readonly KeyedRow[], target: DropTarget): string | undefined {
  if (target.type !== 'item') return undefined;
  const row = rows.find((each) => each.id === String(target.key));
  if (row === undefined) return undefined;
  const card = column.cards.getItem(row.index + (target.dropPosition === 'after' ? 1 : 0));
  return card === undefined ? undefined : column.cards.getKey(card);
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
  onDragChange,
  onMove,
  onOpen,
}: KanbanColumnProps) {
  const { locale } = useFormatSettings();
  const onShown = useRangeReporter(column.cards);
  const rows = useMemo(() => keyedRows(column.cards), [column.cards]);
  const number = memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(column.count);
  const plural = memoIntl(`plural:${locale}`, () => new Intl.PluralRules(locale)).select(column.count);
  const isArchived = column.isArchived === true;

  const cardAt = (key: Key) => itemOfKey(column.cards, rows, key);
  const { dragAndDropHooks } = useDragAndDrop({
    isDisabled: !canMove,
    getItems: (keys) =>
      [...keys].flatMap((key) => {
        const card = cardAt(key);
        if (card === undefined) return [];
        const data = JSON.stringify({ cardId: column.cards.getKey(card), fromColumnId: column.id });
        return [
          { [card.readOnlyReason === undefined ? CARD_TYPE : LOCKED_TYPE]: data, 'text/plain': card.record.name },
        ];
      }),
    acceptedDragTypes: [CARD_TYPE],
    getDropOperation: (target) => {
      if (isArchived) return 'cancel';
      // Between cards only where order means something; otherwise the column as a whole.
      if (target.type === 'item' && !isReorderable) return 'cancel';
      if (draggingFrom === column.id && !isReorderable) return 'cancel';
      return 'move';
    },
    onDragStart: () => {
      onDragChange(column.id);
    },
    onDragEnd: () => {
      onDragChange(undefined);
    },
    onRootDrop: (event) => {
      void dropAll(event.items, (dragged) => {
        onMove({ ...dragged, toColumnId: column.id });
      });
    },
    onInsert: (event) => {
      const beforeCardId = beforeCardOf(column, rows, event.target);
      void dropAll(event.items, (dragged) => {
        onMove({ ...dragged, toColumnId: column.id, ...(beforeCardId === undefined ? {} : { beforeCardId }) });
      });
    },
    ...(isReorderable
      ? {
          onReorder: (event) => {
            const beforeCardId = beforeCardOf(column, rows, event.target);
            for (const key of event.keys) {
              const card = cardAt(key);
              if (card === undefined) continue;
              onMove({
                cardId: column.cards.getKey(card),
                fromColumnId: column.id,
                toColumnId: column.id,
                ...(beforeCardId === undefined ? {} : { beforeCardId }),
              });
            }
          },
        }
      : {}),
    renderDropIndicator: (target) => <DropIndicator target={target} className={styles.indicator} />,
  });

  const titleId = useId();
  return (
    <section
      className={styles.root}
      aria-labelledby={titleId}
      data-archived={isArchived || undefined}
      data-refusing={(isArchived && draggingFrom !== undefined) || undefined}
      // A locked card never starts a drag: its native drag is cancelled before React Aria sees it.
      onDragStartCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-locked]') !== null) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <h3 id={titleId} className={styles.head}>
        {column.hue === undefined ? (
          <span className={styles.title}>{column.title}</span>
        ) : (
          <StatusDot hue={column.hue} isArchived={isArchived}>
            {column.title}
          </StatusDot>
        )}
        <span className={styles.count} aria-label={strings.cards(number, plural)}>
          {number}
        </span>
      </h3>
      {isArchived && draggingFrom !== undefined && <p className={styles.refusal}>{strings.archivedRefuses}</p>}
      <Virtualizer
        layout={ListLayout}
        layoutOptions={{ estimatedRowHeight: 3 * sizeToken('size-row'), gap: spaceToken('space-8') }}
      >
        <GridList
          className={styles.cards}
          aria-labelledby={titleId}
          items={rows}
          dependencies={[column.cards, fields, canMove]}
          dragAndDropHooks={dragAndDropHooks}
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
                <GridListItem className={styles.card} textValue="" isDisabled>
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
                data-locked={card.readOnlyReason === undefined ? undefined : ''}
              >
                <RowShown index={row.index} onShown={onShown} />
                <KanbanCard card={card} fields={fields} canMove={canMove} />
              </GridListItem>
            );
          }}
        </GridList>
      </Virtualizer>
    </section>
  );
}
