// DataGrid: the record table (spec 0003, the data grid). TanStack Virtual
// draws only the rows (and, past 12 columns, the columns) on screen; rows come
// from outside through a RowSource; every cell renders and edits through the
// field set; the keyboard model is a spreadsheet's. AC-4, AC-7, AC-8, AC-9.
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { useFocusVisible } from 'react-aria';
import { CheckboxMark } from '../../atoms/Checkbox/Checkbox.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { AnchoredTooltip, TOOLTIP_DELAY_MS } from '../../atoms/Tooltip/Tooltip.tsx';
import { SharedTooltipContext } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { clearedValueOf, fieldTypeOf, readOnlyReasonOf } from '../../fields/registry.ts';
import type { CellChange, FieldAttribute, PhoneParser, TextContext } from '../../fields/types.ts';
import { isRefusal, toCommittable } from '../../fields/values.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import type { ListSource } from '../../lib/list-source.ts';
import { sizeToken, spaceToken } from '../../lib/token-values.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useFormatSettings, useKeyboardPlatform, useToasts } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import type { ActorDisplay } from '@crm/contracts/values';
import styles from './DataGrid.module.css';
import { editModeOf, GridCell, type CellPlace, type GridEditorProps } from './GridCell.tsx';
import { GridHeaderCell, type ColumnActions } from './GridHeaderCell.tsx';
import { fromTsv, planPaste, toTsv } from './grid-clipboard.ts';
import {
  hideColumn,
  moveColumn,
  pinColumn,
  placeColumns,
  reorderColumn,
  resizeColumn,
  unpinColumn,
  type ColumnLayout,
  type GridColumn,
  type PlacedColumn,
} from './grid-columns.ts';
import { isInRange, isPrintable, moveFocus, rangeEdges, type CellPosition, type CellRange } from './grid-keys.ts';
import { isRowSelected, noRows, selectedCount, toggleRow, withRows, type GridSelection } from './grid-selection.ts';
import { strings } from './strings.ts';

/** Rows from outside: a ListSource, plus ids for a range not loaded yet, so a shift range can span it. */
export interface RowSource<Row> extends ListSource<Row> {
  readonly resolveKeys?: (start: number, end: number) => Promise<readonly string[]>;
}

/** What the grid shows instead of rows: loading, a failed load, or no access to the view. */
export type GridStatus = 'ready' | 'loading' | 'error' | 'no-access';

/** Props for DataGrid. */
export interface DataGridProps<Row> {
  /** The grid's accessible name ("Companies"). */
  readonly label: string;
  readonly columns: readonly GridColumn[];
  /** Columns pinned from the start; at least 1, the row header. */
  readonly pinnedCount: number;
  readonly rows: RowSource<Row>;
  readonly getValue: (row: Row, columnId: string) => unknown;
  /** The display shapes (names and pictures for references, members and files). */
  readonly getDisplay?: (row: Row, columnId: string) => unknown;
  /** The column that names a row; always first. */
  readonly rowHeader: string;
  readonly selection?: GridSelection;
  readonly onSelectionChange?: (selection: GridSelection) => void;
  /** Column order, widths, pins and hiding, on release or key press, never mid drag. */
  readonly onColumnsChange?: (columns: readonly GridColumn[], pinnedCount: number) => void;
  /** One edit or clear, already valid for its type. */
  readonly onCellChange?: (change: CellChange) => void;
  /** A paste or a range clear, every change already valid. */
  readonly onCellsChange?: (changes: readonly CellChange[]) => void;
  /** Refusals from the data layer: `${rowId}:${columnId}` to a sentence. */
  readonly cellErrors?: ReadonlyMap<string, string>;
  /** Calculations by column id, computed by the screen across all matching rows. */
  readonly footer?: Readonly<Record<string, ReactNode>>;
  readonly status?: GridStatus;
  readonly onRetry?: () => void;
  readonly emptyState?: ReactNode;
  readonly onRowOpen?: (rowId: string) => void;
  /** Adds Sort to the column menu. */
  readonly onSort?: (columnId: string, direction: 'ascending' | 'descending') => void;
  /** Adds Filter to the column menu. */
  readonly onFilter?: (columnId: string) => void;
  /** Members to match pasted names and emails against. */
  readonly members?: readonly ActorDisplay[];
  /** Phone parsing for paste, once loaded (`createPhoneParser`). */
  readonly phone?: PhoneParser;
  /** What a column's reference or file editor needs: search, uploads, the signed in member. */
  readonly editorProps?: (column: GridColumn) => GridEditorProps;
  /**
   * Moves focus to this row's first cell and scrolls it into view, once any
   * closing overlay is gone: the row a screen just made. Pass a new object
   * each time; the same object again does nothing.
   */
  readonly focusRow?: { readonly index: number };
}

const ROW = sizeToken('size-row');
const HEADER = sizeToken('size-table-header');
const CHECK = sizeToken('size-column-check');
const LIMITS = { min: sizeToken('size-column-min'), max: sizeToken('size-column-max') };
const RESIZE_STEP = spaceToken('space-8');
const OVERSCAN = 8;
/** Past this many drawn columns, the unpinned ones virtualise too. */
const COLUMN_VIRTUALISE_AFTER = 12;
const LOADING_ROWS = 8;
/** Frames to wait at most for a closing overlay before moving focus to `focusRow`. */
const OVERLAY_WAIT_FRAMES = 60;
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';
const NO_EDITOR_PROPS: GridEditorProps = {};
const NO_ITEMS: readonly VirtualItem[] = [];

/** The cell being edited: where it is drawn, and the record and column it writes to. */
interface Editing {
  readonly row: number;
  readonly col: number;
  readonly rowId: string;
  readonly columnId: string;
  readonly startText?: string;
}

/** What the grid's one tooltip shows: a cell's reason, or the full text of something cut in it. */
interface Tip {
  readonly key: string;
  readonly text: string;
  readonly via: 'hover' | 'focus';
}

const keyOf = (row: number, col: number) => `${String(row)}:${String(col)}`;

/** A cell's tip: its reason (read only, or refused), else the full text of the first cut text in it. */
function tipIn(cell: HTMLElement): { readonly anchor: HTMLElement; readonly text: string } | undefined {
  const reason = cell.querySelector('[data-tip]')?.textContent ?? '';
  if (reason !== '') return { anchor: cell, text: reason };
  for (const text of cell.querySelectorAll<HTMLElement>('[data-truncated]')) {
    if (text.scrollWidth > text.clientWidth && text.textContent !== '') {
      return { anchor: text, text: text.textContent };
    }
  }
  return undefined;
}
const cellAt = (key: string | undefined): CellPosition | undefined => {
  if (key === undefined) return undefined;
  const [row = 0, col = 0] = key.split(':').map(Number);
  return { row, col };
};

