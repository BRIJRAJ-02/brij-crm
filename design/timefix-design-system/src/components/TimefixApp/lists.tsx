// Lists: records of one object gathered for a purpose (a quarter's deals, people met at a conference), each entry with the list's own
// stage, priority and next step. Table or board; add entries by search; remove with Undo; New list asks name, of what, pipeline or blank.
import { useState } from 'react';
import type { Selection } from 'react-aria-components';
import { LayoutGrid, LayoutList, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { DataGrid, type GridColumn } from '../DataGrid/DataGrid.tsx';
import { Board, type BoardColumn } from '../Board/Board.tsx';
import { BulkActionBar, BarButton } from '../FloatingBar/FloatingBar.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { ListChecks } from 'lucide-react';
import { newId, recordName, type AppAction, type AppState, type CrmList, type ListEntry, type ObjectId, ymdOf } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const SHAPES = ['draft', 'progress', 'review', 'done'] as const;
const HUES = ['gray', 'blue', 'purple', 'green', 'orange', 'sky'] as const;
const OBJ_WORD: Readonly<Record<ObjectId, string>> = { people: 'people', companies: 'companies', deals: 'deals' };
const OBJ_ONE: Readonly<Record<ObjectId, string>> = { people: 'person', companies: 'company', deals: 'deal' };
const count = (n: number, o: ObjectId) => `${n} ${n === 1 ? OBJ_ONE[o] : OBJ_WORD[o]}`;

/** Props for ListScreen. */
export interface ListScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly listId: string;
  readonly onOpenRecord: (object: ObjectId, id: string) => void;
  readonly onDeleted: () => void;
  /** Undo of a delete: the list is back where it was; open it again. */
  readonly onRestored?: (id: string) => void;
}

