// Records: People, Companies, Deals. One toolbar (view, Table/Board, search, filters and sorts, Import/Export, New), a table you edit in place
// or a board you drag, bulk actions with Undo, and a record panel beside the list. A changed view is a draft: Save it or Discard it.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Selection, SortDescriptor } from 'react-aria-components';
import { Building2, ChevronDown, CircleDollarSign, Copy, Download, LayoutGrid, LayoutList, ListPlus, MoreHorizontal, PenLine, Pencil, Plus, Star, Trash2, Upload, UserRound, Users } from 'lucide-react';
import { DataGrid, type ColumnAction, type GridColumn, type GridRecord } from '../DataGrid/DataGrid.tsx';
import { Board, type BoardColumn } from '../Board/Board.tsx';
import { FilterBar, type FilterField, type FilterRule, type SortRule, type ViewColumn } from '../FilterBar/FilterBar.tsx';
import { BulkActionBar, BarButton } from '../FloatingBar/FloatingBar.tsx';
import { RecordPanel, AttributeRow, RecordSection } from '../RecordPanel/RecordPanel.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { companyPairs, duplicatePairs } from './duplicates.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { Attribute, AttributeValue } from '../AttributeField/AttributeField.tsx';
import { BUILT_IN_ATTRIBUTES, STAGES, STAGE_ODDS, STALE_DAYS, daysInStage, liveEntries, inr, newId, type AppAction, type AppState, type Company, type Deal, type ObjectId, type Person, type SavedView, type Stage, LISTS_ON } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
/** "2026-11-10" as a local date (no UTC day shift). */
const dayOf = (v: string): Date | undefined => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined; };
const ymd = (d: Date | undefined) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined);
const STAGE_LOOK: Readonly<Record<Stage, { readonly hue: 'gray' | 'blue' | 'purple' | 'green' | 'red'; readonly status: 'draft' | 'progress' | 'review' | 'done' | 'failed' }>> = {
  Lead: { hue: 'gray', status: 'draft' }, Qualified: { hue: 'blue', status: 'progress' }, Proposal: { hue: 'purple', status: 'review' }, Won: { hue: 'green', status: 'done' }, Lost: { hue: 'red', status: 'failed' },
};

/** What an object looks like in the app: its words, columns and rows. */
interface ObjectDef { readonly id: ObjectId; readonly one: string; readonly many: string; readonly icon: ReactNode; readonly columns: ReadonlyArray<GridColumn>; readonly rows: (s: AppState) => ReadonlyArray<GridRecord> }

/** The three objects' columns and rows. */
export function objectDef(id: ObjectId, state: AppState): ObjectDef {
  const owners = state.members.map((m) => ({ id: m.name, label: m.name }));
  const coName = (cid: string | undefined) => state.companies.find((c) => c.id === cid)?.name;
  if (id === 'people') return {
    id, one: 'person', many: 'people', icon: <Users {...i16} />,
    columns: [{ id: 'name', name: 'Name', type: 'name', width: 220, isSortable: true }, { id: 'email', name: 'Email', type: 'text', width: 220, isSortable: true }, { id: 'company', name: 'Company', type: 'text', width: 160, isSortable: true, isReadOnly: true },
      { id: 'title', name: 'Job title', type: 'text', width: 170, isSortable: true }, { id: 'tags', name: 'Tags', type: 'text', width: 170, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true, options: owners }, { id: 'lastContact', name: 'Last contact', type: 'date', width: 130, isSortable: true, isReadOnly: true }],
    rows: (s) => s.people.map((p) => ({ id: p.id, kind: 'person', values: { name: p.name, email: p.email, company: coName(p.companyId), title: p.title, tags: p.tags.join(', '), owner: p.owner, lastContact: ymd(p.lastContact) } })),
  };
  if (id === 'companies') return {
    id, one: 'company', many: 'companies', icon: <Building2 {...i16} />,
    columns: [{ id: 'name', name: 'Name', type: 'name', width: 200, isSortable: true }, { id: 'domain', name: 'Domain', type: 'text', width: 160, isSortable: true },
      { id: 'industry', name: 'Industry', type: 'select', width: 150, isSortable: true, options: ['Software', 'Fintech', 'Healthcare', 'Manufacturing', 'Logistics', 'Retail'].map((x, n) => ({ id: x, label: x, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'yellow'] as const)[n] })) },
      { id: 'size', name: 'Employees', type: 'text', width: 120, isSortable: true }, { id: 'city', name: 'City', type: 'text', width: 130, isSortable: true }, { id: 'people', name: 'People', type: 'number', width: 100, isReadOnly: true, isSortable: true },
      { id: 'open', name: 'Open deals', type: 'text', width: 140, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true }],
    rows: (s) => s.companies.map((c) => { const open = s.deals.filter((d) => d.companyId === c.id && d.stage !== 'Won' && d.stage !== 'Lost'); return { id: c.id, kind: 'company', values: { name: c.name, domain: c.domain, industry: c.industry, size: c.size, city: c.city, people: s.people.filter((p) => p.companyId === c.id).length, open: open.length ? inr(open.reduce((n, d) => n + d.amount, 0)) : undefined, owner: c.owner } }; }),
  };
  return {
    id, one: 'deal', many: 'deals', icon: <CircleDollarSign {...i16} />,
    columns: [{ id: 'name', name: 'Deal', type: 'name', width: 230, isSortable: true }, { id: 'company', name: 'Company', type: 'text', width: 160, isReadOnly: true, isSortable: true },
      { id: 'stage', name: 'Stage', type: 'status', width: 140, isSortable: true, options: STAGES.map((x) => ({ id: x, label: x, hue: STAGE_LOOK[x].hue, status: STAGE_LOOK[x].status })) },
      { id: 'amount', name: 'Amount (₹)', type: 'number', width: 140, isSortable: true }, { id: 'weighted', name: 'Weighted (₹)', type: 'number', width: 140, isSortable: true, isReadOnly: true },
      { id: 'inStage', name: 'Days in stage', type: 'number', width: 130, isSortable: true, isReadOnly: true }, { id: 'close', name: 'Close date', type: 'date', width: 130, isSortable: true, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true }],
    rows: (s) => s.deals.map((d) => ({ id: d.id, kind: 'company', values: { name: d.name, company: coName(d.companyId), stage: d.stage, amount: d.amount, weighted: Math.round((d.amount * STAGE_ODDS[d.stage]) / 100), inStage: daysInStage(d), close: ymd(d.close), owner: d.owner } })),
  };
}