/**
 * The record table. It holds only the rows on screen (plus 8 either way, and
 * the focused and edited rows), so it works the same over 50 rows or a
 * million; every value draws and edits through the field set; the keyboard is
 * a spreadsheet's (arrows, Enter or typing to edit, Delete to clear, shift
 * ranges, copy and paste as tab separated text). Column order, widths, pins
 * and hiding change from the column menu or by pointer, and leave through
 * `onColumnsChange`.
 */
export function DataGrid<Row>({
  label,
  columns,
  pinnedCount,
  rows,
  getValue,
  getDisplay,
  rowHeader,
  selection,
  onSelectionChange,
  onColumnsChange,
  onCellChange,
  onCellsChange,
  cellErrors,
  footer,
  status = 'ready',
  onRetry,
  emptyState,
  onRowOpen,
  onSort,
  onFilter,
  members,
  phone,
  editorProps,
  focusRow,
}: DataGridProps<Row>) {
  const { locale, timeZone } = useFormatSettings();
  const toasts = useToasts();
  const platform = useKeyboardPlatform();
  const { isFocusVisible } = useFocusVisible();
  const showSkeleton = useDelayedLoading(status === 'loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const number = (value: number) => memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(value);

  // Columns: the screen's layout, or a preview while a pointer resize runs.
  // Kept stable through a scroll, so the header redraws only when its columns or state change.
  const [preview, setPreview] = useState<ColumnLayout | undefined>(undefined);
  const layout = useMemo<ColumnLayout>(() => preview ?? { columns, pinnedCount }, [preview, columns, pinnedCount]);
  const placed = useMemo(() => placeColumns(layout, CHECK), [layout]);
  const unpinned = useMemo(() => placed.filter((each) => !each.isPinned), [placed]);
  const colCount = placed.length + 1;
  const pinnedEnd = placed.filter((each) => each.isPinned).reduce((end, each) => end + each.column.width, CHECK);
  const gridWidth = placed.reduce((end, each) => end + each.column.width, CHECK);
  const lastPinnedId = placed.filter((each) => each.isPinned).at(-1)?.column.id;
  const commitLayout = (next: ColumnLayout) => {
    setPreview(undefined);
    onColumnsChange?.(next.columns, next.pinnedCount);
  };

  // Rows: the records, then the footer row when there is one, which the keys reach too.
  const count = status === 'ready' ? rows.count : 0;
  const hasFooter = footer !== undefined && count > 0;
  const rowCount = count + (hasFooter ? 1 : 0);

  // Focus, ranges and editing come first: the focused and edited rows stay drawn.
  const [focusAt, setFocusAt] = useState<CellPosition>({ row: 0, col: 1 });
  const focus = { row: Math.min(focusAt.row, rowCount - 1), col: Math.min(focusAt.col, colCount - 1) };
  const [range, setRange] = useState<CellRange | undefined>(undefined);
  const [editingAt, setEditing] = useState<Editing | undefined>(undefined);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [resizing, setResizing] = useState<string | undefined>(undefined);
  const [localErrors, setLocalErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [anchorRow, setAnchorRow] = useState<number | undefined>(undefined);
  const [isWithin, setWithin] = useState(false);
  const [isTipDismissed, setTipDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  // One tooltip for every cell, so a screen of cells mounts no tooltip each.
  const [tip, setTip] = useState<Tip | undefined>(undefined);
  const tipAnchor = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoveredCell = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current);
    },
    [],
  );
  const pendingFocus = useRef(false);
  const shiftPressed = useRef(false);
  const within = useRef(false);

  // Only the rows on screen, plus the overscan, draw; and the focused and edited
  // rows, so focus and a draft survive a scroll that takes them off screen.
  const kept = [focus.row, editingAt?.row].filter((row): row is number => row !== undefined && row >= 0 && row < count);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual hands back new functions each render, so the grid stays outside the compiler's memoisation.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: OVERSCAN,
    scrollMargin: HEADER,
    scrollPaddingStart: HEADER,
    scrollPaddingEnd: hasFooter ? ROW : 0,
    rangeExtractor: (visible) => {
      const drawn = defaultRangeExtractor(visible);
      const extra = kept.filter((row) => !drawn.includes(row));
      return extra.length === 0 ? drawn : [...drawn, ...extra].sort((a, b) => a - b);
    },
    // React batches the scroll update; a synchronous flush would cut into a render already under way.
    useFlushSync: false,
  });
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: unpinned.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => unpinned[index]?.column.width ?? LIMITS.min,
    overscan: 2,
    scrollMargin: pinnedEnd,
    enabled: placed.length > COLUMN_VIRTUALISE_AFTER,
    useFlushSync: false,
  });
  const widthsKey = unpinned.map((each) => `${each.column.id}=${String(each.column.width)}`).join();
  useLayoutEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, widthsKey]);
  const items = virtualizer.getVirtualItems();
  // The rows on screen plus the overscan, without the kept ones, are what the screen loads.
  const visible = virtualizer.range;
  const firstRow = visible === null ? 0 : Math.max(0, visible.startIndex - OVERSCAN);
  const endRow = visible === null ? 0 : Math.min(count, visible.endIndex + OVERSCAN + 1);
  const onRangeChange = useRef(rows.onRangeChange);
  useLayoutEffect(() => {
    onRangeChange.current = rows.onRangeChange;
  });
  useEffect(() => {
    if (endRow > firstRow) onRangeChange.current?.({ start: firstRow, end: endRow });
  }, [firstRow, endRow]);

  const isColumnVirtual = placed.length > COLUMN_VIRTUALISE_AFTER;
  const columnItems = isColumnVirtual ? columnVirtualizer.getVirtualItems() : NO_ITEMS;
  const drawn = useMemo(
    () => [
      ...placed.filter((each) => each.isPinned),
      ...(isColumnVirtual ? columnItems.flatMap((item) => unpinned[item.index] ?? []) : unpinned),
    ],
    [placed, unpinned, isColumnVirtual, columnItems],
  );
  const leadSpacer = isColumnVirtual ? Math.max(0, (columnItems[0]?.start ?? pinnedEnd) - pinnedEnd) : 0;
  const drawnEnd = isColumnVirtual ? (columnItems.at(-1)?.end ?? pinnedEnd) : gridWidth;
  const trailSpacer = Math.max(0, gridWidth - drawnEnd);

  // Selection, controlled or not. The ref holds the latest, for answers that arrive later.
  const [ownSelection, setOwnSelection] = useState<GridSelection>(noRows);
  const currentSelection = selection ?? ownSelection;
  const latestSelection = useRef(currentSelection);
  useLayoutEffect(() => {
    latestSelection.current = currentSelection;
  });
  const changeSelection = (next: GridSelection, announce = false) => {
    latestSelection.current = next;
    if (selection === undefined) setOwnSelection(next);
    onSelectionChange?.(next);
    if (announce) setAnnouncement(strings.rowsSelected(number(selectedCount(next, count))));
  };

  const columnAt = (col: number): GridColumn | undefined => (col === 0 ? undefined : placed[col - 1]?.column);
  const modeAt = (col: number) => {
    const attribute = columnAt(col)?.attribute;
    return attribute === undefined ? undefined : editModeOf(attribute);
  };
  const rowItem = (row: number): Row | undefined => (row >= 0 && row < count ? rows.getItem(row) : undefined);
  const rowIdAt = (row: number): string | undefined => {
    const item = rowItem(row);
    return item === undefined ? undefined : rows.getKey(item);
  };
  // An edit belongs to its record: if a live change moved that record off the row, the edit ends.
  const editing =
    editingAt !== undefined &&
    rowIdAt(editingAt.row) === editingAt.rowId &&
    columnAt(editingAt.col)?.id === editingAt.columnId
      ? editingAt
      : undefined;
  const textContext = (attribute: FieldAttribute, display?: unknown): TextContext => ({
    locale,
    timeZone,
    attribute,
    ...(members === undefined ? {} : { members }),
    ...(phone === undefined ? {} : { phone }),
    ...(display === undefined ? {} : { display }),
  });
  const errorFor = (rowId: string, columnId: string) =>
    cellErrors?.get(`${rowId}:${columnId}`) ?? localErrors.get(`${rowId}:${columnId}`);
  const clearLocalErrors = (keys: readonly string[]) => {
    if (keys.some((key) => localErrors.has(key))) {
      setLocalErrors((previous) => new Map([...previous].filter(([key]) => !keys.includes(key))));
    }
  };
  const addLocalErrors = (refused: readonly (readonly [string, string])[]) => {
    if (refused.length > 0) setLocalErrors((previous) => new Map([...previous, ...refused]));
  };
  const emit = (changes: readonly CellChange[]) => {
    if (changes.length === 0) return;
    clearLocalErrors(changes.map((change) => `${change.rowId}:${change.columnId}`));
    if (changes.length === 1 && onCellsChange === undefined) {
      const [only] = changes;
      if (only !== undefined) onCellChange?.(only);
      return;
    }
    if (onCellsChange !== undefined) onCellsChange(changes);
    else for (const change of changes) onCellChange?.(change);
  };

  const scroller = () => scrollRef.current;
  const pageRows = () => Math.max(1, Math.floor(((scroller()?.clientHeight ?? 0) - HEADER) / ROW));
  const bounds = () => ({ rowCount, colCount, pageRows: pageRows() });

  /** Scrolls the cell into view past the sticky header and the pinned run. The footer is always in view. */
  const bringIntoView = (position: CellPosition) => {
    const element = scroller();
    if (element === null) return;
    if (position.row >= 0 && position.row < count) virtualizer.scrollToIndex(position.row, { align: 'auto' });
    const column = position.col > 0 ? placed[position.col - 1] : undefined;
    if (column === undefined || column.isPinned) return;
    const start = column.offset;
    const end = start + column.column.width;
    if (start < element.scrollLeft + pinnedEnd) element.scrollLeft = start - pinnedEnd;
    else if (end > element.scrollLeft + element.clientWidth) element.scrollLeft = end - element.clientWidth;
  };

  const goTo = (position: CellPosition, extend = false) => {
    const next = extend ? { anchor: range?.anchor ?? focus, focus: position } : undefined;
    setRange(next);
    setFocusAt(position);
    setTipDismissed(false);
    if (next !== undefined) {
      const edges = rangeEdges(next);
      setAnnouncement(strings.rangeSize(number(edges.bottom - edges.top + 1), number(edges.right - edges.left + 1)));
    }
    pendingFocus.current = true;
    bringIntoView(position);
  };

  // A row the screen asks for (one it just made): focus moves there once a
  // closing dialog has finished and handed focus back, so it isn't taken back.
  const goToLatest = useRef(goTo);
  useLayoutEffect(() => {
    goToLatest.current = goTo;
  });
  useEffect(() => {
    if (focusRow === undefined) return;
    let frames = 0;
    let frame = 0;
    const step = () => {
      frames += 1;
      if (frames < OVERLAY_WAIT_FRAMES && document.querySelector('[data-exiting]') !== null) {
        frame = requestAnimationFrame(step);
        return;
      }
      // One more frame: a closing overlay hands focus back as it unmounts.
      frame = requestAnimationFrame(() => {
        goToLatest.current({ row: focusRow.index, col: 1 });
      });
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [focusRow]);

  /** Shows `cell`'s tip, or closes the tooltip when it has none. */
  const showTip = (cell: HTMLElement, via: Tip['via']) => {
    const found = tipIn(cell);
    if (found === undefined) {
      setTip(undefined);
      return;
    }
    tipAnchor.current = found.anchor;
    setTip({ key: `${cell.dataset.cell ?? ''}:${via}`, text: found.text, via });
  };
  const closeTip = () => {
    clearTimeout(hoverTimer.current);
    setTip(undefined);
  };
  // A pointer resting on a cell shows its tip after the tooltip delay, or at
  // once while another is showing; keyboard focus shows it at once.
  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    if (!event.currentTarget.contains(event.target)) return;
    const cell = event.target.closest<HTMLElement>('[data-cell]');
    const key = cell?.dataset.cell;
    if (key === hoveredCell.current) return;
    hoveredCell.current = key;
    clearTimeout(hoverTimer.current);
    if (cell === null) {
      if (tip?.via === 'hover') setTip(undefined);
      return;
    }
    if (tip?.via === 'hover') {
      showTip(cell, 'hover');
      return;
    }
    hoverTimer.current = setTimeout(() => {
      if (hoveredCell.current === key) showTip(cell, 'hover');
    }, TOOLTIP_DELAY_MS);
  };
  const onPointerLeave = () => {
    hoveredCell.current = undefined;
    clearTimeout(hoverTimer.current);
    if (tip?.via === 'hover') setTip(undefined);
  };

  // After every render: inner controls stay out of the tab order (Tab enters
  // and leaves at the one focused cell), and a moved focus lands once its cell
  // has rendered. An editor in a list or a popover places its own focus.
  useLayoutEffect(() => {
    const root = scroller();
    if (root === null) return;
    for (const element of root.querySelectorAll<HTMLElement>(TABBABLE)) {
      if (element.hasAttribute('data-cell') || element.closest('[data-editing]') !== null) continue;
      if (element.tabIndex >= 0) element.tabIndex = -1;
    }
    if (!pendingFocus.current) return;
    const cell = root.querySelector<HTMLElement>(`[data-cell="${keyOf(focus.row, focus.col)}"]`);
    if (cell === null) return;
    pendingFocus.current = false;
    const isEditingHere = editing !== undefined && editing.row === focus.row && editing.col === focus.col;
    const mode = isEditingHere ? modeAt(focus.col) : undefined;
    if (mode === 'list' || mode === 'popover') return;
    // Focus once this commit is done: a focus event inside it would start another render.
    queueMicrotask(() => {
      if (mode === undefined) {
        cell.focus({ preventScroll: true });
        if (isFocusVisible && !isTipDismissed) showTip(cell, 'focus');
        else if (tip?.via === 'focus') setTip(undefined);
        return;
      }
      const input = cell.querySelector<HTMLElement>('input:checked, input, textarea');
      (input ?? cell).focus({ preventScroll: true });
      if (input instanceof HTMLInputElement && input.type !== 'radio') {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } else if (input instanceof HTMLTextAreaElement) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  });

  const startEditing = (position: CellPosition, startText?: string) => {
    const column = columnAt(position.col);
    const id = rowIdAt(position.row);
    if (column === undefined || id === undefined || editModeOf(column.attribute) === undefined) return;
    closeTip();
    clearLocalErrors([`${id}:${column.id}`]);
    setEditing({
      row: position.row,
      col: position.col,
      rowId: id,
      columnId: column.id,
      ...(startText === undefined ? {} : { startText }),
    });
    pendingFocus.current = true;
  };

  const stopEditing = (then?: CellPosition) => {
    setEditing(undefined);
    if (then === undefined) {
      pendingFocus.current = true;
      return;
    }
    goTo(then);
  };

  /** Leaves the editor once its value was accepted (no field error showing), then moves. */
  const finishEditing = (move: 'down' | 'right' | 'left' | 'up') => {
    const at = editing;
    if (at === undefined) return;
    setTimeout(() => {
      const cell = scroller()?.querySelector(`[data-cell="${keyOf(at.row, at.col)}"]`);
      if (cell?.querySelector('[aria-invalid="true"]')) return;
      const key = { down: 'ArrowDown', up: 'ArrowUp', right: 'ArrowRight', left: 'ArrowLeft' }[move];
      const next = moveFocus(at, { key, mod: false }, bounds());
      // Outside any event: render it now, so no half done render is left for the next key to meet.
      flushSync(() => {
        stopEditing(next ?? at);
      });
    }, 0);
  };

  const commitCell = (row: number, col: number, value: unknown) => {
    // An open editor writes to the record and column it opened on.
    const target =
      editing !== undefined && editing.row === row && editing.col === col
        ? { rowId: editing.rowId, columnId: editing.columnId }
        : { rowId: rowIdAt(row), columnId: columnAt(col)?.id };
    const column = columnAt(col);
    if (column === undefined || target.rowId === undefined || target.columnId === undefined) return;
    emit([{ rowId: target.rowId, columnId: target.columnId, value }]);
    const mode = editModeOf(column.attribute);
    if (
      (mode === 'popover' || mode === 'list') &&
      !column.attribute.allowMultiple &&
      fieldTypeOf(column.attribute.type).closesOnCommit === true
    ) {
      stopEditing();
    }
  };

  const toggleInPlace = (position: CellPosition) => {
    const column = columnAt(position.col);
    const item = rowItem(position.row);
    if (column === undefined || item === undefined || readOnlyReasonOf(column.attribute) !== undefined) return;
    emit([{ rowId: rows.getKey(item), columnId: column.id, value: getValue(item, column.id) !== true }]);
  };

  /** The selected range's edges, or the focused cell's, within the records (never the header or footer). */
  const targetEdges = () => {
    const edges =
      range === undefined
        ? { top: focus.row, bottom: focus.row, left: focus.col, right: focus.col }
        : rangeEdges(range);
    return { ...edges, top: Math.max(0, edges.top), bottom: Math.min(count - 1, edges.bottom) };
  };

  const clearCells = () => {
    const edges = targetEdges();
    const changes: CellChange[] = [];
    const refused: (readonly [string, string])[] = [];
    for (let row = edges.top; row <= edges.bottom; row += 1) {
      const id = rowIdAt(row);
      if (id === undefined) continue;
      for (let col = Math.max(1, edges.left); col <= edges.right; col += 1) {
        const column = columnAt(col);
        if (column === undefined || readOnlyReasonOf(column.attribute) !== undefined) continue;
        const result = toCommittable(column.attribute, clearedValueOf(column.attribute));
        if (result.ok) changes.push({ rowId: id, columnId: column.id, value: result.value });
        else refused.push([`${id}:${column.id}`, result.message]);
      }
    }
    emit(changes);
    addLocalErrors(refused);
    if (refused.length > 0 && range !== undefined) {
      toasts.toast({ tone: 'danger', message: strings.notCleared(number(refused.length), refused[0]?.[1] ?? '') });
    }
  };

  // Rows: the checkbox column, shift ranges, the rows on screen.
  const onScreenIds = () => {
    const element = scroller();
    if (element === null) return [];
    const top = element.scrollTop + HEADER;
    const bottom = element.scrollTop + element.clientHeight - (hasFooter ? ROW : 0);
    return items.filter((item) => item.start >= top && item.end <= bottom).flatMap((item) => rowIdAt(item.index) ?? []);
  };
  const selectRowRange = (from: number, to: number) => {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const loaded: string[] = [];
    let missing = 0;
    for (let row = start; row <= end; row += 1) {
      const id = rowIdAt(row);
      if (id === undefined) missing += 1;
      else loaded.push(id);
    }
    if (missing > 0 && rows.resolveKeys !== undefined) {
      rows.resolveKeys(start, end + 1).then(
        (ids) => {
          changeSelection(withRows(latestSelection.current, ids, true), true);
        },
        () => {
          toasts.toast({ tone: 'danger', message: strings.notResolved });
        },
      );
      return;
    }
    changeSelection(withRows(currentSelection, loaded, true), true);
    if (missing > 0) toasts.toast({ tone: 'success', message: strings.leftOut(number(missing)) });
  };
  const toggleRowAt = (row: number, extend: boolean) => {
    const id = rowIdAt(row);
    if (id === undefined) return;
    if (extend && anchorRow !== undefined) {
      selectRowRange(anchorRow, row);
      return;
    }
    setAnchorRow(row);
    changeSelection(toggleRow(currentSelection, id), true);
  };
  const screenIds = onScreenIds();
  const screenSelected = screenIds.filter((id) => isRowSelected(currentSelection, id)).length;
  const isScreenSelected = screenIds.length > 0 && screenSelected === screenIds.length;
  const toggleScreen = () => {
    changeSelection(withRows(currentSelection, onScreenIds(), !isScreenSelected), true);
  };

  // Resize mode: Left and Right step the width; Enter or Esc leave it, and so
  // does any other key, a click, or focus moving on.
  const resizeBy = (id: string, delta: number) => {
    const column = layout.columns.find((each) => each.id === id);
    if (column === undefined) return;
    commitLayout(resizeColumn(layout, id, column.width + delta, LIMITS));
  };

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing === undefined) return;
    const mode = modeAt(editing.col);
    // Tab commits and moves on from a cell or a list; a popover's own fields take it.
    if (event.key === 'Tab' && (mode === 'cell' || mode === 'list')) {
      event.preventDefault();
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      finishEditing(event.shiftKey ? 'left' : 'right');
      return;
    }
    if (event.key === 'Enter' && mode === 'cell' && !event.nativeEvent.isComposing) {
      finishEditing(event.shiftKey ? 'up' : 'down');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing !== undefined) {
      // An in-cell editor that leaves Esc alone still cancels.
      if (event.key === 'Escape' && !event.defaultPrevented) stopEditing();
      return;
    }
    if (event.defaultPrevented) return;
    if (resizing !== undefined) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const forward = (event.key === 'ArrowRight') === (getComputedStyle(event.currentTarget).direction !== 'rtl');
        resizeBy(resizing, forward ? RESIZE_STEP : -RESIZE_STEP);
        return;
      }
      setResizing(undefined);
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        return;
      }
    }
    const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
    const column = columnAt(focus.col);
    if (event.altKey && event.key === 'ArrowDown' && focus.row < 0 && column !== undefined) {
      event.preventDefault();
      setMenuFor(column.id);
      return;
    }
    const next = moveFocus(focus, { key: event.key, mod }, bounds());
    if (next !== undefined) {
      event.preventDefault();
      goTo(next, event.shiftKey && event.key.startsWith('Arrow'));
      return;
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      changeSelection(withRows(currentSelection, onScreenIds(), true), true);
      return;
    }
    if (event.key === 'Escape') {
      setRange(undefined);
      setTipDismissed(true);
      closeTip();
      return;
    }
    if (focus.row < 0) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (column === undefined) toggleScreen();
        else setMenuFor(column.id);
      }
      return;
    }
    // The footer reads; nothing in it edits.
    if (focus.row >= count) return;
    if (focus.col === 0) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        toggleRowAt(focus.row, event.shiftKey);
      }
      return;
    }
    if (column === undefined) return;
    if (mod && event.key === 'Enter') {
      // Follows a link in the cell (an email, a website).
      const link = scroller()?.querySelector<HTMLElement>(`[data-cell="${keyOf(focus.row, focus.col)}"] a[href]`);
      if (link !== null && link !== undefined) {
        event.preventDefault();
        link.click();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      clearCells();
      return;
    }
    if (event.key === ' ' && column.id === rowHeader) {
      event.preventDefault();
      const id = rowIdAt(focus.row);
      if (id !== undefined) onRowOpen?.(id);
      return;
    }
    if (fieldTypeOf(column.attribute.type).togglesInPlace === true && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      toggleInPlace(focus);
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      startEditing(focus);
      return;
    }
    if (isPrintable(event)) {
      event.preventDefault();
      startEditing(focus, event.key);
    }
  };

  // Focus follows the pointer and anything focused inside a cell.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    within.current = true;
    setWithin(true);
    if (event.target === event.currentTarget) {
      pendingFocus.current = true;
      bringIntoView(focus);
      setFocusAt({ ...focus });
      return;
    }
    // A popover editor is outside the grid's DOM, though its events reach here.
    const position = cellAt((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell);
    if (position === undefined) return;
    if (position.row === focus.row && position.col === focus.col) return;
    if (editing !== undefined && (editing.row !== position.row || editing.col !== position.col)) setEditing(undefined);
    if (!shiftPressed.current) setRange(undefined);
    if (resizing !== undefined && position.row >= 0) setResizing(undefined);
    setTipDismissed(false);
    setFocusAt(position);
  };
  // Focus that left the grid is gone; focus that fell to the page because its
  // cell left the page comes back to the focused cell.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    within.current = false;
    const lost = event.target;
    queueMicrotask(() => {
      if (within.current) return;
      const active = document.activeElement;
      if (!lost.isConnected && (active === null || active === document.body)) {
        pendingFocus.current = true;
        setFocusAt((previous) => ({ ...previous }));
        return;
      }
      setWithin(false);
      if (tip?.via === 'focus') setTip(undefined);
    });
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    shiftPressed.current = event.shiftKey;
    if (resizing !== undefined) setResizing(undefined);
    if (!event.shiftKey) return;
    const position = cellAt((event.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell);
    if (position !== undefined && position.col > 0 && position.row >= 0 && position.row < count) {
      setRange({ anchor: range?.anchor ?? focus, focus: position });
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing !== undefined || focus.row < 0 || focus.row >= count) return;
    const edges = targetEdges();
    if (edges.right < 1) return;
    const lines: string[][] = [];
    for (let row = edges.top; row <= edges.bottom; row += 1) {
      const item = rowItem(row);
      if (item === undefined) {
        event.preventDefault();
        toasts.toast({ tone: 'danger', message: strings.notLoaded });
        return;
      }
      const line: string[] = [];
      for (let col = Math.max(1, edges.left); col <= edges.right; col += 1) {
        const column = columnAt(col);
        if (column === undefined) continue;
        const value = getValue(item, column.id);
        const display = getDisplay?.(item, column.id);
        line.push(
          value === null || value === undefined
            ? ''
            : fieldTypeOf(column.attribute.type).toText(value, textContext(column.attribute, display)),
        );
      }
      lines.push(line);
    }
    event.preventDefault();
    event.clipboardData.setData('text/plain', toTsv(lines));
    setAnnouncement(strings.copied(number(lines.length * (lines[0]?.length ?? 0))));
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing !== undefined) return;
    const text = event.clipboardData.getData('text/plain');
    if (text === '' || focus.row < 0 || focus.row >= count) return;
    event.preventDefault();
    const edges = range === undefined ? undefined : { ...targetEdges(), left: Math.max(1, rangeEdges(range).left) };
    const plan = planPaste(
      fromTsv(text),
      { row: focus.row, col: Math.max(1, focus.col) },
      edges,
      colCount - 1,
      (row) => rowItem(row) !== undefined,
    );
    const changes: CellChange[] = [];
    const refused: (readonly [string, string])[] = [];
    let readOnly = 0;
    for (const cell of plan.cells) {
      const column = columnAt(cell.col);
      const id = rowIdAt(cell.row);
      if (column === undefined || id === undefined) continue;
      const { attribute } = column;
      if (readOnlyReasonOf(attribute) !== undefined) {
        readOnly += 1;
        continue;
      }
      const parsed =
        cell.text.trim() === ''
          ? clearedValueOf(attribute)
          : fieldTypeOf(attribute.type).fromText(cell.text, textContext(attribute));
      if (isRefusal(parsed)) {
        refused.push([`${id}:${column.id}`, parsed.reason]);
        continue;
      }
      const result = toCommittable(attribute, parsed);
      if (result.ok) changes.push({ rowId: id, columnId: column.id, value: result.value });
      else refused.push([`${id}:${column.id}`, result.message]);
    }
    emit(changes);
    // Refused cells keep their reason, so they can be found after the toast has gone.
    addLocalErrors(refused);
    const left = refused.length + plan.clipped + readOnly;
    if (left === 0) {
      toasts.toast({ tone: 'success', message: strings.pasted(number(changes.length)) });
      return;
    }
    const causes = [
      refused.length > 0 ? strings.refusedCause(number(refused.length), refused[0]?.[1] ?? '') : '',
      plan.clipped > 0 ? strings.clippedCause(number(plan.clipped)) : '',
      readOnly > 0 ? strings.readOnlyCause(number(readOnly)) : '',
    ].filter((cause) => cause !== '');
    toasts.toast({ tone: 'danger', message: strings.notPasted(number(left), causes.join(' ')) });
  };

  // Drawing.
  const placeOf = (each: PlacedColumn): CellPlace => cellPlace(placed, each, lastPinnedId);
  const columnActions = (column: GridColumn): ColumnActions => ({
    onMove: (direction: -1 | 1) => {
      commitLayout(moveColumn(layout, column.id, direction));
    },
    onPin: () => {
      commitLayout(pinColumn(layout, column.id));
    },
    onUnpin: () => {
      commitLayout(unpinColumn(layout, column.id));
    },
    onHide: () => {
      // Focus stays in the header, on the column that takes its place.
      const at = placed.findIndex((each) => each.column.id === column.id) + 1;
      commitLayout(hideColumn(layout, column.id));
      goTo({ row: -1, col: Math.max(1, Math.min(at, placed.length - 1)) });
    },
    ...(onSort === undefined
      ? {}
      : {
          onSort: (direction: 'ascending' | 'descending') => {
            onSort(column.id, direction);
          },
        }),
    ...(onFilter === undefined
      ? {}
      : {
          onFilter: () => {
            onFilter(column.id);
          },
        }),
    onStartResize: () => {
      setResizing(column.id);
      goTo({ row: -1, col: placed.findIndex((each) => each.column.id === column.id) + 1 });
    },
    onResize: (width: number, isDone: boolean) => {
      const next = resizeColumn(layout, column.id, width, LIMITS);
      if (isDone) commitLayout(next);
      else setPreview(next);
    },
    onDrop: (dragged: string, side: 'before' | 'after') => {
      const index = layout.columns.findIndex((each) => each.id === column.id);
      const before = side === 'before' ? column.id : layout.columns[index + 1]?.id;
      commitLayout(reorderColumn(layout, dragged, before));
    },
  });
  const leadIndex = isColumnVirtual ? drawn.findIndex((each) => !each.isPinned) : -1;
  const isFocusedAt = (row: number, col: number) => focus.row === row && focus.col === col;

  // The header takes stable handlers that call the latest ones, so a scroll
  // step never redraws it.
  const latestHeader = useRef({ toggleScreen, columnActions });
  useLayoutEffect(() => {
    latestHeader.current = { toggleScreen, columnActions };
  });
  const hasSort = onSort !== undefined;
  const hasFilter = onFilter !== undefined;
  const headerHandlers = useMemo<HeaderHandlers>(
    () => ({
      toggleScreen: () => {
        latestHeader.current.toggleScreen();
      },
      setMenuFor,
      actionsFor: (column) => {
        const now = () => latestHeader.current.columnActions(column);
        return {
          onMove: (direction) => {
            now().onMove(direction);
          },
          onPin: () => {
            now().onPin();
          },
          onUnpin: () => {
            now().onUnpin();
          },
          onHide: () => {
            now().onHide();
          },
          onStartResize: () => {
            now().onStartResize();
          },
          onResize: (width, isDone) => {
            now().onResize(width, isDone);
          },
          onDrop: (dragged, side) => {
            now().onDrop(dragged, side);
          },
          ...(hasSort
            ? {
                onSort: (direction) => {
                  now().onSort?.(direction);
                },
              }
            : {}),
          ...(hasFilter
            ? {
                onFilter: () => {
                  now().onFilter?.();
                },
              }
            : {}),
        };
      },
    }),
    [hasSort, hasFilter],
  );

  const header = (
    <GridHeader
      placed={placed}
      drawn={drawn}
      layout={layout}
      lastPinnedId={lastPinnedId}
      rowHeader={rowHeader}
      leadIndex={leadIndex}
      leadSpacer={leadSpacer}
      trailSpacer={trailSpacer}
      focusCol={focus.row === -1 ? focus.col : undefined}
      resizing={resizing}
      menuFor={menuFor}
      screen={isScreenSelected ? 'all' : screenSelected > 0 ? 'some' : 'none'}
      isEmpty={count === 0}
      handlers={headerHandlers}
    />
  );

  const headerColumn = placed.find((each) => each.column.id === rowHeader)?.column;
  const nameOf = (rowData: Row) => {
    const value = getValue(rowData, rowHeader);
    if (headerColumn === undefined || value === null || value === undefined) return strings.untitled;
    const display = getDisplay?.(rowData, rowHeader);
    const text = fieldTypeOf(headerColumn.attribute.type).toText(value, textContext(headerColumn.attribute, display));
    return text === '' ? strings.untitled : text;
  };

  // Rows recycle by place on screen: the nth row drawn is always the same
  // element, so a scroll step, however far, redraws rows in place, and the
  // page keeps them in order for screen readers. The focused and edited rows
  // keep elements of their own, so focus and a draft never move to another row.
  const ownKey = (row: number) =>
    row === editingAt?.row ? 'editing' : row === focus.row && row >= 0 && row < count ? 'focused' : undefined;
  let place = 0;
  const rowKeys = items.map((item) => {
    const own = ownKey(item.index);
    if (own !== undefined) return own;
    place += 1;
    return `p${String(place)}`;
  });

  const bodyRows = items.map((item, drawnAt) => {
    const row = item.index;
    const rowData = rows.getItem(row);
    const id = rowData === undefined ? undefined : rows.getKey(rowData);
    const isSelected = id !== undefined && isRowSelected(currentSelection, id);
    const name = rowData === undefined ? strings.loadingRow : nameOf(rowData);
    return (
      <div
        key={rowKeys[drawnAt]}
        role="row"
        aria-rowindex={row + 2}
        aria-selected={isSelected}
        className={styles.row}
        data-selected={isSelected || undefined}
        data-editing={editing?.row === row || undefined}
        style={{ '--row-offset': `${String(item.start - HEADER)}px` }}
      >
        {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events -- the grid's one key handler toggles it with Space */}
        <div
          role="gridcell"
          aria-colindex={1}
          className={styles.check}
          data-cell={keyOf(row, 0)}
          data-focused={isFocusedAt(row, 0) || undefined}
          tabIndex={isFocusedAt(row, 0) ? 0 : -1}
          onClick={(event) => {
            toggleRowAt(row, event.shiftKey);
          }}
        >
          {rowData !== undefined && <CheckboxMark label={strings.selectRow(name)} isSelected={isSelected} />}
        </div>
        {drawn.flatMap((each, index) => {
          const place = placeOf(each);
          const value = rowData === undefined ? undefined : getValue(rowData, each.column.id);
          const display = rowData === undefined ? undefined : getDisplay?.(rowData, each.column.id);
          const error = id === undefined ? undefined : errorFor(id, each.column.id);
          const isEditing = editing !== undefined && editing.row === row && editing.col === place.col;
          return [
            index === leadIndex ? <Spacer key="lead" width={leadSpacer} /> : null,
            <GridCell
              key={each.column.id}
              row={row}
              place={place}
              attribute={each.column.attribute}
              value={value}
              display={display}
              isLoaded={rowData !== undefined}
              isRowHeader={each.column.id === rowHeader}
              isFocused={isFocusedAt(row, place.col)}
              isInRange={isInRange(range, row, place.col)}
              tipId={`${gridId}-tip-${keyOf(row, place.col)}`}
              editorProps={editorProps?.(each.column) ?? NO_EDITOR_PROPS}
              onCommit={(next) => {
                commitCell(row, place.col, next);
              }}
              onCancel={() => {
                stopEditing();
              }}
              onPopoverClose={() => {
                const active = document.activeElement;
                if (active instanceof HTMLElement) active.blur();
                stopEditing();
              }}
              onDoubleClick={() => {
                startEditing({ row, col: place.col });
              }}
              {...(fieldTypeOf(each.column.attribute.type).togglesInPlace === true
                ? {
                    onToggle: () => {
                      toggleInPlace({ row, col: place.col });
                    },
                  }
                : {})}
              {...(each.column.id === rowHeader && id !== undefined && onRowOpen !== undefined
                ? {
                    onOpen: () => {
                      onRowOpen(id);
                    },
                  }
                : {})}
              {...(isEditing
                ? { editing: editing.startText === undefined ? {} : { startText: editing.startText } }
                : {})}
              {...(error === undefined ? {} : { error })}
            />,
          ];
        })}
        <Spacer width={trailSpacer} />
      </div>
    );
  });

  const footerRow = !hasFooter ? null : (
    <div role="row" aria-rowindex={count + 2} className={styles.footer}>
      <div
        role="gridcell"
        aria-colindex={1}
        className={styles.check}
        data-cell={keyOf(count, 0)}
        data-focused={isFocusedAt(count, 0) || undefined}
        tabIndex={isFocusedAt(count, 0) ? 0 : -1}
      />
      {drawn.flatMap((each, index) => {
        const place = placeOf(each);
        return [
          index === leadIndex ? <Spacer key="lead" width={leadSpacer} /> : null,
          <div
            key={each.column.id}
            role="gridcell"
            aria-colindex={place.col + 1}
            aria-readonly
            className={styles.total}
            data-cell={keyOf(count, place.col)}
            data-focused={isFocusedAt(count, place.col) || undefined}
            data-sticky={place.stickyOffset === undefined ? undefined : ''}
            data-align={fieldTypeOf(each.column.attribute.type).align}
            tabIndex={isFocusedAt(count, place.col) ? 0 : -1}
            style={{
              '--col-width': `${String(place.width)}px`,
              '--col-offset': `${String(place.stickyOffset ?? 0)}px`,
            }}
          >
            {footer[each.column.id]}
          </div>,
        ];
      })}
      <Spacer width={trailSpacer} />
    </div>
  );

  const isCellFocusable = focus.row < 0 || focus.row >= count || items.some((item) => item.index === focus.row);
  const resizingColumn = resizing === undefined ? undefined : layout.columns.find((each) => each.id === resizing);
  const isEmpty = status === 'ready' && count === 0;
  const spoken =
    resizingColumn !== undefined
      ? strings.resizing(resizingColumn.attribute.name, number(resizingColumn.width))
      : showSkeleton
        ? strings.loading
        : announcement;

  // A failed load or no access draws its state instead of a grid.
  if (status === 'error' || status === 'no-access') {
    return (
      <div className={styles.frame}>
        <div className={styles.state}>
          {status === 'error' && (
            <EmptyState tone="error" title={strings.failed} {...(onRetry === undefined ? {} : { onRetry })}>
              {strings.failedText}
            </EmptyState>
          )}
          {status === 'no-access' && (
            <EmptyState tone="locked" title={strings.noAccess}>
              {strings.noAccessText}
            </EmptyState>
          )}
        </div>
      </div>
    );
  }

  return (
    <SharedTooltipContext value>
      <div className={styles.frame}>
        <div
          ref={scrollRef}
          role="grid"
          aria-label={label}
          aria-rowcount={rowCount + 1}
          aria-colcount={colCount}
          aria-multiselectable
          aria-busy={status === 'loading' || undefined}
          className={styles.root}
          data-empty={isEmpty || undefined}
          tabIndex={isCellFocusable && status === 'ready' ? -1 : 0}
          onKeyDownCapture={onKeyDownCapture}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          onPointerDown={onPointerDown}
          onPointerOver={onPointerOver}
          onPointerLeave={onPointerLeave}
          onScroll={tip === undefined ? undefined : closeTip}
          onCopy={onCopy}
          onPaste={onPaste}
          style={{ '--grid-width': `${String(gridWidth)}px` }}
        >
          {header}
          {status === 'loading' ? (
            <div role="rowgroup" aria-hidden="true">
              {showSkeleton &&
                Array.from({ length: LOADING_ROWS }, (_, index) => (
                  <div key={index} className={styles.skeletonRow}>
                    <Skeleton width="full" />
                  </div>
                ))}
            </div>
          ) : (
            count > 0 && (
              <div
                role="rowgroup"
                className={styles.body}
                style={{ '--body-height': `${String(virtualizer.getTotalSize() - HEADER)}px` }}
              >
                {bodyRows}
              </div>
            )
          )}
          {footerRow}
        </div>
        {/* With no rows the header stays, so the columns and their menus do too. */}
        {isEmpty && (
          <div className={styles.state}>
            {emptyState ?? <EmptyState title={strings.empty}>{strings.emptyText}</EmptyState>}
          </div>
        )}
        {tip !== undefined && (isWithin || tip.via === 'hover') && (
          <AnchoredTooltip
            key={tip.key}
            content={tip.text}
            triggerRef={tipAnchor}
            onOpenChange={(isOpen) => {
              if (!isOpen) closeTip();
            }}
          />
        )}
        <VisuallyHidden>
          <span role="status">{spoken}</span>
        </VisuallyHidden>
      </div>
    </SharedTooltipContext>
  );
}

