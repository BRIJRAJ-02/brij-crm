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
   * than widen the table. `lead` is the column a row is read from (a person): a set share of the table, its text
   * truncating, the rest of the width left to the columns after it, so a wide screen spreads a few short facts
   * evenly instead of leaving them far from the name. `fact` is one of those columns: never narrower than
   * `size-column-narrow` however short its content, sharing what's left evenly with the other facts. Left out, the
   * browser shares the width as usual.
   */
  readonly size?: 'fit' | 'fill' | 'lead' | 'fact';
  /**
   * The cell's content shows only while its row is hovered or holds focus (or its menu is open), so a list of
   * calendars isn't a column of identical buttons; always shown on touch, where nothing hovers.
   */
  readonly showsOnHover?: boolean;
  /**
   * What the header draws in place of its label (a weekday over its date, today's in an accent circle); the label
   * stays its text value, so give the heading words that read the same (a VisuallyHidden "today" where it helps).
   */
  readonly heading?: ReactNode;
  /**
   * The column for now (today in a week): its header in the link colour on the accent's soft surface over an accent
   * line, so today stands out in both themes.
   */
  readonly isCurrent?: boolean;
  /** `quiet` tints the whole column a step off the page (a week's weekend, when few work). */
  readonly tone?: 'quiet';
  /**
   * Where the cell goes in a `phoneLayout="rows"` table on a phone: `title` on the row's first line, `meta` on its
   * second line after the others, `hidden` left out there (it still shows on a wider screen and is in the row's
   * accessible content everywhere else), `end` beside the title at the first line's end (a row's menu, with
   * `look="person"`). Left out, a cell is `meta`.
   */
  readonly phone?: 'title' | 'meta' | 'hidden' | 'end';
}

