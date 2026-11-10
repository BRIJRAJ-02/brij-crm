// Lists: records of one object gathered for a purpose (a quarter's deals, people met at a conference), each entry with the list's own
// stage, priority and next step. Table or board; add entries by search; remove with Undo; New list asks name, of what, pipeline or blank.
import { useState } from 'react';
import type { Selection } from 'react-aria-components';
import { LayoutGrid, LayoutList, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
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
import { newId, recordName, type AppAction, type AppState, type CrmList, type ListEntry, type ObjectId } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const SHAPES = ['draft', 'progress', 'review', 'done'] as const;
const HUES = ['gray', 'blue', 'purple', 'green', 'orange', 'sky'] as const;
const OBJ_WORD: Readonly<Record<ObjectId, string>> = { people: 'people', companies: 'companies', deals: 'deals' };

/** Props for ListScreen. */
export interface ListScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly listId: string;
  readonly onOpenRecord: (object: ObjectId, id: string) => void;
  readonly onDeleted: () => void;
}

/** One list. */
export function ListScreen({ state, dispatch, listId, onOpenRecord, onDeleted }: ListScreenProps) {
  const { toast } = useToast();
  const list = state.lists.find((l) => l.id === listId);
  const [layout, setLayout] = useState<'table' | 'board'>('table');
  const [selected, setSelected] = useState<Selection>(new Set());
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  if (!list) return null;
  const set = (l: CrmList) => dispatch({ type: 'list/set', list: l });
  const setEntry = (e: ListEntry) => set({ ...list, entries: list.entries.map((x) => (x.id === e.id ? e : x)) });
  const before = list;
  const ids = selected === 'all' ? list.entries.map((e) => e.id) : [...selected].map(String);
  const stageOptions = list.stages.map((s, n) => ({ id: s, label: s, hue: HUES[n % HUES.length], status: SHAPES[Math.min(n, SHAPES.length - 1)] }));
  const columns: ReadonlyArray<GridColumn> = [
    { id: 'name', name: list.object === 'deals' ? 'Deal' : list.object === 'people' ? 'Person' : 'Company', type: 'name', width: 230, isSortable: true, isReadOnly: true },
    { id: 'stage', name: 'Stage', type: 'status', width: 160, options: stageOptions },
    { id: 'priority', name: 'Priority', type: 'select', width: 120, options: [{ id: 'High', label: 'High', hue: 'red' }, { id: 'Medium', label: 'Medium', hue: 'orange' }, { id: 'Low', label: 'Low', hue: 'gray' }] },
    { id: 'next', name: 'Next step', type: 'text', width: 240 },
    { id: 'sub', name: 'About', type: 'text', width: 220, isReadOnly: true },
    { id: 'added', name: 'Added', type: 'date', width: 120, isReadOnly: true },
  ];
  const rows = list.entries.map((e) => { const r = recordName(state, { object: list.object, id: e.recordId }); return { id: e.id, kind: list.object === 'people' ? 'person' as const : 'company' as const, values: { name: r.name, stage: e.stage, priority: e.priority, next: e.next, sub: r.sub, added: e.added.toISOString().slice(0, 10) } }; });
  const board: ReadonlyArray<BoardColumn> = stageOptions.map((o) => ({ id: o.id, title: o.label, status: o.status, hue: o.hue,
    cards: list.entries.filter((e) => e.stage === o.id).map((e) => { const r = recordName(state, { object: list.object, id: e.recordId }); return { id: e.id, title: r.name, description: e.next, tags: [{ label: e.priority, hue: e.priority === 'High' ? 'red' as const : e.priority === 'Medium' ? 'orange' as const : 'gray' as const }] }; }) }));
  const openEntry = (id: string) => { const e = list.entries.find((x) => x.id === id); if (e) onOpenRecord(list.object, e.recordId); };
  return (
    <div className="tf-rec">
      <div className="tf-rec__bar">
        <span className="tf-list__title"><strong>{list.name}</strong><span className="tf-rec__muted tf-num">{list.entries.length} {OBJ_WORD[list.object]}</span></span>
        <SegmentedControl aria-label="Layout" size="sm" selectedKey={layout} onSelectionChange={(k) => setLayout(k === 'board' ? 'board' : 'table')}
          items={[{ id: 'table', label: 'Table', icon: <LayoutList {...i14} /> }, { id: 'board', label: 'Board', icon: <LayoutGrid {...i14} /> }]} />
        <span className="tf-rec__spacer" />
        <MenuTrigger>
          <IconButton label="List settings"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="List" placement="bottom end" onAction={(k) => {
            if (k === 'settings') setSettings(true);
            else if (k === 'delete') { dispatch({ type: 'list/remove', id: list.id }); onDeleted(); toast({ message: `${list.name} deleted. The records themselves stay.`, action: { label: 'Undo', onAction: () => set(before) } }); }
          }}>
            <MenuItem id="settings">List settings</MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete list</MenuItem>
          </Menu>
        </MenuTrigger>
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setAdding(true)}>Add {OBJ_WORD[list.object]}</Button>
      </div>
      {list.entries.length === 0 ? <EmptyState icon={<ListChecks size={20} strokeWidth={1.75} />} title="Nothing on this list yet" description={`Add ${OBJ_WORD[list.object]} here, or from a record's Lists section.`} action={<Button size="sm" variant="primary" onPress={() => setAdding(true)}>Add {OBJ_WORD[list.object]}</Button>} />
        : layout === 'board' ? (
          <div className="tf-rec__board"><Board label={list.name} noun={OBJ_WORD[list.object]} columns={board} onOpen={openEntry}
            onMove={(m) => { set({ ...list, entries: list.entries.map((e) => (m.cardIds.includes(e.id) ? { ...e, stage: m.toColumnId } : e)) }); toast({ message: `Moved to ${m.toColumnId}`, action: { label: 'Undo', onAction: () => set(before) } }); }} /></div>
        ) : (
          <div className="tf-rec__grid"><DataGrid label={list.name} columns={columns} rows={rows} selectedKeys={selected} onSelectionChange={setSelected} onRowAction={openEntry}
            onCellChange={(rid, col, v) => { const e = list.entries.find((x) => x.id === rid); if (e) setEntry({ ...e, [col]: v } as ListEntry); }} /></div>
        )}
      <BulkActionBar count={ids.length} onClear={() => setSelected(new Set())}>
        <BarButton icon={<Trash2 {...i16} />} onPress={() => { set({ ...list, entries: list.entries.filter((e) => !ids.includes(e.id)) }); setSelected(new Set()); toast({ message: `${ids.length} removed from ${list.name}`, action: { label: 'Undo', onAction: () => set(before) } }); }}>Remove from list</BarButton>
      </BulkActionBar>
      {adding && <AddEntries state={state} list={list} onClose={() => setAdding(false)} onAdd={(recordIds) => {
        const fresh = recordIds.map((rid) => ({ id: newId('e'), recordId: rid, stage: list.stages[0] ?? '', priority: 'Medium' as const, next: '', added: new Date() }));
        set({ ...list, entries: [...list.entries, ...fresh] }); setAdding(false); toast({ message: `${fresh.length} added to ${list.name}`, tone: 'success' });
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
      <Select label="Find" searchable placeholder={`Search ${OBJ_WORD[list.object]}`} value={null} onChange={(v) => { if (v && !pick.includes(v)) setPick([...pick, v]); }} items={items.filter((i) => !pick.includes(i.id))} />
      {pick.length > 0 && <ul className="tf-list__picked">{pick.map((id) => <li key={id}>{items.find((i) => i.id === id)?.label}<button type="button" className="tf-rec__link" onClick={() => setPick(pick.filter((x) => x !== id))}>Remove</button></li>)}</ul>}
    </Dialog>
  );
}

function ListSettings({ list, onClose, onSave }: { readonly list: CrmList; readonly onClose: () => void; readonly onSave: (l: CrmList) => void }) {
  const [l, setL] = useState(list);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="List settings"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!l.name.trim()} onPress={() => onSave(l)}>Save</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={l.name} onChange={(name) => setL({ ...l, name })} />
        <TextField label="Stages" description="In order, separated by commas." value={l.stages.join(', ')} onChange={(v) => setL({ ...l, stages: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <Switch isSelected={l.oncePerRecord} onChange={(oncePerRecord) => setL({ ...l, oncePerRecord })}>Each record once</Switch>
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