/** One list. */
export function ListScreen({ state, dispatch, listId, onOpenRecord, onDeleted, onRestored }: ListScreenProps) {
  const { toast } = useToast();
  const list = state.lists.find((l) => l.id === listId);
  const [layout, setLayout] = useState<'table' | 'board'>('table');
  const [selected, setSelected] = useState<Selection>(new Set());
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  if (!list) return null;
  const set = (l: CrmList) => dispatch({ type: 'list/set', list: l });
  const setEntry = (e: ListEntry) => set({ ...list, entries: list.entries.map((x) => (x.id === e.id ? e : x)) });
  /** Entries whose record still exists; a deleted record's entry comes back if the record is restored. */
  const exists = (rid: string) => (list.object === 'people' ? state.people : list.object === 'companies' ? state.companies : state.deals).some((r) => r.id === rid);
  const live = list.entries.filter((e) => exists(e.recordId));
  const ids = selected === 'all' ? live.map((e) => e.id) : [...selected].map(String);
  const stageOptions = list.stages.map((s, n) => ({ id: s, label: s, hue: HUES[n % HUES.length], status: SHAPES[Math.min(n, SHAPES.length - 1)] }));
  const columns: ReadonlyArray<GridColumn> = [
    { id: 'name', name: list.object === 'deals' ? 'Deal' : list.object === 'people' ? 'Person' : 'Company', type: 'name', width: 230, isSortable: true, isReadOnly: true },
    { id: 'stage', name: 'Stage', type: 'status', width: 160, options: stageOptions },
    { id: 'priority', name: 'Priority', type: 'select', width: 120, options: [{ id: 'High', label: 'High', hue: 'red' }, { id: 'Medium', label: 'Medium', hue: 'orange' }, { id: 'Low', label: 'Low', hue: 'gray' }] },
    { id: 'next', name: 'Next step', type: 'text', width: 240 },
    { id: 'sub', name: 'About', type: 'text', width: 220, isReadOnly: true },
    { id: 'added', name: 'Added', type: 'date', width: 120, isReadOnly: true },
  ];
  const rows = live.map((e) => { const r = recordName(state, { object: list.object, id: e.recordId }); return { id: e.id, kind: list.object === 'people' ? 'person' as const : 'company' as const, values: { name: r.name, stage: e.stage, priority: e.priority, next: e.next, sub: r.sub, added: ymdOf(e.added) } }; });
  const board: ReadonlyArray<BoardColumn> = stageOptions.map((o) => ({ id: o.id, title: o.label, status: o.status, hue: o.hue,
    cards: live.filter((e) => e.stage === o.id).map((e) => { const r = recordName(state, { object: list.object, id: e.recordId }); return { id: e.id, title: r.name, description: e.next, tags: [{ label: e.priority, hue: e.priority === 'High' ? 'red' as const : e.priority === 'Medium' ? 'orange' as const : 'gray' as const }] }; }) }));
  const openEntry = (id: string) => { const e = list.entries.find((x) => x.id === id); if (e) onOpenRecord(list.object, e.recordId); };
  return (
    <div className="tf-rec">
      <div className="tf-rec__bar">
        <span className="tf-list__title"><h2>{list.name}</h2><span className="tf-rec__muted tf-num">{count(live.length, list.object)}</span></span>
        <SegmentedControl aria-label="Layout" size="sm" selectedKey={layout} onSelectionChange={(k) => setLayout(k === 'board' ? 'board' : 'table')}
          items={[{ id: 'table', label: 'Table', icon: <LayoutList {...i14} /> }, { id: 'board', label: 'Board', icon: <LayoutGrid {...i14} /> }]} />
        <span className="tf-rec__spacer" />
        <MenuTrigger>
          <IconButton label="List settings"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="List" placement="bottom end" onAction={(k) => {
            if (k === 'settings') setSettings(true);
            else if (k === 'delete') { const was = list; const at = state.lists.findIndex((x) => x.id === list.id); dispatch({ type: 'list/remove', id: list.id }); onDeleted();
              toast({ message: `${list.name} deleted. The records themselves stay.`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'list/insert', list: was, at }); onRestored?.(was.id); } } }); }
          }}>
            <MenuItem id="settings">List settings</MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete list</MenuItem>
          </Menu>
        </MenuTrigger>
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setAdding(true)}>Add {OBJ_WORD[list.object]}</Button>
      </div>
      {live.length === 0 ? <EmptyState icon={<ListChecks size={20} strokeWidth={1.75} />} title="Nothing on this list yet" description={`Add ${OBJ_WORD[list.object]} here, or pick them in ${list.object === 'people' ? 'People' : list.object === 'companies' ? 'Companies' : 'Deals'} and use Add to list.`} action={<Button size="sm" variant="primary" onPress={() => setAdding(true)}>Add {OBJ_WORD[list.object]}</Button>} />
        : layout === 'board' ? (
          <div className="tf-rec__board"><Board label={list.name} noun={OBJ_WORD[list.object]} columns={board} onOpen={openEntry}
            onMove={(m) => { const moved = live.filter((e) => m.cardIds.includes(e.id) && e.stage !== m.toColumnId); if (moved.length === 0) return;
              dispatch({ type: 'list/entries', id: list.id, stages: Object.fromEntries(moved.map((e) => [e.id, m.toColumnId])) });
              toast({ message: `Moved to ${m.toColumnId}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'list/entries', id: list.id, stages: Object.fromEntries(moved.map((e) => [e.id, e.stage])) }) } }); }} /></div>
        ) : (
          <div className="tf-rec__grid"><DataGrid label={list.name} columns={columns.map((c) => ({ ...c, isSortable: false }))} rows={rows} selectedKeys={selected} onSelectionChange={setSelected} onRowAction={openEntry}
            onCellChange={(rid, col, v) => { const e = list.entries.find((x) => x.id === rid); if (e) setEntry({ ...e, [col]: v } as ListEntry); }} /></div>
        )}
      <BulkActionBar count={ids.length} onClear={() => setSelected(new Set())}>
        <BarButton icon={<Trash2 {...i16} />} onPress={() => { const gone = list.entries.filter((e) => ids.includes(e.id)); dispatch({ type: 'list/entries', id: list.id, remove: gone.map((e) => e.id) }); setSelected(new Set());
          toast({ message: `${count(gone.length, list.object)} removed from ${list.name}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'list/entries', id: list.id, add: gone }) } }); }}>Remove from list</BarButton>
      </BulkActionBar>
      {adding && <AddEntries state={state} list={list} onClose={() => setAdding(false)} onAdd={(recordIds) => {
        const fresh = recordIds.map((rid) => ({ id: newId('e'), recordId: rid, stage: list.stages[0] ?? '', priority: 'Medium' as const, next: '', added: new Date() }));
        dispatch({ type: 'list/entries', id: list.id, add: fresh }); setAdding(false);
        toast({ message: `${count(fresh.length, list.object)} added to ${list.name}`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'list/entries', id: list.id, remove: fresh.map((e) => e.id) }) } });
      }} />}
      {settings && <ListSettings list={list} onClose={() => setSettings(false)} onSave={(l) => { set(l); setSettings(false); toast({ message: 'List saved', tone: 'success' }); }} />}
    </div>
  );
}

