import type { ReactNode } from 'react';
import {
  Cell,
  Column,
  DropIndicator,
  Row,
  Table as AriaTable,
  TableBody,
  TableHeader,
  useDragAndDrop,
  type Key,
} from 'react-aria-components';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
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
   * Scrolls sideways inside its own box when its columns don't fit (a phone, a dialog), rather than cutting them
   * off; the cells stay reachable by the arrow keys, which scroll each into view. Not with `isHeaderSticky`, whose
   * header sticks to the page.
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
  const ids = rows.map(getRowId);
  const showSkeleton = useDelayedLoading(isLoading);
  const { dragAndDropHooks } = useDragAndDrop({
    isDisabled: onReorder === undefined,
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder: (event) => {
      const [moved] = [...event.keys].map(String);
      if (moved === undefined || onReorder === undefined) return;
      onReorder(moved, String(event.target.key), event.target.dropPosition === 'after' ? 'after' : 'before');
    },
    // Where the row would land: an accent line between rows, for a pointer and for the keyboard alike.
    renderDropIndicator: (target) => <DropIndicator target={target} className={styles.dropLine} />,
  });
  const lead: TableColumn[] = [
    ...(onReorder === undefined ? [] : [{ id: HANDLE, label: strings.reorder, isLabelHidden: true }]),
    ...(isSelectable ? [{ id: SELECT, label: strings.selection, isLabelHidden: true }] : []),
  ];
  const shown: readonly TableColumn[] = [...lead, ...columns];
  const table = (
    <AriaTable
      className={styles.root}
      aria-label={label}
      {...(onRowAction === undefined ? {} : { onRowAction: (key) => onRowAction(String(key)) })}
      {...(onReorder === undefined ? {} : { dragAndDropHooks })}
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
            data-align={column.align ?? 'start'}
            data-handle={column.id === HANDLE || column.id === SELECT || undefined}
            data-sticky={isHeaderSticky || undefined}
          >
            {column.id === SELECT ? (
              <Checkbox slot="selection" label={strings.selectAll} isLabelHidden />
            ) : column.isLabelHidden === true ? (
              <VisuallyHidden>{column.label}</VisuallyHidden>
            ) : (
              column.label
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
                  <DragHandle label={strings.move(getRowLabel?.(item.row) ?? item.id)} />
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
                <Cell className={styles.cell} data-align={column.align ?? 'start'}>
                  {column.isInline === true ? (
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
  return isScrollable && !isHeaderSticky ? <div className={styles.scroll}>{table}</div> : table;
}
