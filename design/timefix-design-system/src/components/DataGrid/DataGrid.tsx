import {
  Button as AriaButton, Cell, Column, ColumnResizer, Input, ResizableTableContainer, Row, Table, TableBody, TableHeader, TextField,
  type Selection, type SortDescriptor,
} from 'react-aria-components';
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Avatar, PersonLine } from '../Avatar/Avatar.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { Skeleton } from '../Motion/Motion.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { MenuList, MenuItem, CLOSE_AFTER_PICK_MS } from '../Menu/Menu.tsx';
import { formatDate } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import './DataGrid.css';

/** How a column draws and edits its values. `text`, `select` and `status` edit in place. */
export type GridColumnType = 'name' | 'text' | 'number' | 'select' | 'status' | 'person' | 'date';

/** One choice of a select or status column. */
export interface GridOption {
  readonly id: string;
  readonly label: string;
  readonly hue?: Hue;
  readonly status?: StatusShape;
}

/** A column: its attribute's name and icon, type, and starting width. The `name` column is pinned. */
export interface GridColumn {
  readonly id: string;
  readonly name: string;
  readonly type: GridColumnType;
  readonly icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  readonly width?: number;
  readonly minWidth?: number;
  readonly options?: ReadonlyArray<GridOption>;
  readonly isSortable?: boolean;
  readonly isReadOnly?: boolean;
}

/** One record: its id, an optional grey sub-line for the name, and a value per column id. */
export interface GridRecord {
  readonly id: string;
  readonly kind?: 'person' | 'company';
  readonly values: Readonly<Record<string, string | number | undefined>>;
  /** Just made: the name shows a "New" tag until the list is left. */
  readonly isNew?: boolean;
}

/** Props for DataGrid. The consumer sorts, filters and stores; the grid draws and edits. */
export interface DataGridProps {
  readonly label: string;
  readonly columns: ReadonlyArray<GridColumn>;
  readonly rows: ReadonlyArray<GridRecord>;
  readonly sortDescriptor?: SortDescriptor;
  readonly onSortChange?: (d: SortDescriptor) => void;
  readonly selectedKeys?: Selection;
  readonly onSelectionChange?: (s: Selection) => void;
  /** A committed inline edit. The row washes `accent-soft` once. */
  readonly onCellChange?: (rowId: string, columnId: string, value: string) => void;
  /** Opens a record (Enter or a click on a row). Selection stays on the checkboxes, so a click never toggles a row by accident. */
  readonly onRowAction?: (rowId: string) => void;
  /** Shows the "+ New record" row; return the new row's id to open its name for typing. */
  readonly onAddRow?: () => string | undefined;
  readonly addLabel?: string;
  readonly isLoading?: boolean;
  /** The one line shown where rows would be. */
  readonly emptyState?: ReactNode;
  /** A line under the rows: counts and sums for what's shown ("5 deals · ₹48,20,000 total"). */
  readonly summary?: ReactNode;
}

const SKELETON_ROWS = ['sk1', 'sk2', 'sk3', 'sk4', 'sk5'];
const EDITABLE: ReadonlySet<GridColumnType> = new Set(['name', 'text', 'number', 'select', 'status']);
const REVEAL_MS = 400; // --duration-slow, transitions.dev 14 skeleton reveal
const WASH_MS = 1000;

type Editing = { readonly rowId: string; readonly colId: string; readonly anchor: HTMLElement };