/** Does a row pass one filter? */
function passes(r: GridRecord, f: FilterRule | SavedView['filters'][number]): boolean {
  const v = r.values[f.field];
  const s = v === undefined ? '' : String(v).toLowerCase();
  const vals = f.values.map((x) => x.toLowerCase());
  switch (f.operator) {
    case 'is empty': return s === '';
    case 'is': return vals.length === 0 || vals.includes(s);
    case 'is not': return !vals.includes(s);
    case 'contains': return vals.length === 0 || vals.some((x) => s.includes(x));
    case 'is greater than': return Number(v) > Number(f.values[0] ?? 0);
    case 'is less than': return Number(v) < Number(f.values[0] ?? 0);
    default: return true;
  }
}

/** Props for RecordsScreen. */
export interface RecordsScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly object: ObjectId;
  /** Opens a record's full page. */
  readonly onOpen: (object: ObjectId, id: string) => void;
  /** People only: open the import and the duplicates review. */
  readonly onImport?: () => void;
  readonly onDuplicates?: () => void;
  /** Opens with the New dialog, its name filled in (⌘K "Create person ‘Ana’"). */
  readonly startNew?: string;
  /** Settings › Objects, to add or change this object's attributes. */
  readonly onAttributes?: () => void;
}

/** Owner-made attributes on a built-in object, as grid columns. Their values live in each record's `extra`. */
export function customColumns(state: AppState, object: string): ReadonlyArray<GridColumn> {
  return (state.objects.find((o) => o.id === object)?.attributes ?? []).filter((a) => !BUILT_IN_ATTRIBUTES.has(a.id)).map((a) => ({
    id: a.id, name: a.name, width: 160, isSortable: true,
    type: a.type === 'select' || a.type === 'status' ? a.type : a.type === 'number' || a.type === 'currency' ? 'number' : 'text',
    options: a.options?.filter((o) => !o.archived).map((o) => ({ id: o.id, label: o.label, hue: o.hue })),
  }));
}
/** The signed-in person can change records (not when previewing as a role that can't). */
/** Records can be changed, except while previewing as another role: a preview never changes anything. */
export const canEditRecords = (state: AppState) => !state.previewRole;