/** Where a column's cells sit: its drawn column, width, and offset when pinned. */
function cellPlace(placed: readonly PlacedColumn[], each: PlacedColumn, lastPinnedId: string | undefined): CellPlace {
  return {
    col: placed.indexOf(each) + 1,
    width: each.column.width,
    ...(each.isPinned ? { stickyOffset: each.offset } : {}),
    ...(each.column.id === lastPinnedId ? { isLastPinned: true } : {}),
  };
}

/** Room for the columns not drawn, so the drawn ones sit where they belong. */
function Spacer({ width }: { readonly width: number }) {
  return width > 0 ? (
    <div className={styles.spacer} aria-hidden="true" style={{ '--spacer-width': `${String(width)}px` }} />
  ) : null;
}

/** What the header calls; stable, each reading the grid's latest. */
interface HeaderHandlers {
  readonly toggleScreen: () => void;
  readonly setMenuFor: (columnId: string | undefined) => void;
  readonly actionsFor: (column: GridColumn) => ColumnActions;
}

interface GridHeaderProps {
  readonly placed: readonly PlacedColumn[];
  readonly drawn: readonly PlacedColumn[];
  readonly layout: ColumnLayout;
  readonly lastPinnedId: string | undefined;
  readonly rowHeader: string;
  readonly leadIndex: number;
  readonly leadSpacer: number;
  readonly trailSpacer: number;
  /** The focused column, while focus is in the header. */
  readonly focusCol: number | undefined;
  readonly resizing: string | undefined;
  readonly menuFor: string | undefined;
  readonly screen: 'none' | 'some' | 'all';
  readonly isEmpty: boolean;
  readonly handlers: HeaderHandlers;
}