/** How a Table shares its width. */
export type TableLayout = 'auto' | 'even';

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
  /**
   * Which rows may be ticked, with `selected`: the others draw no checkbox, can't be picked by a click or a key, and
   * Select all leaves them out, while their row actions still work (an invitation among a workspace's members). Every
   * row, by default.
   */
  readonly isRowSelectable?: (row: T) => boolean;
  /** Keeps the header in view while the page scrolls under it (a long list on its own page). */
  readonly isHeaderSticky?: boolean;
  /**
   * Keeps every column at its own width and lets the frame scroll sideways when they don't fit (a dialog, a
   * wide report), rather than squeezing them; the cells stay reachable by the arrow keys. Not with
   * `isHeaderSticky`, whose header sticks to the page.
   */
  readonly isScrollable?: boolean;
  /**
   * Draws no header row, while the columns keep the widths their labels give them: a second table that continues
   * one above it (a folded "Other calendars" under the shown ones), so the headers appear once. Each cell's
   * control names itself in full ("Check Team for conflicts"), since its column header is no longer read.
   */
  readonly isHeaderHidden?: boolean;
  /**
   * `even` gives the row header column one set width (a column and room for a picture) and shares the rest evenly
   * between the others, whatever their content, so a week's seven days line up as equals; with `isScrollable`,
   * each keeps at least `size-column-min` and the frame scrolls on a phone. `auto` (the default) lets the browser
   * share the width by content.
   */
  readonly layout?: TableLayout;
  /** A row's look: `total` sets a row of sums apart (a hairline in the control edge above it, no hover). */
  readonly getRowTone?: (row: T) => 'total' | undefined;
  /**
   * `rows`: below 480px of the frame (a phone) each row reads as two lines, its `title` column over its `meta`
   * columns, with no header row and nothing to scroll sideways (a form's submissions, as Mail and Linear list on a
   * phone). `table` (the default) keeps the columns, scrolling with `isScrollable`.
   */
  readonly phoneLayout?: 'table' | 'rows';
  /**
   * `page` runs the rows out through a page's `space-16` gutter to its edges, the first and last columns' text on
   * the content edges, as a settings page's body does by itself (PageEdge): for a table directly in another page's
   * body, such as a form editor's Submissions tab, whose text then lines up with the tabs above it. `card` is a table
   * filling a flush Card: its first and last columns keep the Card's `space-16` gutter and the last row gives its
   * hairline up to the Card's edge.
   */
  readonly edge?: 'page' | 'card';
  /**
   * `person` is a list read by the person each row leads with (PersonLine at `size="lg"`, Settings › Members): rows
   * tall enough for a picture and two lines with room to breathe, and on a phone a row's second line under the name.
   */
  readonly look?: 'default' | 'person';
  /**
   * With `selected`: the checkboxes wait until the pointer is on the table, focus is in it or something is ticked, so
   * a list read far more than it is bulk changed stays calm; the column keeps its place, so nothing moves. Always
   * shown where nothing hovers.
   */
  readonly isSelectionQuiet?: boolean;
  /** A quiet band under the rows, as the records grid's footer: how many there are ("12 submissions"). */
  readonly footer?: ReactNode;
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
  isRowSelectable,
  isHeaderSticky = false,
  isScrollable = false,
  isHeaderHidden = false,
  layout = 'auto',
  getRowTone,
  phoneLayout = 'table',
  edge,
  look = 'default',
  isSelectionQuiet = false,
  footer,
}: TableProps<T>) {
  const isSelectable = selected !== undefined && onSelectedChange !== undefined;
  // A scrollable frame fades the end that hides columns, so it shows there is more to scroll to.
  const scrolls = isScrollable && !isHeaderSticky;
  const { edges, ref: frameRef } = useScrollEdges(scrolls);
  const fade = edges.start ? (edges.end ? 'both' : 'start') : edges.end ? 'end' : undefined;
  const ids = rows.map(getRowId);
  // The rows that can't be ticked (isRowSelectable): disabled for selection alone, so their row actions still work.
  const unselectable = new Set(
    isSelectable && isRowSelectable !== undefined ? rows.filter((row) => !isRowSelectable(row)).map(getRowId) : [],
  );
  const showSkeleton = useDelayedLoading(isLoading);
  // Directly in a settings page's body the rows run out into the page's gutter, the first column's text on the
  // content edge, and a row's handle sits in that gutter, inside its first cell, rather than in a column of its own.
  const atPageEdge = useContext(PageEdge) || edge === 'page';
  const frameEdge = atPageEdge ? 'page' : edge === 'card' ? 'card' : undefined;
  // A table that also selects keeps the handle column: its checkboxes take the first cell's place.
  const handleInGutter = atPageEdge && onReorder !== undefined && !isSelectable;
  const firstColumnId = columns[0]?.id;
  const lead: TableColumn[] = [
    ...(onReorder === undefined || handleInGutter ? [] : [{ id: HANDLE, label: strings.reorder, isLabelHidden: true }]),
    ...(isSelectable ? [{ id: SELECT, label: strings.selection, isLabelHidden: true }] : []),
  ];
  const shown: readonly TableColumn[] = [...lead, ...columns];
  const isPerson = look === 'person';
  const isCardEdge = frameEdge === 'card';
  /** Where a column stands in a flush Card: at its gutters, or straight after a checkbox's column, which is a gutter. */
  const cardEdgeOf = (id: string): 'start' | 'end' | 'after-select' | undefined => {
    if (!isCardEdge) return undefined;
    const index = shown.findIndex((each) => each.id === id);
    if (index === shown.length - 1) return 'end';
    if (index === 0 && id !== SELECT) return 'start';
    return shown[index - 1]?.id === SELECT ? 'after-select' : undefined;
  };
  // A phone's second line starts under the name: the first cell that goes on it.
  const firstMeta = shown.find(
    (each) => each.id !== SELECT && each.id !== HANDLE && (each.phone ?? 'meta') === 'meta',
  )?.id;
  const lastRowId = ids.at(-1);
  // A quiet selection's checkboxes, in the span that fades them.
  const quietly = (box: ReactNode) => (isSelectionQuiet ? <span className={styles.selection}>{box}</span> : box);
  // The frame scrolls a table wider than its slot sideways on its own (a phone), never the page around it.
  // A sticky header sticks to the page's scroll, so its frame lets the table run on instead.
  const table = (
    <AriaTable
      className={styles.root}
      aria-label={label}
      data-layout={layout === 'even' ? 'even' : undefined}
      data-phone={phoneLayout === 'rows' ? 'rows' : undefined}
      data-edge={frameEdge}
      data-look={look === 'default' ? undefined : look}
      data-selection={isSelectable && isSelectionQuiet ? (selected.size > 0 ? 'ticked' : 'quiet') : undefined}
      {...(onRowAction === undefined ? {} : { onRowAction: (key) => onRowAction(String(key)) })}
      {...(isSelectable
        ? {
            selectionMode: 'multiple' as const,
            selectionBehavior: 'toggle' as const,
            selectedKeys: selected,
            disabledKeys: unselectable,
            disabledBehavior: 'selection' as const,
            onSelectionChange: (keys: 'all' | Set<Key>) => {
              onSelectedChange(
                keys === 'all' ? new Set(ids.filter((id) => !unselectable.has(id))) : new Set([...keys].map(String)),
              );
            },
          }
        : {})}
    >
      <TableHeader
        className={styles.header}
        columns={shown}
        data-hidden={isHeaderHidden || undefined}
        data-quiet={(isSelectable && isSelectionQuiet) || undefined}
        // Its cells say where they stand, and React Aria keeps a column's render while the column object is the same.
        dependencies={[isSelectable, isSelectionQuiet, isCardEdge]}
      >
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
            data-select={column.id === SELECT || undefined}
            data-sticky={isHeaderSticky || undefined}
            data-lead={(layout === 'even' && column.isRowHeader === true) || undefined}
            data-current={column.isCurrent === true || undefined}
            data-tone={column.tone}
            data-card={isCardEdge || undefined}
            data-card-edge={cardEdgeOf(column.id)}
          >
            {column.id === SELECT ? (
              quietly(<Checkbox slot="selection" label={strings.selectAll} isLabelHidden />)
            ) : column.isLabelHidden === true ? (
              <VisuallyHidden>{column.label}</VisuallyHidden>
            ) : column.heading !== undefined ? (
              <span className={styles.columnLabel}>{column.heading}</span>
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
            <span className={styles.loading} data-look={look === 'default' ? undefined : look}>
              <VisuallyHidden>{strings.loading}</VisuallyHidden>
              {Array.from({ length: SKELETON_ROWS }, (_, index) =>
                look === 'person' ? (
                  // A person's own row: their picture beside two lines, a row's height.
                  <span key={index} className={styles.loadingPerson}>
                    <Skeleton shape="circle" size="lg" />
                    <span className={styles.loadingLines}>
                      <Skeleton width="long" />
                      <Skeleton width="medium" />
                    </span>
                  </span>
                ) : (
                  <Skeleton key={index} width={index === SKELETON_ROWS - 1 ? 'medium' : 'full'} />
                ),
              )}
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
            data-tone={getRowTone?.(item.row)}
            data-look={isPerson ? look : undefined}
            data-card={isCardEdge || undefined}
            data-last-row={(isCardEdge && item.id === lastRowId) || undefined}
          >
            {(column) =>
              column.id === HANDLE ? (
                <Cell className={styles.cell} data-handle>
                  <SortableRowGrip id={item.id} label={strings.move(getRowLabel?.(item.row) ?? item.id)} />
                </Cell>
              ) : column.id === SELECT ? (
                <Cell
                  className={styles.cell}
                  data-handle
                  data-select
                  data-look={isPerson ? look : undefined}
                  data-card={isCardEdge || undefined}
                  data-last-row={(isCardEdge && item.id === lastRowId) || undefined}
                >
                  {!unselectable.has(item.id) &&
                    quietly(
                      <Checkbox
                        slot="selection"
                        label={strings.select(getSelectLabel?.(item.row) ?? item.id)}
                        isLabelHidden
                      />,
                    )}
                </Cell>
              ) : (
                <Cell
                  className={styles.cell}
                  data-align={column.align ?? 'start'}
                  data-size={column.size}
                  data-tone={column.tone}
                  data-row-tone={getRowTone?.(item.row)}
                  data-lead={(layout === 'even' && column.isRowHeader === true) || undefined}
                  data-gutter-handle={(handleInGutter && column.id === firstColumnId) || undefined}
                  data-phone={phoneLayout === 'rows' ? (column.phone ?? 'meta') : undefined}
                  data-look={isPerson ? look : undefined}
                  data-card-edge={cardEdgeOf(column.id)}
                  data-last-row={(isCardEdge && item.id === lastRowId) || undefined}
                  data-phone-first={(isPerson && phoneLayout === 'rows' && column.id === firstMeta) || undefined}
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
  const framed = (
    <div
      ref={frameRef}
      className={styles.frame}
      data-sticky={isHeaderSticky || undefined}
      data-scrollable={scrolls || undefined}
      data-fade={fade}
      data-edge={frameEdge}
      data-layout={layout === 'even' ? 'even' : undefined}
      data-phone={phoneLayout === 'rows' ? 'rows' : undefined}
      // How many columns share the width evenly, so an even table's least width holds each at size-column-min.
      style={{ '--table-shared': String(shown.filter((each) => each.isRowHeader !== true).length) }}
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
  if (footer === undefined) return framed;
  return (
    <div className={styles.withFoot} data-edge={frameEdge}>
      {framed}
      <div className={styles.foot}>{footer}</div>
    </div>
  );
}
