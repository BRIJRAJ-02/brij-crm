import {
  Button as AriaButton, Cell, Column, ColumnResizer, Input, ResizableTableContainer, Row, Table, TableBody, TableHeader, TextField,
  type Selection, type SortDescriptor,
} from 'react-aria-components';
import { useEffect, useRef, useState, type ClipboardEvent, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, EyeOff, ListFilter, Plus, Settings2 } from 'lucide-react';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Avatar, PersonLine } from '../Avatar/Avatar.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { Skeleton } from '../Motion/Motion.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Menu, MenuList, MenuItem, MenuSeparator, MenuTrigger, CLOSE_AFTER_PICK_MS } from '../Menu/Menu.tsx';
import { formatDate } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { AttributeDisplay, AttributeEditor, type Attribute, type AttributeValue } from '../AttributeField/AttributeField.tsx';
import './DataGrid.css';

/** What a column's header menu can do (Attio's column menu). */
export type ColumnAction = 'ascending' | 'descending' | 'filter' | 'hide' | 'edit';

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
  /** An attribute whose own field draws and edits the cell (a date picker, checkbox, rating, multi-select…). Its value is the cell's text, read by `toValue`. */
  readonly attribute?: Attribute;
}

/** A cell's text as an attribute's value: "true" ticks a checkbox, "a, b" picks two options, "4" is four stars, "2026-11-13" a date. */
export function cellToValue(a: Attribute, v: string | number | undefined): AttributeValue {
  const s = v === undefined ? '' : String(v);
  if (s === '') return a.type === 'checkbox' ? false : undefined;
  switch (a.type) {
    case 'number': case 'currency': case 'rating': return Number(s) || 0;
    case 'percent': return (Number(s) || 0) / 100;
    case 'checkbox': return s === 'true';
    case 'multiSelect': return s.split(/,\s*/).filter(Boolean);
    case 'location': { const [city = '', country = ''] = s.split(/,\s*/); return { city, country }; }
    case 'personalName': { const [first = '', ...rest] = s.split(' '); return { first, last: rest.join(' ') }; }
    default: return s;
  }
}
/** An attribute's value back as the cell's text. */
export function valueToCell(a: Attribute, v: AttributeValue): string {
  if (v === undefined || v === null) return '';
  if (a.type === 'checkbox') return v === true ? 'true' : '';
  if (a.type === 'percent' && typeof v === 'number') return String(Math.round(v * 100));
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (typeof v === 'object') { if ('city' in v) return [v.city, v.country].filter(Boolean).join(', '); if ('first' in v) return `${v.first} ${v.last}`.trim(); if ('name' in v) return String(v.name); return ''; }
  return String(v);
}

/** The footer row: a calculation per column, picked from a menu under it. */
export interface GridCalcs {
  /** What each column shows now ("Sum ₹48,20,000"); empty shows "Calculate". */
  readonly text: Readonly<Record<string, string>>;
  /** The choices a column offers. */
  readonly options: (columnId: string) => ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly current: Readonly<Record<string, string>>;
  readonly onChange: (columnId: string, kind: string) => void;
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
  /** A "+" at the end of the header that adds a field (Attio's add column); leave it out where fields are fixed. */
  readonly onAddColumn?: () => void;
  readonly addLabel?: string;
  readonly isLoading?: boolean;
  /** The one line shown where rows would be. */
  readonly emptyState?: ReactNode;
  /** A line under the rows: counts and sums for what's shown ("5 deals · ₹48,20,000 total"). */
  readonly summary?: ReactNode;
  /** Gives each header a menu: sort either way, filter by it, hide it (never the first column), edit its field. Leave out an action by not handling it. */
  readonly onColumnAction?: (columnId: string, action: ColumnAction) => void;
  /** Which actions the menu offers; all of them by default. */
  readonly columnActions?: ReadonlyArray<ColumnAction>;
  /** A footer row of calculations, one per column. */
  readonly calcs?: GridCalcs;
  /** Pasting from a spreadsheet into a focused cell: the cell where it starts and the pasted block, rows of cells. */
  readonly onPaste?: (rowId: string, columnId: string, block: ReadonlyArray<ReadonlyArray<string>>) => void;
  /** Delete or Backspace on a focused cell (not while editing): the consumer clears it, or that column on every selected row. */
  readonly onClear?: (rowId: string, columnId: string) => void;
  /** Column widths after a drag, by column id, so a view can keep them. */
  readonly onColumnResize?: (widths: Readonly<Record<string, number>>) => void;
  /** Hides the header row: for groups under the first, which line up with its columns. */
  readonly hideHeader?: boolean;
  /** Off for a read-only report table (an admin list): no checkboxes, rows only open. */
  readonly isSelectable?: boolean;
}

