import type { ReactNode } from 'react';
import { Cell, Column, Row, Table as AriaTable, TableBody, TableHeader } from 'react-aria-components';
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
}

/** Props for Table. */
export interface TableProps<T> {
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
}

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
}: TableProps<T>) {
  const showSkeleton = useDelayedLoading(isLoading);
  return (
    <AriaTable
      className={styles.root}
      aria-label={label}
      {...(onRowAction === undefined ? {} : { onRowAction: (key) => onRowAction(String(key)) })}
    >
      <TableHeader className={styles.header} columns={columns}>
        {(column) => (
          <Column
            id={column.id}
            isRowHeader={column.isRowHeader ?? false}
            className={styles.column}
            data-align={column.align ?? 'start'}
          >
            {column.isLabelHidden === true ? <VisuallyHidden>{column.label}</VisuallyHidden> : column.label}
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
          <Row id={item.id} columns={columns} className={styles.row}>
            {(column) => (
              <Cell className={styles.cell} data-align={column.align ?? 'start'}>
                {renderCell(item.row, column.id)}
              </Cell>
            )}
          </Row>
        )}
      </TableBody>
    </AriaTable>
  );
}
