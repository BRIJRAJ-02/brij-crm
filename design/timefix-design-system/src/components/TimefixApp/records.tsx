// Records: People, Companies, Deals. One toolbar (view, Table/Board, search, filters and sorts, Import/Export, New), a table you edit in place
// or a board you drag, bulk actions with Undo, and a record panel beside the list. A changed view is a draft: Save it or Discard it.
import { useMemo, useState, type ReactNode } from 'react';
import type { Selection, SortDescriptor } from 'react-aria-components';
import { Building2, CircleDollarSign, Download, LayoutGrid, LayoutList, ListPlus, MoreHorizontal, Plus, Trash2, Upload, UserRound, Users } from 'lucide-react';
import { DataGrid, type GridColumn, type GridRecord } from '../DataGrid/DataGrid.tsx';
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
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { duplicatePairs } from './duplicates.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { Attribute, AttributeValue } from '../AttributeField/AttributeField.tsx';
import { STAGES, inr, newId, type AppAction, type AppState, type Company, type Deal, type ObjectId, type Person, type SavedView, type Stage } from './data.ts';

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
      { id: 'amount', name: 'Amount (₹)', type: 'number', width: 140, isSortable: true }, { id: 'close', name: 'Close date', type: 'date', width: 130, isSortable: true, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true }],
    rows: (s) => s.deals.map((d) => ({ id: d.id, kind: 'company', values: { name: d.name, company: coName(d.companyId), stage: d.stage, amount: d.amount, close: ymd(d.close), owner: d.owner } })),
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
}