function AddEntries({ state, list, onClose, onAdd }: { readonly state: AppState; readonly list: CrmList; readonly onClose: () => void; readonly onAdd: (ids: ReadonlyArray<string>) => void }) {
  const [pick, setPick] = useState<ReadonlyArray<string>>([]);
  const pool = list.object === 'people' ? state.people : list.object === 'companies' ? state.companies : state.deals;
  const taken = new Set(list.entries.map((e) => e.recordId));
  const items = pool.filter((r) => !list.oncePerRecord || !taken.has(r.id)).map((r) => ({ id: r.id, label: r.name, description: recordName(state, { object: list.object, id: r.id }).sub }));
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Add to ${list.name}`} description={list.oncePerRecord ? 'Each record can be on this list once.' : undefined}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={pick.length === 0} onPress={() => onAdd(pick)}>{pick.length > 1 ? `Add ${pick.length}` : 'Add'}</Button></>}>
      {items.length === 0 ? <p className="tf-rec__muted">Every one of your {OBJ_WORD[list.object]} is already on this list.</p> : <Select label="Find" searchable placeholder={`Search ${OBJ_WORD[list.object]}`} value={null} onChange={(v) => { if (v && !pick.includes(v)) setPick([...pick, v]); }} items={items.filter((i) => !pick.includes(i.id))} />}
      {pick.length > 0 && <ul className="tf-list__picked">{pick.map((id) => <li key={id}>{items.find((i) => i.id === id)?.label}<button type="button" className="tf-rec__link" onClick={() => setPick(pick.filter((x) => x !== id))}>Remove</button></li>)}</ul>}
    </Dialog>
  );
}

/** Rename the list and its stages. Stages are rows: renaming one keeps its entries, removing one moves its entries to the first stage. */
function ListSettings({ list, onClose, onSave }: { readonly list: CrmList; readonly onClose: () => void; readonly onSave: (l: CrmList) => void }) {
  const [name, setName] = useState(list.name);
  const [once, setOnce] = useState(list.oncePerRecord);
  const [stages, setStages] = useState<ReadonlyArray<{ readonly key: string; readonly was?: string; readonly label: string }>>(list.stages.map((st, n) => ({ key: `s${n}`, was: st, label: st })));
  const clean = stages.map((x) => ({ ...x, label: x.label.trim() })).filter((x) => x.label);
  const dupe = new Set(clean.map((x) => x.label.toLowerCase())).size !== clean.length;
  const losing = list.stages.filter((st) => !clean.some((x) => x.was === st));
  const moving = list.entries.filter((e) => losing.includes(e.stage)).length;
  const save = () => {
    const first = clean[0]?.label ?? '';
    const rename = new Map(clean.filter((x) => x.was).map((x) => [x.was ?? '', x.label]));
    onSave({ ...list, name: name.trim(), oncePerRecord: once, stages: clean.map((x) => x.label), entries: list.entries.map((e) => ({ ...e, stage: rename.get(e.stage) ?? first })) });
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="List settings"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || clean.length === 0 || dupe} onPress={save}>Save</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={name} onChange={setName} isInvalid={!name.trim()} errorMessage={!name.trim() ? 'Give the list a name' : undefined} />
        <fieldset className="tf-set__check"><legend>Stages, in order</legend>
          {stages.map((x, n) => (
            <TextField key={x.key} aria-label={`Stage ${n + 1}`} value={x.label} onChange={(v) => setStages(stages.map((y) => (y.key === x.key ? { ...y, label: v } : y)))} placeholder="Stage name" autoFocus={x.was === undefined}
              suffix={<IconButton label={`Remove ${x.label || `stage ${n + 1}`}`} size="sm" isDisabled={stages.length === 1} onPress={() => setStages(stages.filter((y) => y.key !== x.key))}><X {...i14} /></IconButton>} />
          ))}
          <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setStages([...stages, { key: `n${Date.now()}`, label: '' }])}>Add a stage</Button>
          {dupe && <p className="tf-rec__muted">Two stages have the same name.</p>}
          {moving > 0 && clean[0] && <p className="tf-rec__muted">{moving} {moving === 1 ? 'entry moves' : 'entries move'} to {clean[0].label}.</p>}
        </fieldset>
        <Switch isSelected={once} onChange={setOnce}>Each record once</Switch>
      </div>
    </Dialog>
  );
}

/** New list: what it's called, what it holds, and whether it starts with stages. */
export function NewListDialog({ onClose, onCreate }: { readonly onClose: () => void; readonly onCreate: (l: CrmList) => void }) {
  const [name, setName] = useState('');
  const [object, setObject] = useState<ObjectId>('deals');
  const [kind, setKind] = useState<'pipeline' | 'blank'>('pipeline');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="New list"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onCreate({ id: newId('l'), name: name.trim(), object, oncePerRecord: true, entries: [],
        stages: kind === 'pipeline' ? ['To contact', 'In touch', 'Meeting booked', 'Closing'] : ['To do', 'Done'] })}>Create list</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={name} onChange={setName} autoFocus placeholder="Q1 renewals" />
        <Select label="Of" value={object} onChange={(v) => setObject((v ?? 'deals') as ObjectId)} items={[{ id: 'people', label: 'People' }, { id: 'companies', label: 'Companies' }, { id: 'deals', label: 'Deals' }]} />
        <div className="tf-bkf__group"><span className="tf-bkf__label">Starts as</span>
          <SegmentedControl aria-label="Starts as" size="sm" selectedKey={kind} onSelectionChange={(k) => setKind(k === 'blank' ? 'blank' : 'pipeline')} items={[{ id: 'pipeline', label: 'A pipeline' }, { id: 'blank', label: 'Blank' }]} />
        </div>
      </div>
    </Dialog>
  );
}
