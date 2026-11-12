// Records: People, Companies, Deals and every object an owner made. One toolbar (view, Table/Board, search, filters and sorts, Import/Export,
// New), a table you edit in place (group rows, footer calculations, paste a block, clear with Undo, reorder and resize columns) or a board
// grouped by any status or select, bulk edits with Undo, and a record panel beside the list. A changed view is a draft: Save it or Discard it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../Link/Link.tsx';
import type { Selection, SortDescriptor } from 'react-aria-components';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Download, Eye, LayoutGrid, LayoutList, Link2, ListChecks, ListPlus, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Star, Trash2, Upload, UserRound, Users } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';
import { DataGrid, type ColumnAction, type GridColumn, type GridRecord } from '../DataGrid/DataGrid.tsx';
import { Board, type BoardColumn } from '../Board/Board.tsx';
import { FilterBar, type FilterField, type FilterRule, type ViewColumn } from '../FilterBar/FilterBar.tsx';
import { BulkActionBar, BarButton } from '../FloatingBar/FloatingBar.tsx';
import { RecordPanel, AttributeRow, RecordSection } from '../RecordPanel/RecordPanel.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { ConfirmDialog } from '../Dialog/Dialog.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { duplicatesFor } from './duplicates.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { copyText } from '../../lib/copy.ts';
import { cx } from '../../lib/cx.ts';
import type { Attribute } from '../AttributeField/AttributeField.tsx';
import { liveEntries, inr, isBuiltIn, newId, type AppAction, type AppState, type CalcKind, type Deal, type ObjectId, type SavedView, type Stage, type ViewAccess, LISTS_ON } from './data.ts';
import { STAGE_LOOK, requiredProblem, beforeOf, blankCustom, calcText, calcsFor, dayOf, filterFields, groupableFields, groupsOf, isOpenDeal, kindOf, kindsOf, liveAttributes, objectDef, oddsOf, ownFields, passesView, patchFor, recordOf, schemaOf, staleAfter, stagesOf, wordsOf, ymd, type FieldDef } from './model.tsx';
import { ACCESS_WORDS, BulkEditDialog, NewRecordDialog, RenameDialog, ViewAccessDialog, ViewNamer, attributeOf, fieldValue } from './recordforms.tsx';
import { valueToCell } from '../DataGrid/DataGrid.tsx';

export { objectDef, customColumns } from './model.tsx';
export { RenameDialog } from './recordforms.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Records can be changed, except while previewing as another role: a preview never changes anything. */
export const canEditRecords = (state: AppState) => !state.previewRole;
/** A private view: only its maker sees it. */
export const isPrivateView = (v: SavedView) => v.access === 'private' || (v.access === undefined && v.isPrivate === true);
/** An object's saved views: an owner-made object starts with one, "All <many>". */
export function viewsOf(state: AppState, object: ObjectId): ReadonlyArray<SavedView> {
  return state.views[object] ?? [{ id: `v-${object}-all`, name: `All ${wordsOf(state, object).many}`, layout: 'table', filters: [], sorts: [], hidden: [], access: 'everyone' }];
}
/** Views this person sees: shared ones, and their own private ones. */
export const visibleViews = (state: AppState, object: ObjectId) => viewsOf(state, object).filter((v) => !isPrivateView(v) || (v.createdBy ?? state.me) === state.me);
const isAdmin = (state: AppState) => { const r = state.members.find((m) => m.name === state.me)?.role; return r === 'Owner' || r === 'Admin'; };

/** Props for RecordsScreen. */
export interface RecordsScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly object: ObjectId;
  /** Opens a record's full page. */
  readonly onOpen: (object: ObjectId, id: string) => void;
  /** Open the import and the duplicates review. */
  readonly onImport?: () => void;
  readonly onDuplicates?: () => void;
  /** Opens with the New dialog, its name filled in (⌘K "Create person ‘Ana’"). */
  readonly startNew?: string;
  /** Opens on this saved view (⌘K). */
  readonly startView?: string;
  /** Opens the New view dialog (⌘K "Create a view"). */
  readonly startNaming?: boolean;
  /** Settings › Objects, to add or change this object's attributes. */
  readonly onAttributes?: () => void;
  /** Settings › Trash, showing this object's deleted records. */
  readonly onTrash?: () => void;
  /** Reports the view on screen, so ⌘K "Export this view" knows it. */
  readonly onExportReady?: (exportView: () => void) => void;
}