/** The header row: the checkbox for the rows on screen, then a header per drawn column. Memoised, so a scroll step skips it. */
const GridHeader = memo(function GridHeader({
  placed,
  drawn,
  layout,
  lastPinnedId,
  rowHeader,
  leadIndex,
  leadSpacer,
  trailSpacer,
  focusCol,
  resizing,
  menuFor,
  screen,
  isEmpty,
  handlers,
}: GridHeaderProps) {
  const runOf = (id: string) => layout.columns.findIndex((each) => each.id === id) < layout.pinnedCount;
  const canMove = (id: string, direction: -1 | 1) => moveColumn(layout, id, direction) !== layout;
  return (
    <div role="row" aria-rowindex={1} className={styles.header}>
      {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events -- the grid's one key handler toggles it with Space */}
      <div
        role="columnheader"
        aria-colindex={1}
        className={styles.check}
        data-cell={keyOf(-1, 0)}
        data-focused={focusCol === 0 || undefined}
        tabIndex={focusCol === 0 ? 0 : -1}
        onClick={handlers.toggleScreen}
      >
        <CheckboxMark
          label={strings.selectOnScreen}
          isSelected={screen === 'all'}
          isIndeterminate={screen === 'some'}
          isReadOnly={isEmpty}
        />
      </div>
      {drawn.flatMap((each, index) => {
        const place = cellPlace(placed, each, lastPinnedId);
        return [
          index === leadIndex ? <Spacer key="lead" width={leadSpacer} /> : null,
          <GridHeaderCell
            key={each.column.id}
            column={each.column}
            place={place}
            isRowHeader={each.column.id === rowHeader}
            isPinned={runOf(each.column.id)}
            canMoveLeft={canMove(each.column.id, -1)}
            canMoveRight={canMove(each.column.id, 1)}
            isFocused={focusCol === place.col}
            isResizing={resizing === each.column.id}
            isMenuOpen={menuFor === each.column.id}
            onMenuOpenChange={(isOpen) => {
              handlers.setMenuFor(isOpen ? each.column.id : undefined);
            }}
            actions={handlers.actionsFor(each.column)}
          />,
        ];
      })}
      <Spacer width={trailSpacer} />
    </div>
  );
});