const SKELETON_ROWS = ['sk1', 'sk2', 'sk3', 'sk4', 'sk5'];
const CALC_ROW = '__calc';
const EDITABLE: ReadonlySet<GridColumnType> = new Set(['name', 'text', 'number', 'select', 'status']);
const REVEAL_MS = 400; // --duration-slow, transitions.dev 14 skeleton reveal
const WASH_MS = 1000;

type Editing = { readonly rowId: string; readonly colId: string; readonly anchor: HTMLElement };

/** The record table: pinned name, sortable and resizable columns, checkbox selection, inline edits, skeleton loading. Replaces DataGrid, Table and SampleTable. */
export function DataGrid({ onColumnAction, columnActions, onAddColumn, label, columns, rows, sortDescriptor, onSortChange, selectedKeys, onSelectionChange, onCellChange, onRowAction, onAddRow, addLabel = 'New record', isLoading = false, emptyState, summary, calcs, onPaste, onClear, onColumnResize, hideHeader = false , isSelectable = true }: DataGridProps) {
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [calcMenu, setCalcMenu] = useState<{ readonly colId: string; readonly anchor: HTMLElement }>();
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
  const cellAt = (el: Element | null): readonly [string, string] | undefined => {
    const td = el?.closest('td'); const key = td?.querySelector<HTMLElement>('[data-cell]')?.dataset.cell ?? '';
    const [rowId, colId] = key.split('|'); return rowId && colId ? [rowId, colId] : undefined;
  };
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (editing) return;
    const active = document.activeElement;
    if ((e.key === 'Delete' || e.key === 'Backspace') && active?.tagName === 'TD' && onClear) { const at = cellAt(active); const col = columns.find((c) => c.id === at?.[1]); if (at && col && !col.isReadOnly) { e.preventDefault(); onClear(at[0], at[1]); } return; }
    if (e.key !== 'Enter') return;
    if (active?.tagName === 'TD' && open(active)) { e.preventDefault(); e.stopPropagation(); }
  };
  const paste = (e: ClipboardEvent) => {
    if (!onPaste || editing) return;
    const at = cellAt(document.activeElement); if (!at) return;
    const text = e.clipboardData.getData('text/plain'); if (!text) return;
    e.preventDefault();
    onPaste(at[0], at[1], text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((line) => line.split('\t')));
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
    <div ref={wrapRef} className={cx('tf-grid', revealing && 'tf-grid--revealing', hideHeader && 'tf-grid--headless', !isSelectable && 'tf-grid--plain')} onKeyDownCapture={onKeyDownCapture} onPaste={paste} aria-busy={isLoading || undefined}>
      <ResizableTableContainer className="tf-grid__scroll" onResizeEnd={onColumnResize ? (m) => onColumnResize(Object.fromEntries([...m].filter(([, w]) => typeof w === 'number').map(([k, w]) => [String(k), Number(w)]))) : undefined}>
        <Table
          aria-label={label}
          className="tf-grid__table"
          selectionMode={isSelectable ? 'multiple' : 'none'}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          onRowAction={(k) => { if (k !== CALC_ROW) onRowAction?.(String(k)); }}
          sortDescriptor={sortDescriptor}
          onSortChange={onSortChange}
          disabledKeys={isLoading ? SKELETON_ROWS : calcs ? [CALC_ROW] : undefined}
          disabledBehavior="selection"
        >
          <TableHeader className="tf-grid__head">
            {isSelectable ? <Column width={44} minWidth={44} className="tf-grid__th tf-grid__th--check">
              <Checkbox slot="selection" />
            </Column> : null}
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
                    {onColumnAction && (
                      <MenuTrigger>
                        <AriaButton className="tf-grid__thmenu" aria-label={`${c.name} column options`}><ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" /></AriaButton>
                        <Menu placement="bottom start" aria-label={`${c.name} column`} onAction={(k) => onColumnAction(c.id, String(k) as ColumnAction)}
                          disabledKeys={[...((c.isSortable ?? true) ? [] : ['ascending', 'descending']), ...(i === 0 ? ['hide'] : [])]}>
                          {menuFor(columnActions).map((a) => a === 'sep' ? <MenuSeparator key="sep" /> : <MenuItem key={a.id} id={a.id} icon={<a.icon size={16} strokeWidth={1.75} />}>{a.label}</MenuItem>)}
                        </Menu>
                      </MenuTrigger>
                    )}
                    <ColumnResizer className="tf-grid__resizer" />
                  </div>
                )}
              </Column>
            ))}
            {onAddColumn ? <Column width={52} minWidth={52} className="tf-grid__th tf-grid__th--add"><Tooltip label="Add a field"><IconButton size="sm" label="Add a field" onPress={onAddColumn}><Plus size={14} strokeWidth={1.75} /></IconButton></Tooltip></Column> : null}
          </TableHeader>
          <TableBody className="tf-grid__body" renderEmptyState={() => <div className="tf-grid__empty">{emptyState ?? 'No records'}</div>}>
            {shown.map((r, ri) => (
              <Row key={r.id} id={r.id} className={cx('tf-grid__row', washed.has(r.id) && 'is-changed')}>
                {isSelectable ? <Cell className="tf-grid__td tf-grid__td--check">
                  {isLoading ? <Skeleton width={18} height={18} /> : <Checkbox slot="selection" />}
                </Cell> : null}
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
                        data-cell={`${r.id}|${c.id}`}
                        data-edit={!c.isReadOnly && (EDITABLE.has(c.type) || c.attribute) ? `${r.id}|${c.id}` : undefined}
                        onDoubleClick={(e) => { if (!c.isReadOnly && (EDITABLE.has(c.type) || c.attribute)) open(e.currentTarget); }}
                      >
                        <span className="tf-grid__content">{renderValue(c, r)}</span>
                        {revealing && <span className="tf-grid__ghost" aria-hidden="true"><Skeleton width="60%" height={12} /></span>}
                      </div>
                    )}
                  </Cell>
                ))}
                {onAddColumn ? <Cell className="tf-grid__td tf-grid__td--add">{''}</Cell> : null}
              </Row>
            ))}
            {calcs && !isLoading && rows.length > 0 ? (
              <Row key={CALC_ROW} id={CALC_ROW} className="tf-grid__row tf-grid__calcrow">
                {isSelectable ? <Cell className="tf-grid__td tf-grid__td--check">{''}</Cell> : null}
                {columns.map((c, i) => (
                  <Cell key={c.id} textValue={calcs.text[c.id] || 'Calculate'} className={cx('tf-grid__td', 'tf-grid__td--calc', i === 0 && 'tf-grid__td--pin', c.type === 'number' && 'tf-grid__td--num')}>
                    <AriaButton className={cx('tf-grid__calc', calcs.text[c.id] && 'is-set')} aria-label={`${c.name}: ${calcs.text[c.id] || 'no calculation'}. Change`} aria-haspopup="menu" aria-expanded={calcMenu?.colId === c.id}
                      onPress={(e) => setCalcMenu({ colId: c.id, anchor: e.target as HTMLElement })}>{calcs.text[c.id] || 'Calculate'}<ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" /></AriaButton>
                  </Cell>
                ))}
                {onAddColumn ? <Cell className="tf-grid__td tf-grid__td--add">{''}</Cell> : null}
              </Row>
            ) : null}
          </TableBody>
        </Table>
      </ResizableTableContainer>
      {summary !== undefined && !isLoading && rows.length > 0 && <div className="tf-grid__summary tf-num" aria-live="polite">{summary}</div>}
      {onAddRow && !isLoading && (
        <AriaButton className="tf-grid__add" onPress={addRow}><Plus size={14} strokeWidth={1.75} />{addLabel}</AriaButton>
      )}
      {calcs && calcMenu && (
        <Popover triggerRef={{ current: calcMenu.anchor }} isOpen placement="top start" width="menu" onOpenChange={(o) => { if (!o) setCalcMenu(undefined); }}>
          <MenuList aria-label={`Calculate ${columns.find((c) => c.id === calcMenu.colId)?.name ?? ''}`} autoFocus="first" selectionMode="single" selectedKeys={[calcs.current[calcMenu.colId] ?? 'none']} onClose={() => setCalcMenu(undefined)}
            onSelectionChange={(keys) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) { calcs.onChange(calcMenu.colId, String(k)); window.setTimeout(() => setCalcMenu(undefined), CLOSE_AFTER_PICK_MS); } }}>
            {calcs.options(calcMenu.colId).map((o) => <MenuItem key={o.id} id={o.id}>{o.label}</MenuItem>)}
          </MenuList>
        </Popover>
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
          offset={-editing.anchor.getBoundingClientRect().height}
          className="tf-grid__editor"
          {...((editCol.type === 'select' || editCol.type === 'status') && !editCol.attribute ? {} : { label: `Edit ${editCol.name}` })}
        >
          {editCol.attribute ? (
            <div className="tf-grid__attr">
              <AttributeEditor attribute={editCol.attribute} value={cellToValue(editCol.attribute, editRow.values[editCol.id])} autoFocus
                onCommit={(v) => { draftRef.current = undefined; commit(editRow.id, editCol.id, valueToCell(editCol.attribute ?? { id: '', name: '', type: 'text' }, v)); }} onCancel={() => { draftRef.current = undefined; setEditing(undefined); }} />
            </div>
          ) : <CellEditor column={editCol} value={String(editRow.values[editCol.id] ?? '')} draftRef={draftRef} onCommit={(v) => { draftRef.current = undefined; commit(editRow.id, editCol.id, v); }} onCancel={() => { draftRef.current = undefined; setEditing(undefined); }} />}
        </Popover>
      )}
    </div>
  );
}