/** One object's records. */
export function RecordsScreen({ state, dispatch, object, onOpen, onImport, onDuplicates, startNew, startView, startNaming = false, onAttributes, onTrash, onExportReady }: RecordsScreenProps) {
  const { toast } = useToast();
  const def = objectDef(object, state);
  const w = wordsOf(state, object);
  const canEdit = canEditRecords(state);
  const allViews = viewsOf(state, object);
  const views = visibleViews(state, object);
  // A board card's place inside its lane, set by dropping it there (used while the view has no sort).
  const [rank, setRank] = useState<Readonly<Record<string, number>>>({});
  const [viewId, setViewId] = useState(startView && views.some((v) => v.id === startView) ? startView : views[0]?.id ?? '');
  const saved = views.find((v) => v.id === viewId) ?? views[0];
  const [draft, setDraft] = useState<SavedView | undefined>();
  const view = draft ?? saved;
  const [query, setQueryRaw] = useState('');
  const [selected, setSelected] = useState<Selection>(new Set());
  /** A new search or filter clears the selection, so nothing hidden stays picked. */
  const setQuery = (v: string) => { setQueryRaw(v); setSelected(new Set()); };
  const [peek, setPeek] = useState<string>();
  const [creating, setCreating] = useState<Readonly<Record<string, string>> | undefined>(startNew !== undefined ? {} : undefined);
  const [naming, setNaming] = useState(startNaming);
  const [renaming, setRenaming] = useState(false);
  const [accessFor, setAccessFor] = useState<SavedView>();
  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulkDelete, setBulkDelete] = useState<ReadonlyArray<string>>();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [foldedRows, setFoldedRows] = useState<ReadonlySet<string>>(new Set());
  const [startFilter, setStartFilter] = useState<{ readonly field: string; readonly seq: number } | undefined>();
  /** Cell edits made here, newest last: ⌘Z takes back the latest batch (one edit, a paste, a clear). */
  const edits = useRef<Array<ReadonlyArray<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }>>>([]);
  const all = useMemo(() => def.rows(state), [state, object]); // eslint-disable-line react-hooks/exhaustive-deps
  // Duplicate pairs only change when the records do, not on every keystroke.
  const pairCount = useMemo(() => (!onDuplicates ? 0 : duplicatesFor(state, object, new Set(state.notDupes)).length), [state.people, state.companies, state.deals, state.customRecords, state.notDupes, object, onDuplicates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || document.querySelector('[role="dialog"][aria-modal="true"], .tf-scrim')) return;
      const t = e.target as HTMLElement | null; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
      const last = edits.current.pop(); if (!last) return;
      e.preventDefault(); dispatch({ type: 'records/fields', object, changes: last }); toast({ message: 'Edit undone' });
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [object]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldsAll = useMemo(() => filterFields(state, object), [state.objects, state.companies, state.members, object]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = ownFields(state, object);
  const kinds = kindsOf(fieldsAll);
  const q = query.trim().toLowerCase();
  const rows = view ? all.filter((r) => passesView(r.values, kinds, view.filters, view.groups, view.match) && (!q || Object.entries(r.values).some(([k, v]) => !k.includes('.') && String(v ?? '').toLowerCase().includes(q)))) : all;
  const sorted = view ? [...rows].sort((a, b) => {
    for (const s of view.sorts) {
      const x = a.values[s.field] ?? ''; const y = b.values[s.field] ?? '';
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return s.direction === 'ascending' ? c : -c;
    }
    return 0;
  }) : rows;
  useEffect(() => { onExportReady?.(() => { void exportCsv(); }); }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null;
  // A guest sees only what's shared with them; nothing is yet in the prototype.
  if (state.previewRole === 'Guest') return <div className="tf-app__empty"><EmptyState icon={<Users size={20} strokeWidth={1.75} />} title={`No ${def.many} shared with you`} description={`As a guest you see only lists and records someone shares with you. Ask an admin of ${state.prefs.workspace.name} to share one.`} /></div>;
  const edit = (patch: Partial<SavedView>) => { setDraft({ ...view, ...patch }); if (patch.filters || patch.groups) setSelected(new Set()); };
  /** Can this person save changes over the view? Locked views and admin-only views can't be. */
  const canSave = (v: SavedView) => !v.locked && (v.access !== 'admins' || isAdmin(state));
  const setViews = (next: ReadonlyArray<SavedView>) => dispatch({ type: 'views/set', object, views: next });
  // The header's column menu (Attio): sort, filter by it, hide it with Undo, or change the field in Settings.
  const columnAction = (id: string, a: ColumnAction) => {
    if (a === 'ascending' || a === 'descending') { edit({ sorts: [{ field: id, direction: a }] }); return; }
    if (a === 'filter') { setStartFilter((f) => ({ field: id, seq: (f?.seq ?? 0) + 1 })); return; }
    if (a === 'edit') { onAttributes?.(); return; }
    const was = view.hidden; const name = def.columns.find((c) => c.id === id)?.name ?? 'Column';
    edit({ hidden: [...was, id] }); toast({ message: `${name} hidden. Show it again from View.`, action: { label: 'Undo', onAction: () => edit({ hidden: was }) } });
  };
  // Columns in the view's order, at the widths someone dragged them to.
  const ordered: ReadonlyArray<GridColumn> = [...(view.order ?? []).map((id) => def.columns.find((c) => c.id === id)).filter((c): c is GridColumn => c !== undefined), ...def.columns.filter((c) => !(view.order ?? []).includes(c.id))]
    .sort((a, b) => (a.id === 'name' ? -1 : b.id === 'name' ? 1 : 0)).map((c) => (view.widths?.[c.id] ? { ...c, width: view.widths[c.id] } : c));
  const columns = ordered.filter((c) => !view.hidden.includes(c.id));
  const ids = selected === 'all' ? sorted.map((r) => r.id) : [...selected].map(String).filter((id) => sorted.some((r) => r.id === id));
  const fields: ReadonlyArray<FilterField> = fieldsAll.map((f) => ({ id: f.id, name: f.name, section: f.via, type: kindOf(f.type),
    options: f.type === 'actor' ? state.members.map((m) => ({ id: m.name, label: m.name })) : f.options?.filter((o) => o.id !== '').map((o) => ({ id: o.id, label: o.label, hue: o.hue, status: o.status })) }));
  const viewColumns: ReadonlyArray<ViewColumn> = ordered.map((c) => ({ id: c.id, name: c.name, isShown: !view.hidden.includes(c.id), isLocked: c.id === 'name' }));

  /** Writes typed values to records in one go; ⌘Z or the toast's Undo puts back only what changed. */
  const write = (changes: ReadonlyArray<{ readonly id: string; readonly col: string; readonly value: string }>, message?: string): number => {
    if (!canEdit) return 0;
    const byId = new Map<string, { patch: Record<string, unknown>; before: Record<string, unknown> }>();
    let n = 0;
    for (const c of changes) {
      const rec = recordOf(state, object, c.id); if (!rec) continue;
      if (c.col === 'email' && c.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.value.trim())) { toast({ message: `“${c.value}” isn’t an email address. Nothing changed.`, tone: 'danger' }); return 0; }
      if (c.col === 'name' && !c.value.trim()) { toast({ message: 'A name can’t be empty. Nothing changed.', tone: 'danger' }); return 0; }
      const patch = patchFor(state, object, rec, c.col, c.value); if (!patch) continue;
      const needs = requiredProblem(state, object, rec, c.col, c.value);
      if (needs) { toast({ message: `${changes.length > 1 ? `${rec.name}: ` : ''}${needs} Nothing changed.`, tone: 'danger' }); return 0; }
      const cur = byId.get(c.id) ?? { patch: {}, before: {} };
      const before = beforeOf(rec, patch);
      const merged = { ...cur.patch, ...patch, ...(patch.extra ? { extra: { ...(cur.patch.extra as object | undefined), ...(patch.extra as object) } } : {}) };
      const mergedBefore = { ...before, ...cur.before, ...(before.extra ? { extra: { ...(before.extra as object), ...(cur.before.extra as object | undefined) } } : {}) };
      byId.set(c.id, { patch: merged, before: mergedBefore }); n++;
    }
    if (byId.size === 0) return 0;
    const was = [...byId].map(([id, x]) => ({ id, patch: x.before }));
    edits.current.push(was);
    dispatch({ type: 'records/fields', object, changes: [...byId].map(([id, x]) => ({ id, patch: x.patch })) });
    if (message) toast({ message: message.replace('{n}', String(n)), action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: was }) } });
    return n;
  };
  const setCell = (rowId: string, col: string, value: string) => { write([{ id: rowId, col, value }]); };
  /** A pasted block lands from the focused cell down and right, over the rows and columns as they're shown. Choices match by name. */
  const paste = (list: ReadonlyArray<GridRecord>) => (rowId: string, colId: string, block: ReadonlyArray<ReadonlyArray<string>>) => {
    const r0 = list.findIndex((r) => r.id === rowId); const c0 = columns.findIndex((c) => c.id === colId); if (r0 < 0 || c0 < 0) return;
    const changes = block.flatMap((cells, i) => { const row = list[r0 + i]; if (!row) return []; return cells.map((raw, j) => {
      const col = columns[c0 + j]; if (!col || col.isReadOnly) return undefined;
      const v = raw.trim();
      const opt = col.options?.find((o) => o.label.toLowerCase() === v.toLowerCase() || o.id === v);
      const member = state.members.find((m) => m.name.toLowerCase() === v.toLowerCase() || m.name.split(' ')[0]?.toLowerCase() === v.toLowerCase());
      const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
      const value = col.type === 'person' ? member?.name ?? v : opt ? opt.id : col.type === 'date' && dmy ? `${dmy[3]}-${dmy[2]?.padStart(2, '0')}-${dmy[1]?.padStart(2, '0')}` : v;
      return { id: row.id, col: col.id, value };
    }).filter((x): x is { readonly id: string; readonly col: string; readonly value: string } => x !== undefined); });
    const n = write(changes, 'Pasted {n} cells');
    if (n === 0 && changes.length) toast({ message: 'Nothing pasted: those cells don’t take what was copied.' });
  };
  /** Delete on a cell clears it; with rows selected, it clears that column on each of them. */
  const clear = (rowId: string, colId: string) => {
    if (colId === 'name') { toast({ message: 'A name can’t be empty.' }); return; }
    const targets = ids.includes(rowId) && ids.length > 1 ? ids : [rowId];
    const n = write(targets.map((id) => ({ id, col: colId, value: '' })), targets.length === 1 ? 'Cleared' : `Cleared ${def.columns.find((c) => c.id === colId)?.name ?? 'the field'} on {n} ${def.many}`);
    const refused = targets.some((id) => { const rec = recordOf(state, object, id); return rec !== undefined && requiredProblem(state, object, rec, colId, '') !== undefined; });
    if (n === 0 && !refused) toast({ message: `${def.columns.find((c) => c.id === colId)?.name ?? 'That field'} can’t be empty.` });
  };
  /** Sets one field on many records; Undo puts back only that field, so later edits stay. */
  const setMany = (rowIds: ReadonlyArray<string>, col: string, value: string, message: string) => write(rowIds.map((id) => ({ id, col, value })), message);
  const exportCsv = async (only?: ReadonlyArray<string>, everyColumn = false) => {
    const pick = only ? sorted.filter((r) => only.includes(r.id)) : sorted;
    const cols = everyColumn ? ordered : columns;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c.name)).join(','), ...pick.map((r) => cols.map((c) => esc(r.values[c.id])).join(','))].join('\n');
    const o = await saveFile(`${def.many}.csv`, new Blob([csv], { type: 'text/csv' }));
    if (o === 'saved') { toast({ message: `${pick.length} ${pick.length === 1 ? def.one : def.many} exported`, tone: 'success' });
      dispatch({ type: 'prefs/update', fn: (q2) => ({ jobs: [{ id: newId('jb'), kind: 'export' as const, what: `${w.Many} · ${view.name}`, rows: pick.length, by: state.me, at: new Date(), file: csv, name: `${def.many}.csv`, object }, ...(q2.jobs ?? [])].slice(0, 20) }) }); }
  };

  // Board: grouped by any status, select or owner field. Dragging a card sets that field.
  // Cards keep the place they are dropped in while the view has no sort (a sort decides the order otherwise).
  const handOrder = !view?.sorts.length;
  const rankOf = (rows: ReadonlyArray<{ readonly id: string }>) => (id: string): number => rank[id] ?? rows.findIndex((r) => r.id === id);
  const inHandOrder = <T extends { readonly id: string }>(rows: ReadonlyArray<T>): ReadonlyArray<T> => {
    if (!handOrder) return rows;
    const r = rankOf(rows);
    return [...rows].sort((a, b) => r(a.id) - r(b.id));
  };
  const groupables = groupableFields(state, object);
  const defaultGroup = object === 'deals' ? 'stage' : object === 'companies' ? 'industry' : object === 'people' ? 'owner' : groupables.find((f) => f.type === 'status' || f.type === 'select')?.id ?? 'owner';
  const boardField = groupables.find((f) => f.id === (view.groupBy ?? defaultGroup)) ?? groupables.find((f) => f.id === defaultGroup) ?? own.find((f) => f.id === 'owner');
  const numberFields = own.filter((f) => kindOf(f.type) === 'number');
  const sumField = view.boardSum === 'none' ? undefined : numberFields.find((f) => f.id === (view.boardSum ?? (object === 'deals' ? 'amount' : '')));
  const cardChoices = own.filter((f) => f.id !== 'name' && f.id !== boardField?.id);
  const cardDefault = object === 'deals' ? ['company', 'amount', 'inStage', 'close', 'owner'] : object === 'people' ? ['title', 'company', 'owner'] : object === 'companies' ? ['domain', 'city', 'owner'] : cardChoices.slice(0, 2).map((f) => f.id).concat('owner');
  const cardFields = view.cardFields ?? cardDefault;
  const cell = (f: FieldDef | undefined, v: unknown): string => (v === undefined || v === '' || !f ? '' : f.money ? inr(Number(v)) : f.options ? f.options.find((o) => o.id === v)?.label ?? String(v) : String(v));
  const boardGroups = boardField ? groupsOf(boardField.id === 'owner' ? { ...boardField, options: state.members.map((m) => ({ id: m.name, label: m.name })) } : boardField, sorted) : [];
  const board: ReadonlyArray<BoardColumn> = boardGroups.filter((g) => !view.hideEmpty || g.rows.length > 0).map((g) => {
    const sum = sumField ? g.rows.reduce((n, r) => n + (Number(r.values[sumField.id]) || 0), 0) : 0;
    const wsum = object === 'deals' && sumField?.id === 'amount' ? g.rows.reduce((n, r) => n + Number(r.values.weighted ?? 0), 0) : 0;
    const look = boardField?.id === 'stage' ? STAGE_LOOK[g.id as Stage] : undefined;
    return { id: g.id, title: g.label, status: look?.status ?? g.status ?? 'draft', hue: look?.hue ?? g.hue ?? 'gray', isCollapsed: folded.has(g.id),
      meta: sumField && sum ? (wsum && wsum !== sum ? `${cell(sumField, sum)} · ${inr(wsum)} weighted` : cell(sumField, sum)) : undefined,
      cards: inHandOrder(g.rows).map((r) => {
        const d = object === 'deals' ? state.deals.find((x) => x.id === r.id) : undefined;
        const open = d && isOpenDeal(state, d); const days = Number(r.values.inStage ?? 0);
        const parts = cardFields.filter((id) => id !== 'owner' && id !== 'close').map((id) => (id === 'inStage' && d ? (open ? `${days}d in ${d.stage}` : '') : cell(own.find((f) => f.id === id), r.values[id]))).filter(Boolean);
        return { id: r.id, title: String(r.values.name), description: parts.join(' · '), people: cardFields.includes('owner') && r.values.owner ? [String(r.values.owner)] : [], date: cardFields.includes('close') && d ? d.close : undefined,
          tags: open && d && days > staleAfter(state, d.stage) ? [{ label: `Stale · no move in ${days}d`, hue: 'orange' as const }] : undefined };
      }) };
  });
  const peekIndex = peek ? sorted.findIndex((r) => r.id === peek) : -1;
  const peekGone = peek !== undefined && !all.some((r) => r.id === peek);
  const shownRows = (list: ReadonlyArray<GridRecord>) => list.map((r) => (fresh.has(r.id) ? { ...r, isNew: true } : r));
  const total = object === 'deals' ? sorted.reduce((n, r) => n + Number(r.values.amount ?? 0), 0) : 0;
  const summary = `${sorted.length === all.length ? `${sorted.length}` : `${sorted.length} of ${all.length}`} ${sorted.length === 1 ? def.one : def.many}${object === 'deals' ? ` · ${inr(total)} total · ${inr(sorted.reduce((n, r) => n + Number(r.values.weighted ?? 0), 0))} weighted · ${inr(sorted.length ? Math.round(total / sorted.length) : 0)} average` : ''}`;
  const others = views.filter((v) => v.id !== view.id);
  /** After a bulk action the floating bar leaves; focus goes back to the table so keyboard use carries on. */
  const refocus = () => window.requestAnimationFrame(() => { if (document.activeElement === document.body) document.querySelector<HTMLElement>('.tf-rec__grid [role="grid"]')?.focus(); });
  const calcs = (list: ReadonlyArray<GridRecord>) => ({
    text: Object.fromEntries(columns.map((c) => [c.id, calcText(view.calcs?.[c.id] ?? 'none', own.find((f) => f.id === c.id), list, c.id)])),
    current: Object.fromEntries(columns.map((c) => [c.id, view.calcs?.[c.id] ?? 'none'])),
    options: (id: string) => calcsFor(kindOf(own.find((f) => f.id === id)?.type ?? 'text')),
    onChange: (id: string, k: string) => edit({ calcs: { ...(view.calcs ?? {}), [id]: k as CalcKind } }),
  });
  const rowGroup = groupables.find((f) => f.id === view.rowGroup);
  const tableGroups = rowGroup ? groupsOf(rowGroup.id === 'owner' ? { ...rowGroup, options: state.members.map((m) => ({ id: m.name, label: m.name })) } : rowGroup, sorted).filter((g) => g.rows.length > 0) : [];
  const empty = q || view.filters.length || (view.groups ?? []).length ? <span>No {def.many} match. <Link onPress={() => { setQuery(''); if (view.filters.length || (view.groups ?? []).length) edit({ filters: [], groups: [] }); }}>{view.filters.length || (view.groups ?? []).length ? 'Clear filters' : 'Clear search'}</Link></span> : <span>No {def.many} yet.{canEdit ? <>{' '}<Link onPress={() => setCreating({})}>Add one</Link>{onImport ? <> or <Link onPress={() => onImport()}>import a CSV</Link></> : null}.</> : null}</span>;
  const grid = (list: ReadonlyArray<GridRecord>, opts: { readonly hideHeader?: boolean; readonly summary?: string } = {}) => (
    <DataGrid onAddColumn={canEdit && onAttributes ? onAttributes : undefined} label={def.many} columns={columns} rows={shownRows(list)} selectedKeys={selected} onSelectionChange={setSelected} summary={opts.summary}
      sortDescriptor={view.sorts[0] ? { column: view.sorts[0].field, direction: view.sorts[0].direction } : undefined} hideHeader={opts.hideHeader}
      onSortChange={(d: SortDescriptor) => edit({ sorts: [{ field: String(d.column), direction: d.direction }] })}
      onColumnAction={columnAction} columnActions={onAttributes && canEdit ? undefined : ['ascending', 'descending', 'filter', 'hide']}
      onCellChange={canEdit ? setCell : undefined} validateCell={canEdit ? (rowId, col, value) => { const rec = recordOf(state, object, rowId); return rec ? requiredProblem(state, object, rec, col, value) : undefined; } : undefined} onRowAction={setPeek} onAddRow={canEdit && !rowGroup ? () => { setCreating({}); return undefined; } : undefined} addLabel={`New ${def.one}`}
      calcs={!rowGroup || Object.values(view.calcs ?? {}).some((k) => k !== 'none') ? calcs(list) : undefined} onPaste={canEdit ? paste(list) : undefined} onClear={canEdit ? clear : undefined}
      onColumnResize={(wd) => edit({ widths: { ...(view.widths ?? {}), ...wd } })}
      emptyState={empty} />
  );
  const sharedViews = views.filter((v) => !isPrivateView(v)); const privateViews = views.filter(isPrivateView);
  const viewItem = (v: SavedView) => <MenuItem key={v.id} id={v.id} icon={v.locked ? <Lock {...i16} /> : undefined} description={[views[0]?.id === v.id ? 'Opens first' : '', v.access === 'admins' ? 'Only admins edit' : ''].filter(Boolean).join(' · ') || undefined}>{v.name}</MenuItem>;
  const moveView = (dir: -1 | 1) => { const at = allViews.findIndex((v) => v.id === view.id); const to = at + dir; if (at < 0 || to < 0 || to >= allViews.length) return; const next = [...allViews]; const [x] = next.splice(at, 1); if (x) next.splice(to, 0, x); setViews(next); toast({ message: `${view.name} moved ${dir < 0 ? 'up' : 'down'}`, action: { label: 'Undo', onAction: () => setViews(allViews) } }); };
  const viewOptions = view.layout === 'board' ? (
    <>
      <Select label="Columns by" value={boardField?.id ?? null} onChange={(v) => v && edit({ groupBy: v })} items={groupables.map((f) => ({ id: f.id, label: f.name }))} />
      <Select label="Show total of" value={sumField?.id ?? 'none'} onChange={(v) => edit({ boardSum: v ?? 'none' })} items={[{ id: 'none', label: 'Nothing' }, ...numberFields.map((f) => ({ id: f.id, label: f.name }))]} />
      <fieldset className="tf-rec__cardfields"><legend>Cards show</legend>
        {cardChoices.map((f) => <Checkbox key={f.id} isSelected={cardFields.includes(f.id)} onChange={(on) => edit({ cardFields: on ? [...cardFields, f.id] : cardFields.filter((x) => x !== f.id) })}>{f.name}</Checkbox>)}
      </fieldset>
      <Switch isSelected={!view.hideEmpty} onChange={(on) => edit({ hideEmpty: !on })}>Show empty columns</Switch>
    </>
  ) : (
    <Select label="Group rows by" value={view.rowGroup ?? 'none'} onChange={(v) => edit({ rowGroup: v && v !== 'none' ? v : undefined })} items={[{ id: 'none', label: 'No grouping' }, ...groupables.map((f) => ({ id: f.id, label: f.name }))]} />
  );

  return (
    <div className="tf-rec">
      <div className="tf-rec__main">
      <div className="tf-rec__bar">
        {/* One view menu: pick a view, or act on this one. Layout and search sit beside it; the view's unsaved changes sit with the filters below. */}
        <MenuTrigger>
          <Button variant="secondary" className="tf-rec__view" icon={view.locked ? <Lock {...i14} /> : undefined} iconEnd={<ChevronDown {...i16} />}>{view.name}</Button>
          <Menu aria-label="Views" placement="bottom start" onAction={(k) => {
            const id = String(k);
            if (id === 'new') setNaming(true);
            else if (id === 'rename') setRenaming(true);
            else if (id === 'duplicate') { const v: SavedView = { ...view, id: newId('v'), name: `${view.name} copy`, locked: false, createdBy: state.me, access: isPrivateView(view) ? 'private' : 'everyone' }; setViews([...allViews, v]); setViewId(v.id); setDraft(undefined); toast({ message: `${v.name} made`, tone: 'success' }); }
            else if (id === 'default') { const was = allViews; setViews([saved ?? view, ...allViews.filter((v) => v.id !== view.id)]); toast({ message: `${view.name} opens first now`, action: { label: 'Undo', onAction: () => setViews(was) } }); }
            else if (id === 'access') setAccessFor(saved ?? view);
            else if (id === 'lock') { const was = allViews; setViews(allViews.map((v) => (v.id === view.id ? { ...v, locked: !view.locked } : v))); if (draft) setDraft({ ...draft, locked: !view.locked }); toast({ message: view.locked ? `${view.name} unlocked` : `${view.name} locked: changes can’t be saved over it`, action: { label: 'Undo', onAction: () => setViews(was) } }); }
            else if (id === 'link') { const url = `https://timefix.com/${state.prefs.workspace.slug}/${object}?view=${view.id}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link to view copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }
            else if (id === 'up') moveView(-1);
            else if (id === 'down') moveView(1);
            else if (id === 'delete') { const was = allViews; const gone = view; setViews(allViews.filter((v) => v.id !== view.id)); setViewId(others[0]?.id ?? ''); setDraft(undefined); toast({ message: `${gone.name} deleted`, action: { label: 'Undo', onAction: () => { setViews(was); setViewId(gone.id); } } }); }
          }}>
            <MenuSection title="Views" selectionMode="single" selectedKeys={[view.id]} onSelectionChange={(keys) => {
              const v = [...(keys === 'all' ? [] : keys)][0]; if (v === undefined || v === view.id) return;
              const was = draft; const wasId = viewId; setViewId(String(v)); setDraft(undefined); setSelected(new Set());
              if (was) toast({ message: `Unsaved changes to ${was.name} discarded`, action: { label: 'Undo', onAction: () => { setViewId(wasId); setDraft(was); } } });
            }}>
              {sharedViews.map(viewItem)}
            </MenuSection>
            {privateViews.length > 0 ? <MenuSection title="Only you" selectionMode="single" selectedKeys={[view.id]} onSelectionChange={(keys) => {
              const v = [...(keys === 'all' ? [] : keys)][0]; if (v === undefined || v === view.id) return; setViewId(String(v)); setDraft(undefined); setSelected(new Set());
            }}>{privateViews.map(viewItem)}</MenuSection> : null}
            <MenuSeparator />
            <MenuSection>
              <MenuItem id="new" icon={<Plus {...i16} />}>New view</MenuItem>
              {canSave(view) ? <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename {view.name}</MenuItem> : null}
              <MenuItem id="duplicate" icon={<Copy {...i16} />}>Duplicate</MenuItem>
              {canSave(view) ? <MenuItem id="access" icon={<Eye {...i16} />} description={ACCESS_WORDS[view.access ?? (isPrivateView(view) ? 'private' : 'everyone')].label}>Who can see it</MenuItem> : null}
              {view.access !== 'admins' || isAdmin(state) ? <MenuItem id="lock" icon={view.locked ? <LockOpen {...i16} /> : <Lock {...i16} />}>{view.locked ? 'Unlock view' : 'Lock view'}</MenuItem> : null}
              <MenuItem id="link" icon={<Link2 {...i16} />}>Copy link to view</MenuItem>
              {views[0]?.id !== view.id ? <MenuItem id="default" icon={<Star {...i16} />}>Open this view first</MenuItem> : null}
              {allViews.findIndex((v) => v.id === view.id) > 0 ? <MenuItem id="up" icon={<ArrowUp {...i16} />}>Move up</MenuItem> : null}
              {allViews.findIndex((v) => v.id === view.id) < allViews.length - 1 ? <MenuItem id="down" icon={<ArrowDown {...i16} />}>Move down</MenuItem> : null}
              {others.length > 0 && canSave(view) ? <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete view</MenuItem> : null}
            </MenuSection>
          </Menu>
        </MenuTrigger>
        <SegmentedControl aria-label="Layout" size="sm" selectedKey={view.layout} onSelectionChange={(k) => edit({ layout: k === 'board' ? 'board' : 'table' })}
          items={[{ id: 'table', label: 'Table', icon: <LayoutList {...i14} /> }, { id: 'board', label: 'Board', icon: <LayoutGrid {...i14} /> }]} />
        <span className="tf-rec__spacer" />
        <SearchField label={`Search ${def.many}`} placeholder={`Search ${def.many}`} size="sm" value={query} onChange={setQuery} className="tf-rec__search" />
        <MenuTrigger>
          <IconButton label={`More for ${def.many}`} size="md"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label={`More for ${def.many}`} placement="bottom end" onAction={(k) => { if (k === 'export') void exportCsv(); else if (k === 'export-all') void exportCsv(undefined, true); else if (k === 'import') onImport?.(); else if (k === 'dupes') onDuplicates?.(); else if (k === 'attrs') onAttributes?.(); else if (k === 'trash') onTrash?.(); }}>
            {onImport && canEdit ? <MenuItem id="import" icon={<Upload {...i16} />}>Import {def.many}</MenuItem> : null}
            <MenuItem id="export" icon={<Download {...i16} />} description={`${sorted.length} rows, ${columns.length} columns`}>Export this view</MenuItem>
            {columns.length < ordered.length ? <MenuItem id="export-all" icon={<Download {...i16} />} description={`${sorted.length} rows, all ${ordered.length} columns`}>Export with hidden columns</MenuItem> : null}
            {onDuplicates || (onAttributes && canEdit) || onTrash ? <MenuSeparator /> : null}
            {onDuplicates ? <MenuItem id="dupes" icon={<Users {...i16} />}>Find duplicates</MenuItem> : null}
            {onAttributes && canEdit ? <MenuItem id="attrs" icon={<Plus {...i16} />}>Add or change attributes</MenuItem> : null}
            {onTrash ? <MenuItem id="trash" icon={<Trash2 {...i16} />}>Open trash</MenuItem> : null}
          </Menu>
        </MenuTrigger>
        {canEdit && <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setCreating({})}>New {def.one}</Button>}
      </div>
      {!canEdit && <Callout tone="info">You’re previewing as a {state.previewRole?.toLowerCase()}: you can look, but not change {def.many}.</Callout>}
      {pairCount > 0 && onDuplicates && <Callout tone="info" action={{ label: 'Review', onPress: onDuplicates }}>{pairCount === 1 ? `1 pair of ${def.many} looks like a duplicate.` : `${pairCount} pairs of ${def.many} look like duplicates.`}</Callout>}
      <div className="tf-rec__filters">
      <FilterBar fields={fields} filters={view.filters} onFiltersChange={(filters) => edit({ filters: filters as ReadonlyArray<FilterRule> })} match={view.match ?? 'all'} onMatchChange={(match) => edit({ match })} sorts={view.sorts} onSortsChange={(sorts) => edit({ sorts })}
        groups={view.groups ?? []} onGroupsChange={(groups) => edit({ groups })} viewOptions={viewOptions}
        columns={view.layout === 'table' ? viewColumns : []} onColumnsChange={(cols) => edit({ hidden: cols.filter((c) => !c.isShown).map((c) => c.id), order: cols.map((c) => c.id) })} totalCount={all.length} hiddenCount={all.length - rows.length} noun={def.many} startFilter={startFilter} />
      {draft && (
        <span className="tf-rec__draft">
          <Button size="sm" variant="ghost" onPress={() => { const was = draft; setDraft(undefined); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => setDraft(was) } }); }}>Discard</Button>
          {canSave(draft) ? <Button size="sm" variant="secondary" onPress={() => { setViews(allViews.map((v) => (v.id === draft.id ? draft : v))); setDraft(undefined); toast({ message: `${draft.name} saved`, tone: 'success' }); }}>Save view</Button>
            : <Button size="sm" variant="secondary" icon={<Lock {...i14} />} onPress={() => setNaming(true)}>Save as new view</Button>}
        </span>
      )}
      </div>
      <div className="tf-rec__split">
      {view.layout === 'board' ? (
        <div className="tf-rec__board">
          <Board label={`${w.Many} by ${boardField?.name.toLowerCase() ?? 'owner'}`} noun={def.many} columns={board} onOpen={setPeek}
            onToggleCollapse={(id) => setFolded((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onMove={(m) => { if (!canEdit || !boardField) return; const field = boardField.id; const to = m.toColumnId; const moved = m.cardIds.filter((id) => String(all.find((r) => r.id === id)?.values[field] ?? '') !== to);
              // Where it was dropped: between its new neighbours (only while the view has no sort).
              const lane = board.find((c) => c.id === to)?.cards.filter((c) => !m.cardIds.includes(c.id)) ?? [];
              if (handOrder) {
                const laneRows = boardGroups.find((g) => g.id === to)?.rows ?? [];
                const r = (id: string) => rank[id] ?? laneRows.findIndex((x) => x.id === id);
                const at = m.target ? lane.findIndex((c) => c.id === m.target?.id) + (m.target.position === 'after' ? 1 : 0) : lane.length;
                const prev = lane[at - 1]; const next = lane[at];
                const lo = prev ? r(prev.id) : (next ? r(next.id) - 1 : 0); const hi = next ? r(next.id) : lo + 1;
                setRank((cur) => ({ ...cur, ...Object.fromEntries(m.cardIds.map((id, i) => [id, lo + ((hi - lo) * (i + 1)) / (m.cardIds.length + 1)])) }));
              } else if (moved.length === 0) {
                toast({ message: `Sorted by ${view?.sorts.map((x) => own.find((f) => f.id === x.field)?.name ?? x.field).join(', ')}, so cards keep that order. Remove the sort to arrange them by hand.` });
              }
              if (moved.length === 0) return;
              if (field === 'stage' && !to) return;
              const many = moved.length === 1 ? def.one[0]?.toUpperCase() + def.one.slice(1) : `${moved.length} ${def.many}`;
              const label = boardGroups.find((g) => g.id === to)?.label ?? to;
              setMany(moved, field, to, field === 'owner' ? `${many} now owned by ${to}` : field === 'stage' ? (moved.length === 1 ? `Moved to ${to}` : `${moved.length} deals moved to ${to}`) : `${many} now in ${label}`); }}
            onAdd={canEdit && boardField ? (columnId) => setCreating(columnId ? { [boardField.id]: columnId } : {}) : undefined} />
        </div>
      ) : (
        <div className="tf-rec__grid">
          {rowGroup ? (tableGroups.length === 0 ? grid([]) : tableGroups.map((g, n) => {
            const isFolded = foldedRows.has(g.id);
            const sum = object === 'deals' ? g.rows.reduce((t, r) => t + Number(r.values.amount ?? 0), 0) : 0;
            return (
              <section key={g.id || 'none'} className="tf-rec__rowgroup" aria-label={g.label}>
                <AriaButton className="tf-rec__grouphead" aria-expanded={!isFolded} onPress={() => setFoldedRows((f) => { const x = new Set(f); if (x.has(g.id)) x.delete(g.id); else x.add(g.id); return x; })}>
                  <ChevronRight className={cx('tf-rec__groupchev', !isFolded && 'is-open')} {...i14} aria-hidden="true" />
                  {rowGroup.id === 'owner' ? <span className="tf-rec__groupwho"><Avatar name={g.label} size={20} />{g.label}</span> : <Tag size="sm" hue={(rowGroup.id === 'stage' ? STAGE_LOOK[g.id as Stage]?.hue : g.hue) ?? 'gray'} status={rowGroup.id === 'stage' ? STAGE_LOOK[g.id as Stage]?.status : g.status}>{g.label}</Tag>}
                  <span className="tf-rec__muted tf-num">{g.rows.length}{sum ? ` · ${inr(sum)}` : ''}</span>
                </AriaButton>
                {!isFolded && grid(g.rows, { hideHeader: n > 0 && !foldedRows.has(tableGroups[0]?.id ?? '') })}
              </section>
            );
          })) : grid(sorted, { summary })}
        </div>
      )}
      </div>
      </div>
      {peek !== undefined && !peekGone && <div className="tf-rec__peekdock"><RecordPanel isOpen onClose={() => setPeek(undefined)} objectName={w.One} recordKey={peek ?? ''}
        label={String((sorted[peekIndex] ?? all.find((r) => r.id === peek))?.values.name ?? '')} onExpand={() => { if (peek) onOpen(object, peek); }}
        position={peekIndex >= 0 ? { index: peekIndex + 1, total: sorted.length, onPrevious: () => setPeek(sorted[Math.max(0, peekIndex - 1)]?.id), onNext: () => setPeek(sorted[Math.min(sorted.length - 1, peekIndex + 1)]?.id) } : undefined}>
        {peek && <PeekBody state={state} object={object} id={peek} onCell={(c, v) => setCell(peek, c, v)} onOpen={onOpen} />}
      </RecordPanel></div>}
      <BulkActionBar count={ids.length} onClear={() => setSelected(new Set())}>
        {ids.length < sorted.length && <BarButton icon={<ListChecks {...i16} />} onPress={() => setSelected('all')}>Select all {sorted.length}</BarButton>}
        {!canEdit && <BarButton icon={<Download {...i16} />} onPress={() => { void exportCsv(ids); }}>Export</BarButton>}
        {canEdit && <BarButton icon={<Pencil {...i16} />} onPress={() => setBulkEdit(true)}>Edit</BarButton>}
        {canEdit && <MenuTrigger>
          <BarButton icon={<UserRound {...i16} />}>Owner</BarButton>
          <Menu aria-label="Set owner" onAction={(k) => {
            setMany(ids, 'owner', String(k), `${ids.length} ${ids.length === 1 ? def.one : def.many} now owned by ${String(k)}`); setSelected(new Set()); refocus();
          }}>{state.members.map((m) => <MenuItem key={m.id} id={m.name}>{m.name}</MenuItem>)}</Menu>
        </MenuTrigger>}
        {canEdit && LISTS_ON && isBuiltIn(object) && <MenuTrigger>
          <BarButton icon={<ListPlus {...i16} />}>Add to list</BarButton>
          <Menu aria-label="Add to list" onAction={(k) => {
            const l = state.lists.find((x) => x.id === String(k)); if (!l) return;
            const have = new Set(l.entries.map((e) => e.recordId));
            const fresh2 = ids.filter((id) => !(l.oncePerRecord && have.has(id)));
            const added = fresh2.map((rid) => ({ id: newId('e'), recordId: rid, stage: l.stages[0] ?? '', priority: 'Medium' as const, next: '', added: new Date() }));
            dispatch({ type: 'list/entries', id: l.id, add: added });
            toast({ message: fresh2.length === ids.length ? `${fresh2.length} added to ${l.name}` : `${fresh2.length} added to ${l.name}; ${ids.length - fresh2.length} already there`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'list/entries', id: l.id, remove: added.map((e) => e.id) }) } });
            setSelected(new Set());
          }}>
            {state.lists.filter((l) => l.object === object && !l.archived).length === 0 ? <MenuItem id="none" isDisabled>No lists of {def.many} yet</MenuItem>
              : state.lists.filter((l) => l.object === object && !l.archived).map((l) => <MenuItem key={l.id} id={l.id} description={`${liveEntries(state, l).length} on it`}>{l.name}</MenuItem>)}
          </Menu>
        </MenuTrigger>}
        {canEdit && <BarButton icon={<Download {...i16} />} onPress={() => { void exportCsv(ids); }}>Export</BarButton>}
        {canEdit && <BarButton icon={<Trash2 {...i16} />} onPress={() => setBulkDelete([...ids])}>Delete</BarButton>}
      </BulkActionBar>
      <ConfirmDialog isOpen={bulkDelete !== undefined} onOpenChange={(o) => { if (!o) setBulkDelete(undefined); }} title={`Delete ${bulkDelete?.length ?? 0} ${bulkDelete?.length === 1 ? def.one : def.many}?`}
        consequence="They go to Trash for 30 days, where you can restore them." confirmLabel="Move to Trash"
        onConfirm={() => { const gone = bulkDelete ?? []; dispatch({ type: 'records/remove', object, ids: gone }); toast({ message: `${gone.length} ${gone.length === 1 ? def.one : def.many} moved to Trash`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/untrash', ids: gone }) } }); setBulkDelete(undefined); setSelected(new Set()); refocus(); }} />
      {creating && <NewRecordDialog state={state} object={object} initialName={startNew} start={creating} onClose={() => setCreating(undefined)} onCreate={(name, values, more) => {
        const id = newId(object.slice(0, 1));
        const owner = state.members.some((m) => m.name === values.owner) ? values.owner ?? state.me : state.me;
        const base = object === 'people' ? { id, name, email: values.email ?? '', title: values.title ?? '', companyId: values.company || undefined, owner, tags: [], created: new Date() }
          : object === 'companies' ? { id, name, domain: values.domain ?? '', industry: '', size: '', city: '', owner, created: new Date() }
          : object === 'deals' ? { id, name, companyId: values.company ?? '', stage: (stagesOf(state).some((s) => s.id === values.stage) ? values.stage : stagesOf(state)[0]?.id ?? 'Lead') as Stage, amount: Number(values.amount) || 0, owner, close: dayOf(values.close ?? '') ?? new Date(Date.now() + 30 * 86_400_000), created: new Date(), stageAt: new Date() }
          : blankCustom(id, name, owner);
        // Every other field typed in "Add more fields" lands where it belongs: a built-in key, or `extra`.
        const rest = Object.entries(values).filter(([k, v]) => v !== '' && !['email', 'title', 'company', 'domain', 'amount', 'owner', 'stage', 'close'].includes(k));
        const record = rest.reduce<Record<string, unknown>>((r, [k, v]) => { const p = patchFor(state, object, base as never, k, v); if (!p) return r; return { ...r, ...p, ...(p.extra ? { extra: { ...(r.extra as object | undefined), ...(p.extra as object) } } : {}) }; }, { ...base });
        if (object === 'people') dispatch({ type: 'person/set', person: record as never });
        else if (object === 'companies') dispatch({ type: 'company/set', company: record as never });
        else if (object === 'deals') dispatch({ type: 'deal/set', deal: record as never });
        else dispatch({ type: 'custom/set', object, record: { ...(record as never as ReturnType<typeof blankCustom>), extra: (record.extra as Readonly<Record<string, string>> | undefined) ?? {} } });
        setFresh((f) => new Set(f).add(id));
        toast({ message: `${name} created`, tone: 'success', action: { label: 'Open', onAction: () => onOpen(object, id) } });
        if (!more) setCreating(undefined);
      }} />}
      {renaming && <RenameDialog title="Rename view" label="Name" value={view.name} onClose={() => setRenaming(false)} onSave={(name) => { const next = { ...(saved ?? view), name }; setViews(allViews.map((v) => (v.id === view.id ? next : v))); if (draft) setDraft({ ...draft, name }); setRenaming(false); toast({ message: 'View renamed', tone: 'success' }); }} />}
      {accessFor && <ViewAccessDialog name={accessFor.name} value={accessFor.access ?? (isPrivateView(accessFor) ? 'private' : 'everyone')} onClose={() => setAccessFor(undefined)}
        onSave={(access: ViewAccess) => { const was = allViews; setViews(allViews.map((v) => (v.id === accessFor.id ? { ...v, access, isPrivate: access === 'private', createdBy: v.createdBy ?? state.me } : v))); setAccessFor(undefined); toast({ message: `${accessFor.name}: ${ACCESS_WORDS[access].label.toLowerCase()}`, tone: 'success', action: { label: 'Undo', onAction: () => setViews(was) } }); }} />}
      {bulkEdit && <BulkEditDialog state={state} object={object} count={ids.length} onClose={() => setBulkEdit(false)}
        onApply={(changes) => {
          const list = ids.flatMap((id) => {
            const r = all.find((x) => x.id === id);
            return changes.map((c) => {
              if (c.mode === 'clear') return { id, col: c.field, value: '' };
              if (c.mode === 'add' || c.mode === 'remove') { const have = String(r?.values[c.field] ?? '').split(/,\s*/).filter(Boolean); const pick = c.value.split(/,\s*/).filter(Boolean); const next = c.mode === 'add' ? [...new Set([...have, ...pick])] : have.filter((x) => !pick.includes(x)); return { id, col: c.field, value: next.join(', ') }; }
              return { id, col: c.field, value: c.value };
            });
          });
          const n = write(list, `${changes.length === 1 ? own.find((f) => f.id === changes[0]?.field)?.name ?? 'Field' : `${changes.length} fields`} changed on ${ids.length} ${ids.length === 1 ? def.one : def.many}`);
          if (n === 0) toast({ message: 'Nothing changed: those values don’t fit.' });
          setBulkEdit(false); setSelected(new Set()); refocus();
        }} />}
      {naming && <ViewNamer onClose={() => setNaming(false)} onSave={(name, access) => {
        const v: SavedView = { ...view, id: newId('v'), name, access, isPrivate: access === 'private', locked: false, createdBy: state.me };
        setViews([...allViews, v]); setViewId(v.id); setDraft(undefined); setNaming(false); toast({ message: `${name} made`, tone: 'success' });
      }} />}
    </div>
  );
}

/** The record beside the list: its fields, editable, what it's linked to, and every attribute an owner added. */
function PeekBody({ state, object, id, onCell, onOpen }: { readonly state: AppState; readonly object: ObjectId; readonly id: string; readonly onCell: (c: string, v: string) => void; readonly onOpen: (o: ObjectId, id: string) => void }) {
  const owners = state.members.map((m) => ({ id: m.name, name: m.name }));
  const row = (a: Attribute, v: import('../AttributeField/AttributeField.tsx').AttributeValue, col: string) => <AttributeRow key={a.id} attribute={a} value={v} onChange={(x) => onCell(col, typeof x === 'object' && x !== null && 'name' in x ? String((x as { name: string }).name) : String(x ?? ''))} />;
  const ownerAttr: Attribute = { id: 'owner', name: 'Owner', type: 'actor', candidates: owners };
  const rec = recordOf(state, object, id);
  // Owner-made attributes, each in its own field.
  const extras = liveAttributes(schemaOf(state, object)).filter((a) => ownFields(state, object).some((f) => f.id === a.id && f.custom) && !a.relation).map((a) => {
    const f = ownFields(state, object).find((x) => x.id === a.id); if (!f || !rec) return null;
    const attr = a.computed ? { ...a, type: f.type, readOnlyReason: 'Worked out from other fields' } : attributeOf(state, f);
    const v = a.computed ? (state ? objectDef(object, state).rows(state).find((r) => r.id === id)?.values[a.id] : undefined) : rec.extra?.[a.id];
    return <AttributeRow key={a.id} attribute={attr} value={fieldValue(attr, v === undefined ? undefined : String(v))} onChange={(x) => onCell(a.id, valueToCell(attr, x))} />;
  });
  if (!isBuiltIn(object)) {
    if (!rec) return null;
    return (
      <div className="tf-rec__peek">
        <div className="tf-rec__peekhead"><Avatar name={rec.name} size={44} shape="square" /><span className="tf-rec__peektext"><strong>{rec.name}</strong><span className="tf-rec__muted">{wordsOf(state, object).One}</span></span></div>
        {row(ownerAttr, { id: rec.owner, name: rec.owner }, 'owner')}
        {extras}
      </div>
    );
  }
  if (object === 'people') {
    const p = state.people.find((x) => x.id === id); if (!p) return null;
    const co = state.companies.find((c) => c.id === p.companyId);
    const deals = state.deals.filter((d) => d.contactId === p.id);
    return (
      <div className="tf-rec__peek">
        <div className="tf-rec__peekhead"><Avatar name={p.name} size={44} /><span className="tf-rec__peektext"><strong>{p.name}</strong><span className="tf-rec__muted">{[p.title, co?.name].filter(Boolean).join(' · ')}</span></span></div>
        {row({ id: 'email', name: 'Email', type: 'email' }, p.email, 'email')}
        {row({ id: 'phone', name: 'Phone', type: 'phone' }, p.phone, 'phone')}
        {row({ id: 'title', name: 'Job title', type: 'text' }, p.title, 'title')}
        {row(ownerAttr, { id: p.owner, name: p.owner }, 'owner')}
        {extras}
        <RecordSection title="Company" count={co ? 1 : 0}>{co && <button type="button" className="tf-rec__rel" onClick={() => onOpen('companies', co.id)}><Avatar name={co.name} size={20} shape="square" />{co.name}</button>}</RecordSection>
        <RecordSection title="Deals" count={deals.length}>{deals.map((d) => <button key={d.id} type="button" className="tf-rec__rel" onClick={() => onOpen('deals', d.id)}>{d.name}<Tag size="sm" hue={STAGE_LOOK[d.stage]?.hue ?? 'gray'} status={STAGE_LOOK[d.stage]?.status}>{d.stage}</Tag></button>)}</RecordSection>
      </div>
    );
  }
  if (object === 'companies') {
    const c = state.companies.find((x) => x.id === id); if (!c) return null;
    const people = state.people.filter((p) => p.companyId === c.id);
    const deals = state.deals.filter((d) => d.companyId === c.id);
    return (
      <div className="tf-rec__peek">
        <div className="tf-rec__peekhead"><Avatar name={c.name} size={44} shape="square" /><span className="tf-rec__peektext"><strong>{c.name}</strong><span className="tf-rec__muted">{[c.domain, c.city].filter(Boolean).join(' · ')}</span></span></div>
        {row({ id: 'domain', name: 'Domain', type: 'domain' }, c.domain, 'domain')}
        {row({ id: 'industry', name: 'Industry', type: 'select', options: objectDef('companies', state).columns.find((x) => x.id === 'industry')?.options?.map((o) => ({ id: o.id, label: o.label, hue: o.hue ?? 'gray' })) ?? [] }, c.industry, 'industry')}
        {row({ id: 'size', name: 'Employees', type: 'text' }, c.size, 'size')}
        {row(ownerAttr, { id: c.owner, name: c.owner }, 'owner')}
        {extras}
        <RecordSection title="People" count={people.length}>{people.map((p) => <button key={p.id} type="button" className="tf-rec__rel" onClick={() => onOpen('people', p.id)}><Avatar name={p.name} size={20} />{p.name}<span className="tf-rec__muted">{p.title}</span></button>)}</RecordSection>
        <RecordSection title="Deals" count={deals.length}>{deals.map((d) => <button key={d.id} type="button" className="tf-rec__rel" onClick={() => onOpen('deals', d.id)}>{d.name}<span className="tf-rec__muted tf-num">{inr(d.amount)}</span></button>)}</RecordSection>
      </div>
    );
  }
  const d: Deal | undefined = state.deals.find((x) => x.id === id); if (!d) return null;
  const co = state.companies.find((c) => c.id === d.companyId); const contact = state.people.find((p) => p.id === d.contactId);
  const open = isOpenDeal(state, d); const days = Math.max(0, Math.floor((Date.now() - (d.stageAt ?? d.created).getTime()) / 86_400_000));
  return (
    <div className="tf-rec__peek">
      <div className="tf-rec__peekhead"><Avatar name={co?.name ?? d.name} size={44} shape="square" /><span className="tf-rec__peektext"><strong>{d.name}</strong><span className="tf-rec__muted tf-num">{[co?.name, d.amount ? inr(d.amount) : ''].filter(Boolean).join(' · ')}</span></span></div>
      {row({ id: 'stage', name: 'Stage', type: 'status', options: stagesOf(state).map((x) => ({ id: x.id, label: x.label, hue: STAGE_LOOK[x.id as Stage]?.hue ?? 'gray', shape: STAGE_LOOK[x.id as Stage]?.status })) }, d.stage, 'stage')}
      {row({ id: 'amount', name: 'Amount', type: 'currency', currency: 'INR' }, d.amount, 'amount')}
      {row({ id: 'close', name: 'Close date', type: 'date' }, ymd(d.close), 'close')}
      {row(ownerAttr, { id: d.owner, name: d.owner }, 'owner')}
      {extras}
      {open && <p className="tf-rec__muted tf-num tf-rec__dealfacts">{oddsOf(state, d.stage)}% likely · {inr(Math.round((d.amount * oddsOf(state, d.stage)) / 100))} weighted · {days} days in {d.stage}{days > staleAfter(state, d.stage) ? ', stale' : ''}</p>}
      <RecordSection title="Contact" count={contact ? 1 : 0}>{contact && <button type="button" className="tf-rec__rel" onClick={() => onOpen('people', contact.id)}><Avatar name={contact.name} size={20} />{contact.name}<span className="tf-rec__muted">{contact.title}</span></button>}</RecordSection>
    </div>
  );
}
