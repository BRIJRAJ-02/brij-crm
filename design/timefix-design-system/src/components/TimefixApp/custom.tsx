// Records of an object the owner made (Projects, Vendors): a table of its attributes, edited in place, with New, search, Export and Delete with Undo.
import { useRef, useState } from 'react';
import { Link } from '../Link/Link.tsx';
import type { Selection } from 'react-aria-components';
import { Boxes, Download, Plus, Settings2, Trash2 } from 'lucide-react';
import { DataGrid, type GridColumn } from '../DataGrid/DataGrid.tsx';
import { BulkActionBar, BarButton } from '../FloatingBar/FloatingBar.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { newId, ymdOf, type AppAction, type AppState, type CustomRecord, type ObjectSchema } from './data.ts';
import { canEditRecords } from './records.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Props for CustomRecordsScreen. */
export interface CustomRecordsScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly schema: ObjectSchema; readonly onAttributes: () => void }

/** One owner-made object's records. */
export function CustomRecordsScreen({ state, dispatch, schema, onAttributes }: CustomRecordsScreenProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection>(new Set());
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const canEdit = canEditRecords(state);
  const records = state.customRecords[schema.id] ?? [];
  const latest = useRef(state.customRecords); latest.current = state.customRecords;
  const attrs = schema.attributes.filter((a) => a.id !== 'name');
  const columns: ReadonlyArray<GridColumn> = [
    { id: 'name', name: 'Name', type: 'name', width: 220, isSortable: true },
    ...attrs.map((a): GridColumn => ({ id: a.id, name: a.name, width: 160, isReadOnly: a.isSystem, isSortable: true,
      type: a.id === 'created' ? 'date' : a.type === 'select' || a.type === 'status' ? a.type : a.type === 'number' || a.type === 'currency' ? 'number' : 'text',
      options: a.options?.filter((o) => !o.archived).map((o) => ({ id: o.id, label: o.label, hue: o.hue })) })),
  ];
  const q = query.trim().toLowerCase();
  const rows = records.filter((r) => !q || r.name.toLowerCase().includes(q) || Object.values(r.extra).some((v) => v.toLowerCase().includes(q)))
    .map((r) => ({ id: r.id, kind: 'company' as const, isNew: fresh.has(r.id), values: { name: r.name, created: ymdOf(r.created), ...r.extra } }));
  const ids = selected === 'all' ? rows.map((r) => r.id) : [...selected].map(String);
  const one = schema.one.toLowerCase(); const many = schema.many.toLowerCase();
  const set = (r: CustomRecord) => dispatch({ type: 'custom/set', object: schema.id, record: r });
  const exportCsv = async () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => columns.map((c) => esc(r.values[c.id as keyof typeof r.values])).join(','))].join('\n');
    if ((await saveFile(`${many}.csv`, new Blob([csv], { type: 'text/csv' }))) === 'saved') toast({ message: `${rows.length} ${rows.length === 1 ? one : many} exported`, tone: 'success' });
  };
  return (
    <div className="tf-rec">
      <div className="tf-rec__bar">
        <SearchField label={`Search ${many}`} placeholder={`Search ${many}`} size="sm" value={query} onChange={(v) => { setQuery(v); setSelected(new Set()); }} className="tf-rec__search" />
        <span className="tf-rec__spacer" />
        <Button variant="ghost" icon={<Settings2 {...i14} />} onPress={onAttributes}>Attributes</Button>
        {records.length > 0 && <Button variant="ghost" icon={<Download {...i14} />} onPress={() => { void exportCsv(); }}>Export</Button>}
        {canEdit && <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setCreating(true)}>New {one}</Button>}
      </div>
      {records.length === 0 ? (
        <div className="tf-app__empty"><EmptyState icon={<Boxes size={20} strokeWidth={1.75} />} title={`No ${many} yet`} description={`Add your first ${one}. Its ${attrs.length} attributes are set in Settings › Objects.`}
          action={canEdit ? <Button size="sm" variant="primary" onPress={() => setCreating(true)}>New {one}</Button> : undefined} /></div>
      ) : (
        <div className="tf-rec__grid">
          <DataGrid label={schema.many} columns={columns} rows={rows} selectedKeys={selected} onSelectionChange={setSelected} summary={`${rows.length === records.length ? rows.length : `${rows.length} of ${records.length}`} ${rows.length === 1 ? one : many}`}
            onCellChange={canEdit ? (rid, col, v) => { const r = records.find((x) => x.id === rid); if (!r) return; if (col === 'name' && !v.trim()) { toast({ message: 'A name can’t be empty.', tone: 'danger' }); return; } set(col === 'name' ? { ...r, name: v.trim() } : { ...r, extra: { ...r.extra, [col]: v } }); toast({ message: 'Saved', tone: 'success', action: { label: 'Undo', onAction: () => { const now = (latest.current[schema.id] ?? []).find((x) => x.id === rid); if (now) set(col === 'name' ? { ...now, name: r.name } : { ...now, extra: { ...now.extra, [col]: r.extra[col] ?? '' } }); } } }); } : undefined}
            onAddRow={canEdit ? () => { setCreating(true); return undefined; } : undefined} addLabel={`New ${one}`}
            emptyState={<span>No {many} match. <Link onPress={() => setQuery('')}>Clear search</Link></span>} />
        </div>
      )}
      <BulkActionBar count={canEdit ? ids.length : 0} onClear={() => setSelected(new Set())}>
        <BarButton icon={<Trash2 {...i16} />} onPress={() => {
          const gone = records.filter((r) => ids.includes(r.id));
          dispatch({ type: 'custom/remove', object: schema.id, ids: gone.map((r) => r.id) }); setSelected(new Set());
          toast({ message: `${gone.length} ${gone.length === 1 ? one : many} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'custom/restore', object: schema.id, records: gone }) } });
        }}>Delete</BarButton>
      </BulkActionBar>
      {creating && <NewCustom one={schema.one} taken={records.map((r) => r.name.toLowerCase())} onClose={() => setCreating(false)} onCreate={(name, more) => {
        const r: CustomRecord = { id: newId('cr'), name, owner: state.me, created: new Date(), extra: {} };
        set(r); setFresh((f) => new Set(f).add(r.id)); toast({ message: `${name} added`, tone: 'success' });
        if (!more) setCreating(false);
      }} />}
    </div>
  );
}

function NewCustom({ one, taken, onClose, onCreate }: { readonly one: string; readonly taken: ReadonlyArray<string>; readonly onClose: () => void; readonly onCreate: (name: string, more: boolean) => void }) {
  const [name, setName] = useState('');
  const dupe = taken.includes(name.trim().toLowerCase());
  const go = (more: boolean) => { if (!name.trim()) return; onCreate(name.trim(), more); setName(''); };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`New ${one.toLowerCase()}`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="secondary" isDisabled={!name.trim()} onPress={() => go(true)}>Add and another</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => go(false)}>Add</Button></>}>
      <TextField label="Name" value={name} onChange={setName} autoFocus description={dupe ? `There’s already a ${one.toLowerCase()} with this name. You can still add it.` : 'Fill in the rest in the table.'}
        onKeyDown={(e) => { if (e.key === 'Enter') go(false); }} />
    </Dialog>
  );
}