/** One object's records. */
export function RecordsScreen({ state, dispatch, object, onOpen, onImport, onDuplicates, startNew }: RecordsScreenProps) {
  const { toast } = useToast();
  const def = objectDef(object, state);
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
  const [naming, setNaming] = useState(false);
  const all = useMemo(() => def.rows(state), [state, object]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null;
  const edit = (patch: Partial<SavedView>) => { setDraft({ ...view, ...patch }); if (patch.filters) setSelected(new Set()); };
  const q = query.trim().toLowerCase();
  const rows = all.filter((r) => view.filters.every((f) => passes(r, f)) && (!q || Object.values(r.values).some((v) => String(v ?? '').toLowerCase().includes(q))));
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
  const cellValue = (col: string, value: string): unknown => (col === 'amount' ? Number(value) || 0 : col === 'close' ? (dayOf(value) ?? new Date()) : value);
  const recordOf = (rowId: string): Readonly<Record<string, unknown>> | undefined => (object === 'people' ? state.people : object === 'companies' ? state.companies : state.deals).find((x) => x.id === rowId) as Readonly<Record<string, unknown>> | undefined;
  const setCell = (rowId: string, col: string, value: string) => { if (recordOf(rowId)) dispatch({ type: 'records/fields', object, changes: [{ id: rowId, patch: { [col]: cellValue(col, value) } }] }); };
  /** Sets one field on many records; Undo puts back only that field, so later edits stay. */
  const setMany = (rowIds: ReadonlyArray<string>, col: string, value: unknown, message: string) => {
    const was = rowIds.map((id) => ({ id, patch: { [col]: recordOf(id)?.[col] } }));
    dispatch({ type: 'records/fields', object, changes: rowIds.map((id) => ({ id, patch: { [col]: value } })) });
    toast({ message, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: was }) } });
  };
  const exportCsv = async (only?: ReadonlyArray<string>) => {
    const pick = only ? sorted.filter((r) => only.includes(r.id)) : sorted;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.map((c) => esc(c.name)).join(','), ...pick.map((r) => columns.map((c) => esc(r.values[c.id])).join(','))].join('\n');
    const o = await saveFile(`${def.many}.csv`, new Blob([csv], { type: 'text/csv' }));
    if (o === 'saved') toast({ message: `${pick.length} ${pick.length === 1 ? def.one : def.many} exported`, tone: 'success' });
  };
  const board: ReadonlyArray<BoardColumn> = STAGES.map((stage) => ({ id: stage, title: stage, status: STAGE_LOOK[stage].status, hue: STAGE_LOOK[stage].hue,
    cards: sorted.filter((r) => r.values.stage === stage).map((r) => { const d = state.deals.find((x) => x.id === r.id); return { id: r.id, title: String(r.values.name), description: [r.values.company, Number(r.values.amount) ? inr(Number(r.values.amount)) : ''].filter(Boolean).join(' · '), people: d ? [d.owner] : [], date: d?.close }; }) }));
  const peekIndex = peek ? sorted.findIndex((r) => r.id === peek) : -1;
  const peekGone = peek !== undefined && !all.some((r) => r.id === peek);
  const pairs = onDuplicates ? duplicatePairs(state, new Set(state.notDupes)).length : 0;

  return (
    <div className="tf-rec">
      <div className="tf-rec__bar">
        <Select label="View" isLabelHidden className="tf-rec__view" value={view.id} onChange={(v) => {
          if (v === 'new') { setNaming(true); return; }
          if (!v || v === view.id) return;
          const was = draft; const wasId = viewId; setViewId(v); setDraft(undefined); setSelected(new Set());
          if (was) toast({ message: `Unsaved changes to ${was.name} discarded`, action: { label: 'Undo', onAction: () => { setViewId(wasId); setDraft(was); } } });
        }}
          items={[...views.map((v) => ({ id: v.id, label: v.name, description: v.isPrivate ? 'Only you' : undefined })), { id: 'new', label: 'New view…' }]} />
        {object === 'deals' && <SegmentedControl aria-label="Layout" size="sm" selectedKey={view.layout} onSelectionChange={(k) => edit({ layout: k === 'board' ? 'board' : 'table' })}
          items={[{ id: 'table', label: 'Table', icon: <LayoutList {...i14} /> }, { id: 'board', label: 'Board', icon: <LayoutGrid {...i14} /> }]} />}
        <SearchField label={`Search ${def.many}`} placeholder={`Search ${def.many}`} size="sm" value={query} onChange={setQuery} className="tf-rec__search" />
        <span className="tf-rec__spacer" />
        {draft && (
          <span className="tf-rec__draft">
            <span className="tf-rec__muted">View changed</span>
            <Button size="sm" variant="ghost" onPress={() => { const was = draft; setDraft(undefined); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => setDraft(was) } }); }}>Discard</Button>
            <Button size="sm" variant="secondary" onPress={() => { dispatch({ type: 'views/set', object, views: views.map((v) => (v.id === draft.id ? draft : v)) }); setDraft(undefined); toast({ message: `${draft.name} saved`, tone: 'success' }); }}>Save view</Button>
          </span>
        )}
        <MenuTrigger>
          <IconButton label="Import or export" size="md"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="Import or export" placement="bottom end" onAction={(k) => { if (k === 'export') void exportCsv(); else if (k === 'import') onImport?.(); else if (k === 'dupes') onDuplicates?.(); }}>
            {onImport ? <MenuItem id="import" icon={<Upload {...i16} />}>Import {def.many}</MenuItem> : null}
            <MenuItem id="export" icon={<Download {...i16} />} description={`${sorted.length} rows, ${columns.length} columns`}>Export this view</MenuItem>
            {onDuplicates ? <MenuItem id="dupes" icon={<Users {...i16} />}>Find duplicates</MenuItem> : null}
          </Menu>
        </MenuTrigger>
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setCreating(true)}>New {def.one}</Button>
      </div>
      {pairs > 0 && onDuplicates && <Callout tone="info" action={{ label: 'Review', onPress: onDuplicates }}>{pairs === 1 ? '1 pair of people looks like a duplicate.' : `${pairs} pairs of people look like duplicates.`}</Callout>}
      <FilterBar fields={fields} filters={view.filters} onFiltersChange={(filters) => edit({ filters })} sorts={view.sorts} onSortsChange={(sorts) => edit({ sorts })}
        columns={viewColumns} onColumnsChange={(cols) => edit({ hidden: cols.filter((c) => !c.isShown).map((c) => c.id) })} totalCount={all.length} hiddenCount={all.length - rows.length} noun={def.many} />
      <div className="tf-rec__split">
      {view.layout === 'board' && object === 'deals' ? (
        <div className="tf-rec__board">
          <Board label="Deals by stage" noun="deals" columns={board} onOpen={setPeek}
            onMove={(m) => { const stage = m.toColumnId as Stage; const moved = m.cardIds.filter((id) => state.deals.find((x) => x.id === id)?.stage !== stage); if (moved.length === 0) return;
              setMany(moved, 'stage', stage, moved.length === 1 ? `Moved to ${stage}` : `${moved.length} deals moved to ${stage}`); }}
            onAdd={(columnId) => { setNewStage(columnId as Stage); setCreating(true); }} />
        </div>
      ) : (
        <div className="tf-rec__grid">
          <DataGrid label={def.many} columns={columns} rows={sorted} selectedKeys={selected} onSelectionChange={setSelected}
            sortDescriptor={view.sorts[0] ? { column: view.sorts[0].field, direction: view.sorts[0].direction } : undefined}
            onSortChange={(d: SortDescriptor) => edit({ sorts: [{ field: String(d.column), direction: d.direction }] })}
            onCellChange={setCell} onRowAction={setPeek} onAddRow={() => { setCreating(true); return undefined; }} addLabel={`New ${def.one}`}
            emptyState={q || view.filters.length ? <span>No {def.many} match. <button type="button" className="tf-rec__link" onClick={() => { setQuery(''); if (view.filters.length) edit({ filters: [] }); }}>{view.filters.length ? 'Clear filters' : 'Clear search'}</button></span> : `No ${def.many} yet.`} />
        </div>
      )}
      {peek !== undefined && !peekGone && <RecordPanel isOpen onClose={() => setPeek(undefined)} objectName={def.one[0]?.toUpperCase() + def.one.slice(1)} recordKey={peek ?? ''}
        label={String(sorted[peekIndex]?.values.name ?? '')} onExpand={() => { if (peek) onOpen(object, peek); }}
        position={peekIndex >= 0 ? { index: peekIndex + 1, total: sorted.length, onPrevious: () => setPeek(sorted[Math.max(0, peekIndex - 1)]?.id), onNext: () => setPeek(sorted[Math.min(sorted.length - 1, peekIndex + 1)]?.id) } : undefined}>
        {peek && <PeekBody state={state} object={object} id={peek} onCell={(c, v) => setCell(peek, c, v)} onOpen={onOpen} />}
      </RecordPanel>}
      </div>
      <BulkActionBar count={ids.length} onClear={() => setSelected(new Set())}>
        <MenuTrigger>
          <BarButton icon={<UserRound {...i16} />}>Owner</BarButton>
          <Menu aria-label="Set owner" onAction={(k) => {
            setMany(ids, 'owner', String(k), `${ids.length} ${ids.length === 1 ? def.one : def.many} now owned by ${String(k)}`); setSelected(new Set());
          }}>{state.members.map((m) => <MenuItem key={m.id} id={m.name}>{m.name}</MenuItem>)}</Menu>
        </MenuTrigger>
        <MenuTrigger>
          <BarButton icon={<ListPlus {...i16} />}>Add to list</BarButton>
          <Menu aria-label="Add to list" onAction={(k) => {
            const l = state.lists.find((x) => x.id === String(k)); if (!l) return;
            const have = new Set(l.entries.map((e) => e.recordId));
            const fresh = ids.filter((id) => !(l.oncePerRecord && have.has(id)));
            dispatch({ type: 'list/set', list: { ...l, entries: [...l.entries, ...fresh.map((rid) => ({ id: newId('e'), recordId: rid, stage: l.stages[0] ?? '', priority: 'Medium' as const, next: '', added: new Date() }))] } });
            toast({ message: fresh.length === ids.length ? `${fresh.length} added to ${l.name}` : `${fresh.length} added to ${l.name}; ${ids.length - fresh.length} already there`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'list/set', list: l }) } });
            setSelected(new Set());
          }}>
            {state.lists.filter((l) => l.object === object).length === 0 ? <MenuItem id="none" isDisabled>No lists of {def.many} yet</MenuItem>
              : state.lists.filter((l) => l.object === object).map((l) => <MenuItem key={l.id} id={l.id} description={`${l.entries.length} on it`}>{l.name}</MenuItem>)}
          </Menu>
        </MenuTrigger>
        <BarButton icon={<Download {...i16} />} onPress={() => { void exportCsv(ids); }}>Export</BarButton>
        <BarButton icon={<Trash2 {...i16} />} onPress={() => { const gone = [...ids]; dispatch({ type: 'records/remove', object, ids: gone }); toast({ message: `${gone.length} ${gone.length === 1 ? def.one : def.many} moved to Trash`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/untrash', ids: gone }) } }); setSelected(new Set()); }}>Delete</BarButton>
      </BulkActionBar>
      {creating && <NewRecord state={state} object={object} one={def.one} initialName={startNew} onClose={() => { setCreating(false); setNewStage(undefined); }} onCreate={(name, extra, more) => {
        const id = newId(object.slice(0, 1));
        if (object === 'people') dispatch({ type: 'person/set', person: { id, name, email: extra.email ?? '', title: extra.title ?? '', companyId: extra.company || undefined, owner: state.me, tags: [], created: new Date() } });
        else if (object === 'companies') dispatch({ type: 'company/set', company: { id, name, domain: extra.domain ?? '', industry: 'Software', size: '', city: '', owner: state.me, created: new Date() } });
        else dispatch({ type: 'deal/set', deal: { id, name, companyId: extra.company ?? '', stage: newStage ?? 'Lead', amount: Number(extra.amount) || 0, owner: state.me, close: new Date(Date.now() + 30 * 86_400_000), created: new Date() } });
        toast({ message: `${name} created`, tone: 'success', action: { label: 'Open', onAction: () => onOpen(object, id) } });
        if (!more) { setCreating(false); setNewStage(undefined); }
      }} />}
      {naming && <ViewNamer onClose={() => setNaming(false)} onSave={(name, isPrivate) => {
        const v: SavedView = { ...view, id: newId('v'), name, isPrivate };
        dispatch({ type: 'views/set', object, views: [...views, v] }); setViewId(v.id); setDraft(undefined); setNaming(false);
      }} />}
    </div>
  );
}

/** The record beside the list: its fields, editable, and what it's linked to. */
function PeekBody({ state, object, id, onCell, onOpen }: { readonly state: AppState; readonly object: ObjectId; readonly id: string; readonly onCell: (c: string, v: string) => void; readonly onOpen: (o: ObjectId, id: string) => void }) {
  const owners = state.members.map((m) => ({ id: m.id, name: m.name }));
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
  const go = () => { if (!name.trim()) return; onCreate(name.trim(), extra, more); setName(''); setExtra({}); };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`New ${one}`}
      actions={<><Checkbox isSelected={more} onChange={setMore}>Create more</Checkbox><span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={go}>Create {one}</Button></>}>
      <form className="tf-rec__form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <TextField label={object === 'deals' ? 'Deal name' : 'Name'} value={name} onChange={setName} autoFocus isRequired description={twin ? `There's already a ${one} called ${twin.name}.` : undefined} />
        {object === 'people' && <><TextField label="Email" type="email" value={extra.email ?? ''} onChange={(v) => set('email', v)} /><TextField label="Job title" value={extra.title ?? ''} onChange={(v) => set('title', v)} /></>}
        {object === 'companies' && <TextField label="Domain" value={extra.domain ?? ''} onChange={(v) => set('domain', v)} placeholder="acme.com" />}
        {(object === 'people' || object === 'deals') && <Select label="Company" value={extra.company ?? null} onChange={(v) => set('company', v ?? '')} placeholder="Pick a company" items={state.companies.map((c) => ({ id: c.id, label: c.name }))} />}
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