/** The column menu's items in Attio's order, with a rule between sorting and the rest. */
const COLUMN_ITEMS: ReadonlyArray<{ readonly id: ColumnAction; readonly label: string; readonly icon: ComponentType<{ size?: number; strokeWidth?: number }> }> = [
  { id: 'ascending', label: 'Sort ascending', icon: ArrowUp }, { id: 'descending', label: 'Sort descending', icon: ArrowDown },
  { id: 'filter', label: 'Filter by this', icon: ListFilter }, { id: 'hide', label: 'Hide column', icon: EyeOff }, { id: 'edit', label: 'Edit field', icon: Settings2 },
];
function menuFor(only?: ReadonlyArray<ColumnAction>) {
  const items = COLUMN_ITEMS.filter((a) => !only || only.includes(a.id));
  const sorts = items.filter((a) => a.id === 'ascending' || a.id === 'descending'); const rest = items.filter((a) => a.id !== 'ascending' && a.id !== 'descending');
  return [...sorts, ...(sorts.length && rest.length ? ['sep' as const] : []), ...rest];
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
  if (c.attribute && c.type !== 'name') { const value = cellToValue(c.attribute, v); return c.attribute.type === 'checkbox' || (v !== undefined && v !== '') ? <AttributeDisplay attribute={c.attribute} value={value} asLink={false} maxVisible={2} /> : null; }
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