/** The record table: pinned name, sortable and resizable columns, checkbox selection, inline edits, skeleton loading. Replaces DataGrid, Table and SampleTable. */
export function DataGrid({ label, columns, rows, sortDescriptor, onSortChange, selectedKeys, onSelectionChange, onCellChange, onRowAction, onAddRow, addLabel = 'New record', isLoading = false, emptyState, summary }: DataGridProps) {
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [washed, setWashed] = useState<ReadonlySet<string>>(new Set());
  const revealing = useReveal(isLoading);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The text editor's latest draft: a click outside commits it, Esc drops it.
  const draftRef = useRef<string | undefined>(undefined);

  const wash = (rowId: string) => {
    setWashed((s) => new Set(s).add(rowId));
    window.setTimeout(() => setWashed((s) => { const n = new Set(s); n.delete(rowId); return n; }), WASH_MS);
  };
  const commit = (rowId: string, colId: string, value: string) => {
    const before = rows.find((r) => r.id === rowId)?.values[colId];
    setEditing(undefined);
    if (String(before ?? '') === value) return;
    onCellChange?.(rowId, colId, value);
    wash(rowId);
  };
  const open = (cellEl: Element | null) => {
    const anchor = cellEl?.closest('td');
    const target = anchor?.querySelector<HTMLElement>('[data-edit]');
    const [rowId, colId] = (target?.dataset.edit ?? '').split('|');
    if (!anchor || !rowId || !colId) return false;
    draftRef.current = undefined;
    setEditing({ rowId, colId, anchor });
    return true;
  };
  // Enter on a focused editable cell opens its editor (before the row's own Enter handling).
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || editing) return;
    const active = document.activeElement;
    if (active?.tagName === 'TD' && open(active)) { e.preventDefault(); e.stopPropagation(); }
  };
  const addRow = () => {
    const id = onAddRow?.();
    if (!id) return;
    wash(id);
    // Open the new row's name once it has rendered.
    window.setTimeout(() => open(wrapRef.current?.querySelector(`[data-edit="${id}|${columns[0]?.id ?? ''}"]`) ?? null), 60);
  };

  const editRow = editing && rows.find((r) => r.id === editing.rowId);
  const editCol = editing && columns.find((c) => c.id === editing.colId);
  const shown: ReadonlyArray<GridRecord> = isLoading ? SKELETON_ROWS.map((id) => ({ id, values: {} })) : rows;

  return (
    <div ref={wrapRef} className={cx('tf-grid', revealing && 'tf-grid--revealing')} onKeyDownCapture={onKeyDownCapture} aria-busy={isLoading || undefined}>
      <ResizableTableContainer className="tf-grid__scroll">
        <Table
          aria-label={label}
          className="tf-grid__table"
          selectionMode="multiple"
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          onRowAction={(k) => onRowAction?.(String(k))}
          sortDescriptor={sortDescriptor}
          onSortChange={onSortChange}
          disabledKeys={isLoading ? SKELETON_ROWS : undefined}
        >
          <TableHeader className="tf-grid__head">
            <Column width={44} minWidth={44} className="tf-grid__th tf-grid__th--check">
              <Checkbox slot="selection" />
            </Column>
            {columns.map((c, i) => (
              <Column
                key={c.id}
                id={c.id}
                isRowHeader={i === 0}
                allowsSorting={c.isSortable ?? true}
                defaultWidth={c.width ?? 160}
                minWidth={c.minWidth ?? 96}
                className={cx('tf-grid__th', i === 0 && 'tf-grid__th--pin', c.type === 'number' && 'tf-grid__th--num')}
              >
                {({ sortDirection }) => (
                  <div className="tf-grid__thin">
                    {c.icon && <span className="tf-grid__thicon"><c.icon size={14} strokeWidth={1.75} /></span>}
                    <span className="tf-grid__thname">{c.name}</span>
                    <span className="tf-grid__sort" data-state={sortDirection ?? 'none'} aria-hidden="true">
                      <ArrowUp data-icon="ascending" size={14} strokeWidth={1.75} />
                      <ArrowDown data-icon="descending" size={14} strokeWidth={1.75} />
                    </span>
                    <ColumnResizer className="tf-grid__resizer" />
                  </div>
                )}
              </Column>
            ))}
          </TableHeader>
          <TableBody className="tf-grid__body" renderEmptyState={() => <div className="tf-grid__empty">{emptyState ?? 'No records'}</div>}>
            {shown.map((r, ri) => (
              <Row key={r.id} id={r.id} className={cx('tf-grid__row', washed.has(r.id) && 'is-changed')}>
                <Cell className="tf-grid__td tf-grid__td--check">
                  {isLoading ? <Skeleton width={18} height={18} /> : <Checkbox slot="selection" />}
                </Cell>
                {columns.map((c, i) => (
                  <Cell
                    key={c.id}
                    textValue={String(r.values[c.id] ?? '')}
                    className={cx('tf-grid__td', i === 0 && 'tf-grid__td--pin', c.type === 'number' && 'tf-grid__td--num', editing?.rowId === r.id && editing.colId === c.id && 'is-editing')}
                  >
                    {isLoading ? (
                      <Skeleton width={i === 0 ? '70%' : `${40 + ((ri * 17 + i * 13) % 40)}%`} height={12} />
                    ) : (
                      <div
                        className="tf-grid__value"
                        data-edit={!c.isReadOnly && EDITABLE.has(c.type) ? `${r.id}|${c.id}` : undefined}
                        onDoubleClick={(e) => { if (!c.isReadOnly && EDITABLE.has(c.type)) open(e.currentTarget); }}
                      >
                        <span className="tf-grid__content">{renderValue(c, r)}</span>
                        {revealing && <span className="tf-grid__ghost" aria-hidden="true"><Skeleton width="60%" height={12} /></span>}
                      </div>
                    )}
                  </Cell>
                ))}
              </Row>
            ))}
          </TableBody>
        </Table>
      </ResizableTableContainer>
      {summary !== undefined && !isLoading && rows.length > 0 && <div className="tf-grid__summary tf-num" aria-live="polite">{summary}</div>}
      {onAddRow && !isLoading && (
        <AriaButton className="tf-grid__add" onPress={addRow}><Plus size={14} strokeWidth={1.75} />{addLabel}</AriaButton>
      )}
      {editing && editRow && editCol && (
        <Popover
          triggerRef={{ current: editing.anchor }}
          isOpen
          onOpenChange={(o) => {
            if (o) return;
            const d = draftRef.current;
            if (d !== undefined) commit(editRow.id, editCol.id, d.trim()); else setEditing(undefined);
          }}
          placement="bottom start"
          offset={-44}
          className="tf-grid__editor"
          {...(editCol.type === 'select' || editCol.type === 'status' ? {} : { label: `Edit ${editCol.name}` })}
        >
          <CellEditor column={editCol} value={String(editRow.values[editCol.id] ?? '')} draftRef={draftRef} onCommit={(v) => { draftRef.current = undefined; commit(editRow.id, editCol.id, v); }} onCancel={() => { draftRef.current = undefined; setEditing(undefined); }} />
        </Popover>
      )}
    </div>
  );
}

