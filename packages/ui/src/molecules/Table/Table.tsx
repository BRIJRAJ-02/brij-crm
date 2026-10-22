import { useContext, type ReactNode } from 'react';
import { Cell, Column, Row, Table as AriaTable, TableBody, TableHeader, type Key } from 'react-aria-components';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';
import { PageEdge } from '../../lib/page-edge.ts';
import { useScrollEdges } from '../../lib/scroll-edges.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { strings } from './strings.ts';
import styles from './Table.module.css';

/** One column. */
export interface TableColumn {
  readonly id: string;
  readonly label: string;
  /** The column that names each row (a member's name). Exactly one should. */
  readonly isRowHeader?: boolean;
  /** `end` for numbers and actions. */
  readonly align?: 'start' | 'end';
  /** Keeps the label for screen readers only (an actions column). */
  readonly isLabelHidden?: boolean;
  /**
   * Lays the cell out as one line of pieces `space-6` apart, centred: a tile
   * or a type icon before a name, several badges side by side.
   */
  readonly isInline?: boolean;
  /** Help beside the label, an InfoTip, where the header alone isn't clear (what each role may do). */
  readonly info?: ReactNode;
  /**
   * `fit` shrinks the column to its widest content (its label, a checkbox), so columns of controls keep one width
   * from table to table; `fill` takes the room the rest leave and lets its text truncate (TruncatedText) rather
   * than widen the table. Left out, the browser shares the width as usual.
   */
  readonly size?: 'fit' | 'fill';
  /**
   * The cell's content shows only while its row is hovered or holds focus (or its menu is open), so a list of
   * calendars isn't a column of identical buttons; always shown on touch, where nothing hovers.
   */
  readonly showsOnHover?: boolean;
}

/** Rows that can be moved, and each one's name for its handle; or neither. */
type Reorder<T> =
  | {
      /**
       * Rows can be moved (objects in settings): each row starts with a
       * DragHandle, and a drop calls this with the moved row's id, the row it
       * landed by, and on which side. Moving by keyboard is the handle's
       * (Enter, the arrows, Enter). Without it nothing can be dragged.
       */
      readonly onReorder: (id: string, targetId: string, position: 'before' | 'after') => void;
      /** Names each row's handle for screen readers ("Move Projects"). */
      readonly getRowLabel: (row: T) => string;
    }
  | { readonly onReorder?: undefined; readonly getRowLabel?: undefined };

/** Props for Table. */
export type TableProps<T> = TableBase<T> & Reorder<T>;

/** What every Table takes. */
interface TableBase<T> {
  /** What the table lists ("Members"). */
  readonly label: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly T[];
  readonly getRowId: (row: T) => string;
  /** What a cell shows: text, a chip, a badge, row actions. */
  readonly renderCell: (row: T, columnId: string) => ReactNode;
  /** Called when a row is opened (Enter, or a click). */
  readonly onRowAction?: (id: string) => void;
  /** Shows skeleton rows while the first rows load. */
  readonly isLoading?: boolean;
  /** What it shows with no rows: usually an EmptyState. */
  readonly emptyState?: ReactNode;
  /**
   * Rows picked for a bulk action: a leading column of checkboxes, with one in
   * the header for every row. Give it with `onSelectedChange` and
   * `getSelectLabel` (each checkbox's name, "Select Ada Lovelace").
   */
  readonly selected?: ReadonlySet<string>;
  readonly onSelectedChange?: (ids: ReadonlySet<string>) => void;
  readonly getSelectLabel?: (row: T) => string;
  /** Keeps the header in view while the page scrolls under it (a long list on its own page). */
  readonly isHeaderSticky?: boolean;
  /**
   * Keeps every column at its own width and lets the frame scroll sideways when they don't fit (a dialog, a
   * wide report), rather than squeezing them; the cells stay reachable by the arrow keys. Not with
   * `isHeaderSticky`, whose header sticks to the page.
   */
  readonly isScrollable?: boolean;
}

/** The handle column's id, kept apart from any column the caller names. */
const HANDLE = '__handle';

/** The selection column's id. */
const SELECT = '__select';

const SKELETON_ROWS = 3;

/**
 * A small, non virtual list in rows and columns: members, API keys, invoices,
 * webhooks. Built on React Aria's Table, so the arrow keys move between cells.
 * Records use DataGrid instead, which never holds every row.
 */