/** One object's records. */
export function RecordsScreen({ state, dispatch, object, onOpen, onImport, onDuplicates, startNew, onAttributes }: RecordsScreenProps) {
  const { toast } = useToast();
  const base = objectDef(object, state);
  const extras = customColumns(state, object);
  const def: ObjectDef = { ...base, columns: [...base.columns, ...extras], rows: (s) => base.rows(s).map((r) => ({ ...r, values: { ...r.values, ...((object === 'people' ? s.people : object === 'companies' ? s.companies : s.deals).find((x) => x.id === r.id)?.extra ?? {}) } })) };
  const canEdit = canEditRecords(state);
  const views = state.views[object];
  const [viewId, setViewId] = useState(views[0]?.id ?? '');
  const saved = views.find((v) => v.id === viewId) ?? views[0];
  const [draft, setDraft] = useState<SavedView | undefined>();
  const view = draft ?? saved;
  const [query, setQueryRaw] = useState('');
  const [selected, setSelected] = useState<Selection>(new Set());
  /** A new search or filter clears the selection, so nothing hidden stays picked. */
  const setQuery = (v: string) => { setQueryRaw(v); setSelected(new Set()); };
  const [peek, setPeek] = useState<string>();
  const [creating, setCreating] = useState(startNew !== undefined);
  const [newStage, setNewStage] = useState<Stage>();
  const [newOwner, setNewOwner] = useState<string>();
  const [naming, setNaming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  /** Cell edits made here, newest last: ⌘Z takes back the latest one. */
  const edits = useRef<Array<{ readonly id: string; readonly patch: Readonly<Record<string, unknown>> }>>([]);
  const all = useMemo(() => def.rows(state), [state, object]); // eslint-disable-line react-hooks/exhaustive-deps
  // Duplicate pairs only change when the people or companies do, not on every keystroke.
  const pairCount = useMemo(() => (!onDuplicates ? 0 : object === 'people' ? duplicatePairs(state, new Set(state.notDupes)).length : object === 'companies' ? companyPairs(state, new Set(state.notDupes)).length : 0), [state.people, state.companies, state.notDupes, object, onDuplicates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || document.querySelector('[role="dialog"][aria-modal="true"], .tf-scrim')) return;
      const t = e.target as HTMLElement | null; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
      const last = edits.current.pop(); if (!last) return;
      e.preventDefault(); dispatch({ type: 'records/fields', object, changes: [last] }); toast({ message: 'Edit undone' });
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [object]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null;
  // A guest sees only what's shared with them; nothing is yet in the prototype.
  if (state.previewRole === 'Guest') return <div className="tf-app__empty"><EmptyState icon={<Users size={20} strokeWidth={1.75} />} title={`No ${def.many} shared with you`} description={`As a guest you see only lists and records someone shares with you. Ask an admin of ${state.prefs.workspace.name} to share one.`} /></div>;
  const edit = (patch: Partial<SavedView>) => { setDraft({ ...view, ...patch }); if (patch.filters) setSelected(new Set()); };
  const [startFilter, setStartFilter] = useState<{ readonly field: string; readonly seq: number } | undefined>();
  // The header's column menu (Attio): sort, filter by it, hide it with Undo, or change the field in Settings.
  const columnAction = (id: string, a: ColumnAction) => {
    if (a === 'ascending' || a === 'descending') { edit({ sorts: [{ field: id, direction: a }] }); return; }
    if (a === 'filter') { setStartFilter((f) => ({ field: id, seq: (f?.seq ?? 0) + 1 })); return; }
    if (a === 'edit') { onAttributes?.(); return; }
    const was = view.hidden; const name = def.columns.find((c) => c.id === id)?.name ?? 'Column';
    edit({ hidden: [...was, id] }); toast({ message: `${name} hidden. Show it again from View.`, action: { label: 'Undo', onAction: () => edit({ hidden: was }) } });
  };
  const q = query.trim().toLowerCase();
  const rows = all.filter((r) => (view.filters.length === 0 || (view.match === 'any' ? view.filters.some((f) => passes(r, f)) : view.filters.every((f) => passes(r, f)))) && (!q || Object.values(r.values).some((v) => String(v ?? '').toLowerCase().includes(q))));
  const sorted = [...rows].sort((a, b) => {
    for (const s of view.sorts) {
      const x = a.values[s.field] ?? ''; const y = b.values[s.field] ?? '';
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return s.direction === 'ascending' ? c : -c;
    }
    return 0;
  });
  const columns = def.columns.filter((c) => !view.hidden.includes(c.id));
  const ids = selected === 'all' ? sorted.map((r) => r.id) : [...selected].map(String);
  const fields: ReadonlyArray<FilterField> = def.columns.map((c) => ({ id: c.id, name: c.name, type: c.type === 'status' ? 'status' : c.type === 'select' ? 'select' : c.type === 'person' ? 'person' : c.type === 'number' ? 'number' : 'text',
    options: c.type === 'person' ? state.members.map((m) => ({ id: m.name, label: m.name })) : c.options?.map((o) => ({ id: o.id, label: o.label, hue: o.hue, status: o.status })) }));
  const viewColumns: ReadonlyArray<ViewColumn> = def.columns.map((c) => ({ id: c.id, name: c.name, isShown: !view.hidden.includes(c.id), isLocked: c.id === 'name' }));
  /** One value as the record keeps it: dates as dates, amounts as numbers. */
  const cellValue = (col: string, value: string, rowId = ''): unknown => (col === 'amount' ? Number(value) || 0 : col === 'close' ? (dayOf(value) ?? recordOf(rowId)?.close) : value);
  const recordOf = (rowId: string): Readonly<Record<string, unknown>> | undefined => (object === 'people' ? state.people : object === 'companies' ? state.companies : state.deals).find((x) => x.id === rowId) as Readonly<Record<string, unknown>> | undefined;
  const isExtra = (col: string) => extras.some((c) => c.id === col);
  const setCell = (rowId: string, col: string, value: string) => {
    const rec = recordOf(rowId); if (!rec || !canEdit) return;
    if (col === 'email' && value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) { toast({ message: `“${value}” isn’t an email address. Nothing changed.`, tone: 'danger' }); return; }
    if (col === 'name' && !value.trim()) { toast({ message: 'A name can’t be empty. Nothing changed.', tone: 'danger' }); return; }
    const patch = isExtra(col) ? { extra: { ...((rec.extra as Readonly<Record<string, string>> | undefined) ?? {}), [col]: value } } : { [col]: cellValue(col, value, rowId) };
    edits.current.push({ id: rowId, patch: Object.fromEntries(Object.keys(patch).map((k) => [k, rec[k]])) });
    dispatch({ type: 'records/fields', object, changes: [{ id: rowId, patch }] });
  };
  /** Sets one field on many records; Undo puts back only that field, so later edits stay. */
  const setMany = (rowIds: ReadonlyArray<string>, col: string, value: unknown, message: string) => {
    const key = isExtra(col) ? 'extra' : col;
    const was = rowIds.map((id) => ({ id, patch: isExtra(col) ? { extra: { [col]: ((recordOf(id)?.extra as Readonly<Record<string, string>> | undefined) ?? {})[col] ?? '' } } : { [key]: recordOf(id)?.[key] } }));
    dispatch({ type: 'records/fields', object, changes: rowIds.map((id) => ({ id, patch: isExtra(col) ? { extra: { [col]: String(value ?? '') } } : { [col]: value } })) });
    toast({ message, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: was }) } });
  };
  const exportCsv = async (only?: ReadonlyArray<string>, everyColumn = false) => {
    const pick = only ? sorted.filter((r) => only.includes(r.id)) : sorted;
    const cols = everyColumn ? def.columns : columns;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c.name)).join(','), ...pick.map((r) => cols.map((c) => esc(r.values[c.id])).join(','))].join('\n');
    const o = await saveFile(`${def.many}.csv`, new Blob([csv], { type: 'text/csv' }));
    if (o === 'saved') { toast({ message: `${pick.length} ${pick.length === 1 ? def.one : def.many} exported`, tone: 'success' });
      dispatch({ type: 'prefs/update', fn: (q) => ({ jobs: [{ id: newId('jb'), kind: 'export' as const, what: `${def.many[0]?.toUpperCase()}${def.many.slice(1)} · ${view.name}`, rows: pick.length, by: state.me, at: new Date(), file: csv, name: `${def.many}.csv` }, ...(q.jobs ?? [])].slice(0, 20) }) }); }
  };
  const byOwner = view.groupBy === 'owner';
  // A board for every object: deals by stage (or owner), companies by industry, people by owner. Dragging a card sets that field.
  const boardField = object === 'deals' ? (byOwner ? 'owner' : 'stage') : object === 'companies' ? 'industry' : 'owner';
  const groups: ReadonlyArray<{ readonly id: string; readonly title: string; readonly status: BoardColumn['status']; readonly hue: BoardColumn['hue']; readonly field: string }> = object === 'companies'
    ? [...new Set([...state.companies.map((c) => c.industry).filter(Boolean), ''])].map((ind) => ({ id: ind, title: ind || 'No industry', status: 'draft' as const, hue: 'gray' as const, field: 'industry' }))
    : byOwner || object === 'people'
    ? state.members.map((m) => ({ id: m.name, title: m.name, status: 'draft' as const, hue: 'gray' as const, field: 'owner' }))
    : STAGES.map((stage) => ({ id: stage, title: stage, status: STAGE_LOOK[stage].status, hue: STAGE_LOOK[stage].hue, field: 'stage' }));
  const board: ReadonlyArray<BoardColumn> = groups.map((g) => { const inCol = sorted.filter((r) => r.values[g.field] === g.id); const sum = inCol.reduce((n, r) => n + Number(r.values.amount ?? 0), 0); const wsum = inCol.reduce((n, r) => n + Number(r.values.weighted ?? 0), 0); return { id: g.id, title: g.title, status: g.status, hue: g.hue, isCollapsed: folded.has(g.id), meta: sum ? (wsum && wsum !== sum ? `${inr(sum)} · ${inr(wsum)} weighted` : inr(sum)) : undefined,
    cards: inCol.map((r) => { if (object !== 'deals') return { id: r.id, title: String(r.values.name), description: [object === 'people' ? r.values.title : r.values.domain, r.values.company ?? r.values.city].filter(Boolean).join(' · '), people: r.values.owner ? [String(r.values.owner)] : [] }; const d = state.deals.find((x) => x.id === r.id); const open = d && d.stage !== 'Won' && d.stage !== 'Lost'; const days = d ? daysInStage(d) : 0; return { id: r.id, title: String(r.values.name), description: [r.values.company, Number(r.values.amount) ? inr(Number(r.values.amount)) : '', open ? `${days}d in ${d.stage}` : ''].filter(Boolean).join(' · '), tags: open && days > STALE_DAYS ? [{ label: `Stale · no move in ${days}d`, hue: 'orange' as const }] : undefined, people: d ? [d.owner] : [], date: d?.close }; }) }; });
  const peekIndex = peek ? sorted.findIndex((r) => r.id === peek) : -1;
  const peekGone = peek !== undefined && !all.some((r) => r.id === peek);
  const pairs = pairCount;
  const shownRows = sorted.map((r) => (fresh.has(r.id) ? { ...r, isNew: true } : r));
  const total = object === 'deals' ? sorted.reduce((n, r) => n + Number(r.values.amount ?? 0), 0) : 0;
  const summary = `${sorted.length === all.length ? `${sorted.length}` : `${sorted.length} of ${all.length}`} ${sorted.length === 1 ? def.one : def.many}${object === 'deals' ? ` · ${inr(total)} total · ${inr(sorted.reduce((n, r) => n + Number(r.values.weighted ?? 0), 0))} weighted · ${inr(sorted.length ? Math.round(total / sorted.length) : 0)} average` : ''}`;
  const others = views.filter((v) => v.id !== view.id);
  /** After a bulk action the floating bar leaves; focus goes back to the table so keyboard use carries on. */
  const refocus = () => window.requestAnimationFrame(() => { if (document.activeElement === document.body) document.querySelector<HTMLElement>('.tf-rec__grid [role="grid"]')?.focus(); });

  return (
    <div className="tf-rec">
      <div className="tf-rec__bar">
        {/* One view menu: pick a view, or act on this one. Layout and search sit beside it; the view's unsaved changes sit with the filters below. */}
        <MenuTrigger>
          <Button variant="secondary" className="tf-rec__view" iconEnd={<ChevronDown {...i16} />}>{view.name}</Button>
          <Menu aria-label="Views" placement="bottom start" onAction={(k) => {
            const id = String(k);
            if (id === 'new') setNaming(true);
            else if (id === 'rename') setRenaming(true);
            else if (id === 'duplicate') { const v: SavedView = { ...view, id: newId('v'), name: `${view.name} copy` }; dispatch({ type: 'views/set', object, views: [...views, v] }); setViewId(v.id); setDraft(undefined); toast({ message: `${v.name} made`, tone: 'success' }); }
            else if (id === 'default') { const was = views; dispatch({ type: 'views/set', object, views: [saved ?? view, ...views.filter((v) => v.id !== view.id)] }); toast({ message: `${view.name} opens first now`, action: { label: 'Undo', onAction: () => dispatch({ type: 'views/set', object, views: was }) } }); }
            else if (id === 'group-stage' || id === 'group-owner') edit({ groupBy: id === 'group-owner' ? 'owner' : 'stage', layout: 'board' });
            else if (id === 'delete') { const was = views; const gone = view; dispatch({ type: 'views/set', object, views: others }); setViewId(others[0]?.id ?? ''); setDraft(undefined); toast({ message: `${gone.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'views/set', object, views: was }); setViewId(gone.id); } } }); }
          }}>
            <MenuSection title="Views" selectionMode="single" selectedKeys={[view.id]} onSelectionChange={(keys) => {
              const v = [...(keys === 'all' ? [] : keys)][0]; if (v === undefined || v === view.id) return;
              const was = draft; const wasId = viewId; setViewId(String(v)); setDraft(undefined); setSelected(new Set());
              if (was) toast({ message: `Unsaved changes to ${was.name} discarded`, action: { label: 'Undo', onAction: () => { setViewId(wasId); setDraft(was); } } });
            }}>
              {views.map((v, n) => <MenuItem key={v.id} id={v.id} description={[n === 0 ? 'Opens first' : '', v.isPrivate ? 'Only you' : ''].filter(Boolean).join(' · ') || undefined}>{v.name}</MenuItem>)}
            </MenuSection>
            <MenuSeparator />
            <MenuSection>
              <MenuItem id="new" icon={<Plus {...i16} />}>New view</MenuItem>
              <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename {view.name}</MenuItem>
              <MenuItem id="duplicate" icon={<Copy {...i16} />}>Duplicate</MenuItem>
              {views[0]?.id !== view.id ? <MenuItem id="default" icon={<Star {...i16} />}>Open this view first</MenuItem> : null}
              {object === 'deals' && view.layout === 'board' ? <MenuItem id={byOwner ? 'group-stage' : 'group-owner'} icon={<LayoutGrid {...i16} />}>{byOwner ? 'Board by stage' : 'Board by owner'}</MenuItem> : null}
              {others.length > 0 ? <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete view</MenuItem> : null}
            </MenuSection>
          </Menu>
        </MenuTrigger>
        <SegmentedControl aria-label="Layout" size="sm" selectedKey={view.layout} onSelectionChange={(k) => edit({ layout: k === 'board' ? 'board' : 'table' })}
          items={[{ id: 'table', label: 'Table', icon: <LayoutList {...i14} /> }, { id: 'board', label: 'Board', icon: <LayoutGrid {...i14} /> }]} />
        <span className="tf-rec__spacer" />
        <SearchField label={`Search ${def.many}`} placeholder={`Search ${def.many}`} size="sm" value={query} onChange={setQuery} className="tf-rec__search" />
        <MenuTrigger>
          <IconButton label={`More for ${def.many}`} size="md"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label={`More for ${def.many}`} placement="bottom end" onAction={(k) => { if (k === 'export') void exportCsv(); else if (k === 'export-all') void exportCsv(undefined, true); else if (k === 'import') onImport?.(); else if (k === 'dupes') onDuplicates?.(); else if (k === 'attrs') onAttributes?.(); }}>
            {onImport && canEdit ? <MenuItem id="import" icon={<Upload {...i16} />}>Import {def.many}</MenuItem> : null}
            <MenuItem id="export" icon={<Download {...i16} />} description={`${sorted.length} rows, ${columns.length} columns`}>Export this view</MenuItem>
            {columns.length < def.columns.length ? <MenuItem id="export-all" icon={<Download {...i16} />} description={`${sorted.length} rows, all ${def.columns.length} columns`}>Export with hidden columns</MenuItem> : null}
            {onDuplicates || (onAttributes && canEdit) ? <MenuSeparator /> : null}
            {onDuplicates ? <MenuItem id="dupes" icon={<Users {...i16} />}>Find duplicates</MenuItem> : null}
            {onAttributes && canEdit ? <MenuItem id="attrs" icon={<Plus {...i16} />}>Add or change attributes</MenuItem> : null}
          </Menu>
        </MenuTrigger>
        {canEdit && <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setCreating(true)}>New {def.one}</Button>}
      </div>
      {!canEdit && <Callout tone="info">You’re previewing as a {state.previewRole?.toLowerCase()}: you can look, but not change {def.many}.</Callout>}
      {pairs > 0 && onDuplicates && <Callout tone="info" action={{ label: 'Review', onPress: onDuplicates }}>{pairs === 1 ? `1 pair of ${def.many} looks like a duplicate.` : `${pairs} pairs of ${def.many} look like duplicates.`}</Callout>}
      <div className="tf-rec__filters">
      <FilterBar fields={fields} filters={view.filters} onFiltersChange={(filters) => edit({ filters })} match={view.match ?? 'all'} onMatchChange={(match) => edit({ match })} sorts={view.sorts} onSortsChange={(sorts) => edit({ sorts })}
        columns={viewColumns} onColumnsChange={(cols) => edit({ hidden: cols.filter((c) => !c.isShown).map((c) => c.id) })} totalCount={all.length} hiddenCount={all.length - rows.length} noun={def.many} startFilter={startFilter} />
      {draft && (
        <span className="tf-rec__draft">
          <Button size="sm" variant="ghost" onPress={() => { const was = draft; setDraft(undefined); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => setDraft(was) } }); }}>Discard</Button>
          <Button size="sm" variant="secondary" onPress={() => { dispatch({ type: 'views/set', object, views: views.map((v) => (v.id === draft.id ? draft : v)) }); setDraft(undefined); toast({ message: `${draft.name} saved`, tone: 'success' }); }}>Save view</Button>
        </span>
      )}
      </div>
      <div className="tf-rec__split">
      {view.layout === 'board' ? (
        <div className="tf-rec__board">
          <Board label={`${def.many[0]?.toUpperCase()}${def.many.slice(1)} by ${boardField === 'stage' ? 'stage' : boardField}`} noun={def.many} columns={board} onOpen={setPeek}
            onToggleCollapse={(id) => setFolded((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onMove={(m) => { if (!canEdit) return; const field = boardField; const to = m.toColumnId; const list = (object === 'deals' ? state.deals : object === 'companies' ? state.companies : state.people) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>; const moved = m.cardIds.filter((id) => list.find((x) => x.id === id)?.[field] !== to); if (moved.length === 0) return;
              const many = moved.length === 1 ? def.one[0]?.toUpperCase() + def.one.slice(1) : `${moved.length} ${def.many}`;
              setMany(moved, field, to, field === 'owner' ? `${many} now owned by ${to}` : field === 'industry' ? `${many} now in ${to || 'no industry'}` : moved.length === 1 ? `Moved to ${to}` : `${moved.length} deals moved to ${to}`); }}
            onAdd={canEdit ? (columnId) => { if (boardField === 'owner') setNewOwner(columnId); else if (boardField === 'stage') setNewStage(columnId as Stage); setCreating(true); } : undefined} />
        </div>
      ) : (
        <div className="tf-rec__grid">
          <DataGrid onAddColumn={canEdit && onAttributes ? onAttributes : undefined} label={def.many} columns={columns} rows={shownRows} selectedKeys={selected} onSelectionChange={setSelected} summary={summary}
            sortDescriptor={view.sorts[0] ? { column: view.sorts[0].field, direction: view.sorts[0].direction } : undefined}
            onSortChange={(d: SortDescriptor) => edit({ sorts: [{ field: String(d.column), direction: d.direction }] })}
            onColumnAction={columnAction} columnActions={onAttributes && canEdit ? undefined : ['ascending', 'descending', 'filter', 'hide']}
            onCellChange={canEdit ? setCell : undefined} onRowAction={setPeek} onAddRow={canEdit ? () => { setCreating(true); return undefined; } : undefined} addLabel={`New ${def.one}`}
            emptyState={q || view.filters.length ? <span>No {def.many} match. <button type="button" className="tf-rec__link" onClick={() => { setQuery(''); if (view.filters.length) edit({ filters: [] }); }}>{view.filters.length ? 'Clear filters' : 'Clear search'}</button></span> : <span>No {def.many} yet.{canEdit ? <>{' '}<button type="button" className="tf-rec__link" onClick={() => setCreating(true)}>Add one</button>{onImport ? <> or <button type="button" className="tf-rec__link" onClick={() => onImport()}>import a CSV</button></> : null}.</> : null}</span>} />
        </div>
      )}
      {peek !== undefined && !peekGone && <RecordPanel isOpen onClose={() => setPeek(undefined)} objectName={def.one[0]?.toUpperCase() + def.one.slice(1)} recordKey={peek ?? ''}
        label={String((sorted[peekIndex] ?? all.find((r) => r.id === peek))?.values.name ?? '')} onExpand={() => { if (peek) onOpen(object, peek); }}
        position={peekIndex >= 0 ? { index: peekIndex + 1, total: sorted.length, onPrevious: () => setPeek(sorted[Math.max(0, peekIndex - 1)]?.id), onNext: () => setPeek(sorted[Math.min(sorted.length - 1, peekIndex + 1)]?.id) } : undefined}>
        {peek && <PeekBody state={state} object={object} id={peek} onCell={(c, v) => setCell(peek, c, v)} onOpen={onOpen} />}
      </RecordPanel>}
      </div>
      <BulkActionBar count={ids.length} onClear={() => setSelected(new Set())}>
        {!canEdit && <BarButton icon={<Download {...i16} />} onPress={() => { void exportCsv(ids); }}>Export</BarButton>}
        {canEdit && <BarButton icon={<Pencil {...i16} />} onPress={() => setBulkEdit(true)}>Edit field</BarButton>}
        {canEdit && <MenuTrigger>
          <BarButton icon={<UserRound {...i16} />}>Owner</BarButton>
          <Menu aria-label="Set owner" onAction={(k) => {
            setMany(ids, 'owner', String(k), `${ids.length} ${ids.length === 1 ? def.one : def.many} now owned by ${String(k)}`); setSelected(new Set()); refocus();
          }}>{state.members.map((m) => <MenuItem key={m.id} id={m.name}>{m.name}</MenuItem>)}</Menu>
        </MenuTrigger>}
        {canEdit && LISTS_ON && <MenuTrigger>
          <BarButton icon={<ListPlus {...i16} />}>Add to list</BarButton>
          <Menu aria-label="Add to list" onAction={(k) => {
            const l = state.lists.find((x) => x.id === String(k)); if (!l) return;
            const have = new Set(l.entries.map((e) => e.recordId));
            const fresh = ids.filter((id) => !(l.oncePerRecord && have.has(id)));
            const added = fresh.map((rid) => ({ id: newId('e'), recordId: rid, stage: l.stages[0] ?? '', priority: 'Medium' as const, next: '', added: new Date() }));
            dispatch({ type: 'list/entries', id: l.id, add: added });
            toast({ message: fresh.length === ids.length ? `${fresh.length} added to ${l.name}` : `${fresh.length} added to ${l.name}; ${ids.length - fresh.length} already there`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'list/entries', id: l.id, remove: added.map((e) => e.id) }) } });
            setSelected(new Set());
          }}>
            {state.lists.filter((l) => l.object === object && !l.archived).length === 0 ? <MenuItem id="none" isDisabled>No lists of {def.many} yet</MenuItem>
              : state.lists.filter((l) => l.object === object && !l.archived).map((l) => <MenuItem key={l.id} id={l.id} description={`${liveEntries(state, l).length} on it`}>{l.name}</MenuItem>)}
          </Menu>
        </MenuTrigger>}
        {canEdit && <BarButton icon={<Download {...i16} />} onPress={() => { void exportCsv(ids); }}>Export</BarButton>}
        {canEdit && <BarButton icon={<Trash2 {...i16} />} onPress={() => { const gone = [...ids]; dispatch({ type: 'records/remove', object, ids: gone }); toast({ message: `${gone.length} ${gone.length === 1 ? def.one : def.many} moved to Trash`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/untrash', ids: gone }) } }); setSelected(new Set()); refocus(); }}>Delete</BarButton>}
      </BulkActionBar>
      {creating && <NewRecord state={state} object={object} one={def.one} initialName={startNew} onClose={() => { setCreating(false); setNewStage(undefined); }} onCreate={(name, extra, more) => {
        const id = newId(object.slice(0, 1));
        if (object === 'people') dispatch({ type: 'person/set', person: { id, name, email: extra.email ?? '', title: extra.title ?? '', companyId: extra.company || undefined, owner: state.me, tags: [], created: new Date() } });
        else if (object === 'companies') dispatch({ type: 'company/set', company: { id, name, domain: extra.domain ?? '', industry: '', size: '', city: '', owner: state.me, created: new Date() } });
        else dispatch({ type: 'deal/set', deal: { id, name, companyId: extra.company ?? '', stage: newStage ?? 'Lead', amount: Number(extra.amount) || 0, owner: newOwner ?? state.me, close: new Date(Date.now() + 30 * 86_400_000), created: new Date() } });
        setFresh((f) => new Set(f).add(id));
        toast({ message: `${name} created`, tone: 'success', action: { label: 'Open', onAction: () => onOpen(object, id) } });
        if (!more) { setCreating(false); setNewStage(undefined); setNewOwner(undefined); }
      }} />}
      {renaming && <RenameDialog title="Rename view" label="Name" value={view.name} onClose={() => setRenaming(false)} onSave={(name) => { const next = { ...(saved ?? view), name }; dispatch({ type: 'views/set', object, views: views.map((v) => (v.id === view.id ? next : v)) }); if (draft) setDraft({ ...draft, name }); setRenaming(false); toast({ message: 'View renamed', tone: 'success' }); }} />}
      {bulkEdit && <BulkEdit columns={def.columns.filter((c) => !c.isReadOnly && !['name', 'email', 'domain'].includes(c.id))} count={ids.length} members={state.members.map((m) => m.name)} onClose={() => setBulkEdit(false)}
        onApply={(col, value) => { const c = def.columns.find((x) => x.id === col); setMany(ids, col, col === 'amount' ? Number(value) || 0 : value, `${c?.name ?? 'Field'} ${value === '' ? 'cleared' : `set to ${c?.options?.find((o) => o.id === value)?.label ?? value}`} on ${ids.length} ${ids.length === 1 ? def.one : def.many}`); setBulkEdit(false); setSelected(new Set()); refocus(); }} />}
      {naming && <ViewNamer onClose={() => setNaming(false)} onSave={(name, isPrivate) => {
        const v: SavedView = { ...view, id: newId('v'), name, isPrivate };
        dispatch({ type: 'views/set', object, views: [...views, v] }); setViewId(v.id); setDraft(undefined); setNaming(false);
      }} />}
    </div>
  );
}

/** The record beside the list: its fields, editable, and what it's linked to. */
function PeekBody({ state, object, id, onCell, onOpen }: { readonly state: AppState; readonly object: ObjectId; readonly id: string; readonly onCell: (c: string, v: string) => void; readonly onOpen: (o: ObjectId, id: string) => void }) {
  const owners = state.members.map((m) => ({ id: m.name, name: m.name }));
  const row = (a: Attribute, v: AttributeValue, col: string) => <AttributeRow key={a.id} attribute={a} value={v} onChange={(x) => onCell(col, typeof x === 'object' && x !== null && 'name' in x ? String((x as { name: string }).name) : String(x ?? ''))} />;
  const ownerAttr: Attribute = { id: 'owner', name: 'Owner', type: 'actor', candidates: owners };
  if (object === 'people') {
    const p = state.people.find((x) => x.id === id); if (!p) return null;
    const co = state.companies.find((c) => c.id === p.companyId);
    const deals = state.deals.filter((d) => d.contactId === p.id);
    return (
      <div className="tf-rec__peek">
        <div className="tf-rec__peekhead"><Avatar name={p.name} size={44} /><span><strong>{p.name}</strong><span className="tf-rec__muted">{[p.title, co?.name].filter(Boolean).join(' · ')}</span></span></div>
        {row({ id: 'email', name: 'Email', type: 'email' }, p.email, 'email')}
        {row({ id: 'phone', name: 'Phone', type: 'phone' }, p.phone, 'phone')}
        {row({ id: 'title', name: 'Job title', type: 'text' }, p.title, 'title')}
        {row(ownerAttr, { id: p.owner, name: p.owner }, 'owner')}
        <RecordSection title="Company" count={co ? 1 : 0}>{co && <button type="button" className="tf-rec__rel" onClick={() => onOpen('companies', co.id)}><Avatar name={co.name} size={20} shape="square" />{co.name}</button>}</RecordSection>
        <RecordSection title="Deals" count={deals.length}>{deals.map((d) => <button key={d.id} type="button" className="tf-rec__rel" onClick={() => onOpen('deals', d.id)}>{d.name}<Tag size="sm" hue={STAGE_LOOK[d.stage].hue} status={STAGE_LOOK[d.stage].status}>{d.stage}</Tag></button>)}</RecordSection>
      </div>
    );
  }
  if (object === 'companies') {
    const c = state.companies.find((x) => x.id === id); if (!c) return null;
    const people = state.people.filter((p) => p.companyId === c.id);
    const deals = state.deals.filter((d) => d.companyId === c.id);
    return (
      <div className="tf-rec__peek">
        <div className="tf-rec__peekhead"><Avatar name={c.name} size={44} shape="square" /><span><strong>{c.name}</strong><span className="tf-rec__muted">{[c.domain, c.city].filter(Boolean).join(' · ')}</span></span></div>
        {row({ id: 'domain', name: 'Domain', type: 'domain' }, c.domain, 'domain')}
        {row({ id: 'industry', name: 'Industry', type: 'select', options: objectDef('companies', state).columns.find((x) => x.id === 'industry')?.options?.map((o) => ({ id: o.id, label: o.label, hue: o.hue ?? 'gray' })) ?? [] }, c.industry, 'industry')}
        {row({ id: 'size', name: 'Employees', type: 'text' }, c.size, 'size')}
        {row(ownerAttr, { id: c.owner, name: c.owner }, 'owner')}
        <RecordSection title="People" count={people.length}>{people.map((p) => <button key={p.id} type="button" className="tf-rec__rel" onClick={() => onOpen('people', p.id)}><Avatar name={p.name} size={20} />{p.name}<span className="tf-rec__muted">{p.title}</span></button>)}</RecordSection>
        <RecordSection title="Deals" count={deals.length}>{deals.map((d) => <button key={d.id} type="button" className="tf-rec__rel" onClick={() => onOpen('deals', d.id)}>{d.name}<span className="tf-rec__muted tf-num">{inr(d.amount)}</span></button>)}</RecordSection>
      </div>
    );
  }
  const d = state.deals.find((x) => x.id === id); if (!d) return null;
  const co = state.companies.find((c) => c.id === d.companyId); const contact = state.people.find((p) => p.id === d.contactId);
  return (
    <div className="tf-rec__peek">
      <div className="tf-rec__peekhead"><Avatar name={co?.name ?? d.name} size={44} shape="square" /><span><strong>{d.name}</strong><span className="tf-rec__muted tf-num">{[co?.name, d.amount ? inr(d.amount) : ''].filter(Boolean).join(' · ')}</span></span></div>
      {row({ id: 'stage', name: 'Stage', type: 'status', options: STAGES.map((x) => ({ id: x, label: x, hue: STAGE_LOOK[x].hue, shape: STAGE_LOOK[x].status })) }, d.stage, 'stage')}
      {row({ id: 'amount', name: 'Amount', type: 'currency', currency: 'INR' }, d.amount, 'amount')}
      {row({ id: 'close', name: 'Close date', type: 'date' }, ymd(d.close), 'close')}
      {row(ownerAttr, { id: d.owner, name: d.owner }, 'owner')}
      {d.stage !== 'Won' && d.stage !== 'Lost' && <p className="tf-rec__muted tf-num tf-rec__dealfacts">{STAGE_ODDS[d.stage]}% likely · {inr(Math.round((d.amount * STAGE_ODDS[d.stage]) / 100))} weighted · {daysInStage(d)} days in {d.stage}{daysInStage(d) > STALE_DAYS ? ', stale' : ''}</p>}
      <RecordSection title="Contact" count={contact ? 1 : 0}>{contact && <button type="button" className="tf-rec__rel" onClick={() => onOpen('people', contact.id)}><Avatar name={contact.name} size={20} />{contact.name}<span className="tf-rec__muted">{contact.title}</span></button>}</RecordSection>
    </div>
  );
}

function NewRecord({ state, object, one, initialName = '', onClose, onCreate }: { readonly state: AppState; readonly object: ObjectId; readonly one: string; readonly initialName?: string; readonly onClose: () => void; readonly onCreate: (name: string, extra: Readonly<Record<string, string>>, more: boolean) => void }) {
  const [name, setName] = useState(initialName);
  const [extra, setExtra] = useState<Readonly<Record<string, string>>>({});
  const [more, setMore] = useState(false);
  const set = (k: string, v: string) => setExtra((e) => ({ ...e, [k]: v }));
  // A likely duplicate: say so under the field, never block.
  const twin = name.trim().length > 2 ? (object === 'people' ? state.people : object === 'companies' ? state.companies : state.deals).find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) : undefined;
  const mail = (extra.email ?? '').trim().toLowerCase();
  const [mailLeft, setMailLeft] = useState(false);
  const badMail = mail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
  const mailTwin = mail && !badMail ? state.people.find((p) => p.email.toLowerCase() === mail) : undefined;
  const domain = (extra.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const domainTwin = object === 'companies' && domain ? state.companies.find((c) => c.domain.toLowerCase() === domain) : undefined;
  const go = () => { if (!name.trim() || badMail) return; onCreate(name.trim(), domain ? { ...extra, domain } : extra, more); setName(''); setExtra({}); };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`New ${one}`}
      actions={<><Checkbox isSelected={more} onChange={setMore}>Create more</Checkbox><span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || badMail || (object === 'deals' && !extra.company)} onPress={go}>Create {one}</Button></>}>
      <form className="tf-rec__form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <TextField label={object === 'deals' ? 'Deal name' : 'Name'} value={name} onChange={setName} autoFocus isRequired description={twin ? `There's already a ${one} called ${twin.name}.` : undefined} />
        {object === 'people' && <><TextField label="Email" type="email" value={extra.email ?? ''} onChange={(v) => set('email', v)} onBlur={() => setMailLeft(true)} isInvalid={badMail && mailLeft} errorMessage="Check the email: it needs an @ and a domain." description={mailTwin ? `${mailTwin.name} already has this email.` : undefined} /><TextField label="Job title" value={extra.title ?? ''} onChange={(v) => set('title', v)} /></>}
        {object === 'companies' && <TextField label="Domain" value={extra.domain ?? ''} onChange={(v) => set('domain', v)} placeholder="acme.com" description={domainTwin ? `${domainTwin.name} already uses ${domain}.` : undefined} />}
        {(object === 'people' || object === 'deals') && <Select label="Company" searchable value={extra.company ?? null} onChange={(v) => set('company', v ?? '')} placeholder="Pick a company" description={object === 'deals' ? 'Every deal is with a company.' : 'Optional'} items={state.companies.map((c) => ({ id: c.id, label: c.name }))} />}
        {object === 'deals' && <TextField label="Amount (₹)" value={extra.amount ?? ''} onChange={(v) => set('amount', v.replace(/[^\d]/g, ''))} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function ViewNamer({ onClose, onSave }: { readonly onClose: () => void; readonly onSave: (name: string, isPrivate: boolean) => void }) {
  const [name, setName] = useState('');
  const [mine, setMine] = useState(false);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="New view" description="Starts from what you see now: its filters, sorts and columns."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onSave(name.trim(), mine)}>Create view</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={name} onChange={setName} autoFocus placeholder="Hot leads" />
        <Checkbox isSelected={mine} onChange={setMine}>Only me</Checkbox>
      </div>
    </Dialog>
  );
}


/** One name, in a dialog: rename a view, a list, a stage. Empty names are refused. */
export function RenameDialog({ title, label, value, onClose, onSave }: { readonly title: string; readonly label: string; readonly value: string; readonly onClose: () => void; readonly onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={title}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!v.trim() || v.trim() === value} onPress={() => onSave(v.trim())}>Save</Button></>}>
      <TextField label={label} value={v} onChange={setV} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && v.trim() && v.trim() !== value) onSave(v.trim()); }} />
    </Dialog>
  );
}