function CellEditor({ column, value, draftRef, onCommit, onCancel }: { readonly column: GridColumn; readonly value: string; readonly draftRef: { current: string | undefined }; readonly onCommit: (v: string) => void; readonly onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  if (column.type === 'select' || column.type === 'status') {
    return (
      <MenuList
        aria-label={column.name}
        autoFocus="first"
        selectionMode="single"
        selectedKeys={[value]}
        // The tick draws, then the editor closes ~120ms later.
        onSelectionChange={(keys) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) window.setTimeout(() => onCommit(String(k)), CLOSE_AFTER_PICK_MS); }}
        onClose={onCancel}
      >
        {(column.options ?? []).map((o) => <MenuItem key={o.id} id={o.id} textValue={o.label}><Tag size="sm" hue={o.hue} status={o.status}>{o.label}</Tag></MenuItem>)}
      </MenuList>
    );
  }
  return (
    <TextField aria-label={column.name} value={draft} onChange={(v) => { draftRef.current = v; setDraft(v); }} autoFocus className="tf-grid__field">
      <Input
        className="tf-grid__input"
        inputMode={column.type === 'number' ? 'decimal' : undefined}
        onKeyDown={(e) => { if (e.key === 'Enter') onCommit(draft.trim()); if (e.key === 'Escape') onCancel(); }}
      />
    </TextField>
  );
}

function renderValue(c: GridColumn, r: GridRecord): ReactNode {
  const v = r.values[c.id];
  // An empty cell stays blank: "—" is kept for chart and stat placeholders.
  if (v === undefined || v === '') return null;
  switch (c.type) {
    case 'name':
      return <span className="tf-grid__namecell"><PersonLine name={String(v)} shape={r.kind === 'person' ? 'round' : 'square'} size={20} />{r.isNew && <Tag size="sm" hue="blue">New</Tag>}</span>;
    case 'select':
    case 'status': {
      const o = c.options?.find((x) => x.id === v);
      return o ? <Tag size="sm" hue={o.hue} status={o.status}>{o.label}</Tag> : String(v);
    }
    case 'person':
      return <span className="tf-grid__person"><Avatar name={String(v)} size={20} />{String(v)}</span>;
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('en-US') : v;
    case 'date':
      return <span className="tf-grid__muted">{gridDate(v)}</span>;
    default:
      return String(v);
  }
}

/** A date cell's value ("2026-11-13", a timestamp or a Date string) worded once, through formatDate: "13 Nov". */
function gridDate(v: string | number): string {
  const ymd = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : formatDate(d);
}

/** True for one skeleton-reveal length after loading ends. */
function useReveal(isLoading: boolean): boolean {
  const was = useRef(isLoading);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => {
    if (was.current && !isLoading) {
      setRevealing(true);
      const t = window.setTimeout(() => setRevealing(false), REVEAL_MS);
      was.current = isLoading;
      return () => window.clearTimeout(t);
    }
    was.current = isLoading;
    return undefined;
  }, [isLoading]);
  return revealing;
}