export function Table<T>({
  label,
  columns,
  rows,
  getRowId,
  renderCell,
  onRowAction,
  isLoading = false,
  emptyState,
  onReorder,
  getRowLabel,
  selected,
  onSelectedChange,
  getSelectLabel,
  isHeaderSticky = false,
  isScrollable = false,
}: TableProps<T>) {
  const isSelectable = selected !== undefined && onSelectedChange !== undefined;
  // A scrollable frame fades the end that hides columns, so it shows there is more to scroll to.
  const scrolls = isScrollable && !isHeaderSticky;
  const { edges, ref: frameRef } = useScrollEdges(scrolls);
  const fade = edges.start ? (edges.end ? 'both' : 'start') : edges.end ? 'end' : undefined;
  const ids = rows.map(getRowId);
  const showSkeleton = useDelayedLoading(isLoading);
  // Directly in a settings page's body the rows run out into the page's gutter, the first column's text on the
  // content edge, and a row's handle sits in that gutter, inside its first cell, rather than in a column of its own.
  const atPageEdge = useContext(PageEdge);
  // A table that also selects keeps the handle column: its checkboxes take the first cell's place.
  const handleInGutter = atPageEdge && onReorder !== undefined && !isSelectable;
  const firstColumnId = columns[0]?.id;
  const lead: TableColumn[] = [
    ...(onReorder === undefined || handleInGutter ? [] : [{ id: HANDLE, label: strings.reorder, isLabelHidden: true }]),
    ...(isSelectable ? [{ id: SELECT, label: strings.selection, isLabelHidden: true }] : []),
  ];
  const shown: readonly TableColumn[] = [...lead, ...columns];
  // The frame scrolls a table wider than its slot sideways on its own (a phone), never the page around it.
  // A sticky header sticks to the page's scroll, so its frame lets the table run on instead.
  const table = (
    <AriaTable
      className={styles.root}
      aria-label={label}
      {...(onRowAction === undefined ? {} : { onRowAction: (key) => onRowAction(String(key)) })}
      {...(isSelectable
        ? {
            selectionMode: 'multiple' as const,
            selectionBehavior: 'toggle' as const,
            selectedKeys: selected,
            onSelectionChange: (keys: 'all' | Set<Key>) => {
              onSelectedChange(keys === 'all' ? new Set(ids) : new Set([...keys].map(String)));
            },
          }
        : {})}
    >
      <TableHeader className={styles.header} columns={shown}>
        {(column) => (
          <Column
            id={column.id}
            isRowHeader={column.isRowHeader ?? false}
            className={styles.column}
            // The header's name is its label alone, never its help's button too.
            textValue={column.label}
            {...(column.info === undefined ? {} : { 'aria-label': column.label })}
            data-align={column.align ?? 'start'}
            data-size={column.size}
            data-handle={column.id === HANDLE || column.id === SELECT || undefined}
            data-sticky={isHeaderSticky || undefined}
          >
            {column.id === SELECT ? (
              <Checkbox slot="selection" label={strings.selectAll} isLabelHidden />
            ) : column.isLabelHidden === true ? (
              <VisuallyHidden>{column.label}</VisuallyHidden>
            ) : column.info === undefined ? (
              column.label
            ) : (
              <span className={styles.columnLabel}>
                {column.label}
                {column.info}
              </span>
            )}
          </Column>
        )}
      </TableHeader>
      <TableBody
        className={styles.body}
        items={showSkeleton ? [] : rows.map((row) => ({ id: getRowId(row), row }))}
        renderEmptyState={() =>
          showSkeleton ? (
            <span className={styles.loading}>
              <VisuallyHidden>{strings.loading}</VisuallyHidden>
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton key={index} width={index === SKELETON_ROWS - 1 ? 'medium' : 'full'} />
              ))}
            </span>
          ) : (
            emptyState
          )
        }
      >
        {(item) => (
          <Row
            id={item.id}
            columns={shown}
            className={styles.row}
            data-pressable={onRowAction === undefined ? undefined : ''}
          >
            {(column) =>
              column.id === HANDLE ? (
                <Cell className={styles.cell} data-handle>
                  <SortableRowGrip id={item.id} label={strings.move(getRowLabel?.(item.row) ?? item.id)} />
                </Cell>
              ) : column.id === SELECT ? (
                <Cell className={styles.cell} data-handle>
                  <Checkbox
                    slot="selection"
                    label={strings.select(getSelectLabel?.(item.row) ?? item.id)}
                    isLabelHidden
                  />
                </Cell>
              ) : (
                <Cell
                  className={styles.cell}
                  data-align={column.align ?? 'start'}
                  data-size={column.size}
                  data-gutter-handle={(handleInGutter && column.id === firstColumnId) || undefined}
                >
                  {handleInGutter && column.id === firstColumnId && (
                    <span className={styles.gutter}>
                      <SortableRowGrip id={item.id} label={strings.move(getRowLabel(item.row))} reach="end" />
                    </span>
                  )}
                  {column.showsOnHover === true ? (
                    <span className={styles.reveal}>{renderCell(item.row, column.id)}</span>
                  ) : column.isInline === true ? (
                    <span className={styles.inline}>{renderCell(item.row, column.id)}</span>
                  ) : (
                    renderCell(item.row, column.id)
                  )}
                </Cell>
              )
            }
          </Row>
        )}
      </TableBody>
    </AriaTable>
  );
  return (
    <div
      ref={frameRef}
      className={styles.frame}
      data-sticky={isHeaderSticky || undefined}
      data-scrollable={scrolls || undefined}
      data-fade={fade}
      data-edge={atPageEdge ? 'page' : undefined}
    >
      {onReorder === undefined ? (
        table
      ) : (
        <SortableList
          ids={ids}
          nameOf={(id) => {
            const row = rows.find((each) => getRowId(each) === id);
            return row === undefined ? id : getRowLabel(row);
          }}
          onMove={(move) => {
            onReorder(move.id, move.targetId, move.position);
          }}
        >
          {table}
        </SortableList>
      )}
    </div>
  );
}