/** Edit one field on many records at once: pick the field, then a value or Clear. */
function BulkEdit({ columns, count, members, onClose, onApply }: { readonly columns: ReadonlyArray<GridColumn>; readonly count: number; readonly members: ReadonlyArray<string>; readonly onClose: () => void; readonly onApply: (col: string, value: string) => void }) {
  const [col, setCol] = useState(columns[0]?.id ?? '');
  const [value, setValue] = useState('');
  const c = columns.find((x) => x.id === col);
  const choices = c?.type === 'person' ? members.map((m) => ({ id: m, label: m })) : c?.options?.map((o) => ({ id: o.id, label: o.label }));
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Edit ${count} ${count === 1 ? 'record' : 'records'}`} description="The same value goes on every one. Undo puts each back as it was."
      actions={<><Button variant="ghost" slot="close">Cancel</Button>{c?.type !== 'person' && c?.type !== 'status' && <Button variant="secondary" onPress={() => onApply(col, '')}>Clear field</Button>}<Button variant="primary" isDisabled={!value} onPress={() => onApply(col, value)}>Set value</Button></>}>
      <div className="tf-rec__form">
        <Select label="Field" value={col} onChange={(v) => { if (v) { setCol(v); setValue(''); } }} items={columns.map((x) => ({ id: x.id, label: x.name }))} />
        {choices ? <Select label="Value" value={value || null} onChange={(v) => setValue(v ?? '')} placeholder="Pick one" items={choices} />
          : <TextField label="Value" value={value} onChange={setValue} inputMode={c?.type === 'number' ? 'numeric' : undefined} />}
      </div>
    </Dialog>
  );
}
