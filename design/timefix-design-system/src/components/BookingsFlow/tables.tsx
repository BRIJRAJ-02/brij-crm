// A place's resources (spec 0065 H0, AC-6509), named for the kind it mostly books (tables, rooms, chairs): by zone, seats as fewest to
// most, online or staff only, joins its neighbour. Drag to order, or into another zone; select several for Zone, Online, Offline or
// Archive (Undo); archived ones under a fold with Restore; Delete asks first; a place holds at most 300. Lives in Availability.
import { useState } from 'react';
import { Archive, ArchiveRestore, Armchair, DoorOpen, MoreHorizontal, Pencil, Plus, Sofa, Table2, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { BulkActionBar, BarButton } from '../FloatingBar/FloatingBar.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { DragArea, DragGroup, useDragGroup } from '../../lib/drag.ts';
import { DragHandle, DragItem } from '../DragHandle/DragHandle.tsx';
import { cx } from '../../lib/cx.ts';
import { Section, i14 } from './parts.tsx';
import { nextId, plural, type BookingsAction, type BookingsState, type Table, tableCode } from './state.ts';

/** The most resources one place holds. */
export const TABLE_CAP = 300;
type Kind = NonNullable<Table['kind']>;
export const KINDS: ReadonlyArray<{ readonly id: Kind; readonly one: string; readonly many: string }> = [
  { id: 'table', one: 'Table', many: 'tables' }, { id: 'booth', one: 'Booth', many: 'booths' }, { id: 'room', one: 'Room', many: 'rooms' }, { id: 'chair', one: 'Chair', many: 'chairs' },
];
const KIND_ICON: Readonly<Record<Kind, typeof Table2>> = { table: Table2, booth: Sofa, room: DoorOpen, chair: Armchair };
const UNZONED = '';
export const seatsText = (t: Table) => ((t.minParty ?? 1) > 1 && (t.minParty ?? 1) < t.seats ? `Seats ${t.minParty}–${t.seats}` : `Seats ${t.seats}`);
/** "T1 to T10" → T1 … T10; any other text is one name. */
export function namesFrom(range: string, cap = 30): ReadonlyArray<string> {
  const m = range.trim().match(/^([A-Za-z ]*?)(\d+)\s*(?:to|-|–)\s*[A-Za-z ]*?(\d+)$/);
  if (m) { const [, p = '', a = '0', b = '0'] = m; const lo = Number(a); const hi = Math.min(Number(b), lo + cap - 1); return hi >= lo ? Array.from({ length: hi - lo + 1 }, (_, n) => `${p}${lo + n}`) : []; }
  return range.trim() ? [range.trim()] : [];
}

/** The Tables card. */
export function TablesSection({ state, dispatch }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void }) {
  const { toast } = useToast();
  const all = state.tables ?? [];
  const tables = all.filter((t) => !t.archived);
  const archived = all.filter((t) => t.archived);
  const zones = [...new Set(all.map((t) => t.area))].sort((a, b) => (a === UNZONED ? 1 : b === UNZONED ? -1 : 0));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Table>();
  const [removing, setRemoving] = useState<Table>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [zoning, setZoning] = useState(false);
  const counts = KINDS.map((k) => ({ ...k, n: tables.filter((t) => (t.kind ?? 'table') === k.id).length }));
  const main = [...counts].sort((a, b) => b.n - a.n)[0] ?? counts[0];
  const noun = main?.many ?? 'tables';
  const full = all.length >= TABLE_CAP;
  const booked = (t: Table) => state.meetings.filter((m) => m.tables?.includes(t.id) && m.status !== 'cancelled' && m.end > new Date()).length;
  const put = (next: ReadonlyArray<Table>, message?: string) => { const before = all; dispatch({ type: 'tables/set', tables: next }); if (message) toast({ message, action: { label: 'Undo', onAction: () => dispatch({ type: 'tables/set', tables: before }) } }); };
  const patchMany = (ids: ReadonlySet<string>, patch: Partial<Table>, message: string) => { put(all.map((t) => (ids.has(t.id) ? { ...t, ...patch } : t)), message); setPicked(new Set()); };
  const remove = (t: Table) => { put(all.filter((x) => x.id !== t.id), `${t.name} deleted`); setRemoving(undefined); };
  const set = (t: Table) => dispatch({ type: 'tables/set', tables: all.map((x) => (x.id === t.id ? t : x)) });
  const zoneName = (z: string) => z || 'Unzoned';
  return (
    <Section title={noun.charAt(0).toUpperCase() + noun.slice(1)} description={`${plural(tables.length, main?.many === 'tables' ? 'table' : (main?.one ?? 'table').toLowerCase())} · ${tables.reduce((n, t) => n + t.seats, 0)} seats. Guests get the best fit; joinable ones pair up for bigger parties. Drag to order, or into another zone.`}
      action={<Button size="sm" variant="secondary" icon={<Plus {...i14} />} isDisabled={full} onPress={() => setAdding(true)}>Add {noun}</Button>}>
      {full && <Callout tone="warning">A place holds at most {TABLE_CAP}. Archive or delete some to add more.</Callout>}
      <DragArea groups={Object.fromEntries(zones.map((z) => [z || 'unzoned', tables.filter((t) => t.area === z).map((t) => t.id)]))} groupName={(g) => (g === 'unzoned' ? 'Unzoned' : g)}
        textOf={(id) => all.find((t) => t.id === id)?.name ?? 'table'}
        overlay={(id) => { const t = all.find((x) => x.id === id); return t ? <div className="tf-bkf-rsc__row"><DragHandle label="" reveal="always" isLifted /><ResText t={t} /></div> : null; }}
        onChange={(next, moved) => {
          const order = zones.flatMap((z) => (next[z || 'unzoned'] ?? []).map((id) => { const t = all.find((x) => x.id === id); return t && t.area !== z ? { ...t, area: z } : t; })).filter((t): t is Table => Boolean(t));
          const t = order.find((x) => x.id === moved); const was = all.find((x) => x.id === moved);
          put([...order, ...archived], t && was && t.area !== was.area ? `${t.name} moved to ${zoneName(t.area)}` : undefined);
        }}>
        {(live) => zones.map((z) => <Zone key={z || 'unzoned'} id={z || 'unzoned'} name={zoneName(z)} ids={live[z || 'unzoned'] ?? []} all={all} picked={picked}
          onPick={(id, on) => setPicked((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n; })}
          onSet={set} onEdit={setEditing} onArchive={(t) => patchMany(new Set([t.id]), { archived: true }, `${t.name} archived. Its QR code stops working.`)}
          onDelete={(t) => { if (booked(t) > 0) setRemoving(t); else remove(t); }} />)}
      </DragArea>
      {archived.length > 0 && <ShowMore showLabel={`Archived · ${archived.length}`} hideLabel={`Hide archived · ${archived.length}`}>
        <ul className="tf-bkf-rsc__archived">{archived.map((t) => (
          <li key={t.id}><ResText t={t} />
            <Button size="sm" variant="ghost" icon={<ArchiveRestore {...i14} />} isDisabled={full} onPress={() => put(all.map((x) => (x.id === t.id ? { ...x, archived: undefined } : x)), `${t.name} restored`)}>Restore</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 {...i14} />} onPress={() => { if (booked(t) > 0) setRemoving(t); else remove(t); }}>Delete</Button></li>
        ))}</ul>
      </ShowMore>}
      {picked.size > 0 && (
        <BulkActionBar count={picked.size} onClear={() => setPicked(new Set())}>
          <MenuTrigger>
            <BarButton>Zone</BarButton>
            <Menu aria-label="Move to zone" onAction={(k) => { if (k === '__new') setZoning(true); else patchMany(picked, { area: String(k) === 'unzoned' ? UNZONED : String(k) }, `${plural(picked.size, 'table')} moved to ${String(k) === 'unzoned' ? 'Unzoned' : String(k)}`); }}>
              {zones.filter((z) => z).map((z) => <MenuItem key={z} id={z}>{z}</MenuItem>)}
              <MenuItem id="unzoned">Unzoned</MenuItem>
              <MenuSeparator />
              <MenuItem id="__new" icon={<Plus size={16} strokeWidth={1.75} />}>New zone…</MenuItem>
            </Menu>
          </MenuTrigger>
          <BarButton onPress={() => patchMany(picked, { online: true }, `${plural(picked.size, 'table')} bookable online`)}>Online</BarButton>
          <BarButton onPress={() => patchMany(picked, { online: false }, `${plural(picked.size, 'table')} staff only`)}>Offline</BarButton>
          <BarButton icon={<Archive {...i14} />} onPress={() => patchMany(picked, { archived: true }, `${plural(picked.size, 'table')} archived`)}>Archive</BarButton>
        </BulkActionBar>
      )}
      {zoning && <ZoneDialog taken={zones} onClose={() => setZoning(false)} onSave={(z) => { patchMany(picked, { area: z }, `${plural(picked.size, 'table')} moved to ${z}`); setZoning(false); }} />}
      {editing && <TableDialog table={editing} zones={zones} taken={all.filter((x) => x.id !== editing.id).map((x) => x.name.toLowerCase())} onClose={() => setEditing(undefined)}
        onSave={(t) => { set(t); setEditing(undefined); toast({ message: `${t.name} saved. Its QR code still works.`, tone: 'success' }); }} />}
      {removing && <Dialog isOpen onOpenChange={(o) => { if (!o) setRemoving(undefined); }} title={`Delete ${removing.name}?`}
        description={`${plural(booked(removing), 'upcoming reservation')} ${booked(removing) === 1 ? 'is' : 'are'} on it. They stay booked; give them another table from Reservations. Its printed QR code stops working.`}
        actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" onPress={() => remove(removing)}>Delete table</Button></>} />}
      {adding && <AddTables zones={zones} room={TABLE_CAP - all.length} taken={all.map((t) => t.name.toLowerCase())} onClose={() => setAdding(false)}
        onAdd={(made) => { dispatch({ type: 'tables/set', tables: [...all, ...made] }); setAdding(false); toast({ message: made.length === 1 ? `${made[0]?.name} added` : `${made.length} added: ${made[0]?.name} to ${made[made.length - 1]?.name}`, tone: 'success' }); }} />}
    </Section>
  );
}

function ResText({ t }: { readonly t: Table }) {
  const Icon = KIND_ICON[t.kind ?? 'table'];
  return <><span className="tf-bkf-rsc__icon" aria-hidden="true"><Icon size={16} strokeWidth={1.75} /></span><span className="tf-bkf-rsc__text"><strong>{t.name}</strong><span className="tf-bkf__muted tf-num">{seatsText(t)}{t.joinable ? ' · joins its neighbour' : ''}</span></span></>;
}

function Zone({ id, name, ids, all, picked, onPick, onSet, onEdit, onArchive, onDelete }: {
  readonly id: string; readonly name: string; readonly ids: ReadonlyArray<string>; readonly all: ReadonlyArray<Table>; readonly picked: ReadonlySet<string>; readonly onPick: (id: string, on: boolean) => void;
  readonly onSet: (t: Table) => void; readonly onEdit: (t: Table) => void; readonly onArchive: (t: Table) => void; readonly onDelete: (t: Table) => void;
}) {
  const drop = useDragGroup(id);
  return (
    <div className="tf-bkf-settings">
      <span className="tf-bkf__label">{name} <span className="tf-bkf__muted tf-num">{ids.length}</span></span>
      <DragGroup id={id}>
        <ul ref={drop.ref} className="tf-bkf-rsc__list" aria-label={name} data-over={drop.isOver || undefined}>
          {ids.length === 0 && <li className="tf-bkf-rsc__empty">Drop a table here</li>}
          {ids.map((tid) => { const t = all.find((x) => x.id === tid); if (!t) return null; return (
            <DragItem key={tid} id={tid} group={id} className={cx('tf-bkf-rsc__row', !t.online && 'is-offline')}>
              {(d) => <>
                <Checkbox aria-label={`Select ${t.name}`} isSelected={picked.has(tid)} onChange={(on) => onPick(tid, on)} />
                <DragHandle label={`Move ${t.name}`} isLifted={d.isDragging} drag={d.grip} />
                <ResText t={t} />
                <Switch aria-label={`${t.name} joins its neighbour`} isSelected={t.joinable} onChange={(joinable) => onSet({ ...t, joinable })}><span className="tf-bkf__onword">Joins</span></Switch>
                <Switch aria-label={`${t.name} bookable online`} isSelected={t.online} onChange={(online) => onSet({ ...t, online })}><span className="tf-bkf__onword">{t.online ? 'Online' : 'Staff only'}</span></Switch>
                <MenuTrigger>
                  <IconButton size="sm" label={`More for ${t.name}`}><MoreHorizontal {...i14} /></IconButton>
                  <Menu aria-label={`${t.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'edit') onEdit(t); else if (k === 'archive') onArchive(t); else if (k === 'delete') onDelete(t); }}>
                    <MenuItem id="edit" icon={<Pencil size={16} strokeWidth={1.75} />}>Edit</MenuItem>
                    <MenuItem id="archive" icon={<Archive size={16} strokeWidth={1.75} />}>Archive</MenuItem>
                    <MenuSeparator />
                    <MenuItem id="delete" icon={<Trash2 size={16} strokeWidth={1.75} />} isDanger>Delete…</MenuItem>
                  </Menu>
                </MenuTrigger>
              </>}
            </DragItem>
          ); })}
        </ul>
      </DragGroup>
    </div>
  );
}

/** A zone picker that can make a new zone in place. */
function ZonePick({ zones, value, onChange }: { readonly zones: ReadonlyArray<string>; readonly value: string; readonly onChange: (z: string) => void }) {
  const [making, setMaking] = useState(false);
  return making
    ? <TextField label="New zone" value={value} onChange={onChange} placeholder="Patio" autoFocus description="Made when you save." />
    : <Select label="Zone" value={zones.includes(value) ? value || 'unzoned' : 'unzoned'} onChange={(v) => { if (v === '__new') { setMaking(true); onChange(''); } else if (v) onChange(v === 'unzoned' ? UNZONED : v); }}
      items={[...zones.filter((z) => z).map((z) => ({ id: z, label: z })), { id: 'unzoned', label: 'Unzoned' }, { id: '__new', label: 'New zone…' }]} />;
}

function ZoneDialog({ taken, onClose, onSave }: { readonly taken: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (z: string) => void }) {
  const [z, setZ] = useState('');
  const clash = taken.map((x) => x.toLowerCase()).includes(z.trim().toLowerCase());
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="New zone" actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!z.trim() || clash} onPress={() => onSave(z.trim())}>Move there</Button></>}>
      <TextField label="Name" value={z} onChange={setZ} placeholder="Patio" autoFocus isInvalid={clash} errorMessage="That zone already exists." />
    </Dialog>
  );
}

function AddTables({ zones, room, taken, onClose, onAdd }: { readonly zones: ReadonlyArray<string>; readonly room: number; readonly taken: ReadonlyArray<string>; readonly onClose: () => void; readonly onAdd: (t: ReadonlyArray<Table>) => void }) {
  const [kind, setKind] = useState<Kind>('table');
  const [mode, setMode] = useState<'one' | 'several'>('several');
  const [name, setName] = useState('');
  const [to, setTo] = useState('');
  const [fewest, setFewest] = useState(1); const [most, setMost] = useState(4);
  const [zone, setZone] = useState(zones.find((z) => z) ?? UNZONED);
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
  const names = mode === 'several' ? namesFrom(`${name} to ${to}`, Math.max(1, room)) : namesFrom(name, 1);
  const clash = names.filter((n) => taken.includes(n.toLowerCase()));
  const over = names.length > room;
  const ok = names.length > 0 && clash.length === 0 && !over && fewest <= most;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Add ${k?.many ?? 'tables'}`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ok} onPress={() => onAdd(names.map((n) => ({ id: nextId('t'), name: n, kind, seats: most, minParty: fewest > 1 ? fewest : undefined, area: zone.trim(), online: true, joinable: false, code: tableCode(n) })))}>
        {names.length > 1 ? `Create ${names.length} ${k?.many ?? 'tables'}` : `Create ${(k?.one ?? 'table').toLowerCase()}`}</Button></>}>
      <div className="tf-bkf__stack">
        <div className="tf-bkf__pair">
          <Select label="Kind" value={kind} onChange={(v) => v && setKind(v as Kind)} items={KINDS.map((x) => ({ id: x.id, label: x.one }))} />
          <Select label="How many" value={mode} onChange={(v) => v && setMode(v === 'one' ? 'one' : 'several')} items={[{ id: 'one', label: 'One' }, { id: 'several', label: 'Several' }]} />
        </div>
        {mode === 'several' ? (
          <div className="tf-bkf__pair">
            <TextField label="From" value={name} onChange={setName} placeholder="T1" autoFocus />
            <TextField label="To" value={to} onChange={setTo} placeholder="T10" description={names.length > 1 ? `${names[0]} to ${names[names.length - 1]}` : 'A run, like T1 to T10'} isInvalid={over || clash.length > 0}
              errorMessage={over ? `Only ${room} more fit at this place.` : clash.length ? `${clash.slice(0, 3).join(', ')} already ${clash.length === 1 ? 'exists' : 'exist'}.` : undefined} />
          </div>
        ) : <TextField label="Label" value={name} onChange={setName} placeholder="e.g. T12, Bar 3, Patio A" autoFocus isInvalid={clash.length > 0} errorMessage={clash.length ? 'That name is taken.' : undefined} />}
        <div className="tf-bkf__pair">
          <NumberField label="Fewest guests" value={fewest} minValue={1} maxValue={most} onChange={(n) => setFewest(Math.max(1, Math.round(n || 1)))} />
          <NumberField label="Most guests" value={most} minValue={1} maxValue={30} onChange={(n) => setMost(Math.max(1, Math.round(n || 1)))} />
        </div>
        <ZonePick zones={zones} value={zone} onChange={setZone} />
      </div>
    </Dialog>
  );
}

/** Rename a table, change its kind, seats or zone. Its QR code keeps working: the code, not the name, is in the link. */
function TableDialog({ table, zones, taken, onClose, onSave }: { readonly table: Table; readonly zones: ReadonlyArray<string>; readonly taken: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (t: Table) => void }) {
  const [t, setT] = useState(table);
  const clash = taken.includes(t.name.trim().toLowerCase());
  const fewest = t.minParty ?? 1;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Edit ${table.name}`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!t.name.trim() || clash || fewest > t.seats} onPress={() => onSave({ ...t, name: t.name.trim(), area: t.area.trim(), minParty: fewest > 1 ? fewest : undefined })}>Save table</Button></>}>
      <div className="tf-bkf__stack">
        <div className="tf-bkf__pair">
          <TextField label="Label" value={t.name} onChange={(name) => setT({ ...t, name })} autoFocus isInvalid={clash || !t.name.trim()} errorMessage={clash ? 'Another table has this name' : !t.name.trim() ? 'Give it a name' : undefined} />
          <Select label="Kind" value={t.kind ?? 'table'} onChange={(v) => v && setT({ ...t, kind: v as Kind })} items={KINDS.map((x) => ({ id: x.id, label: x.one }))} />
        </div>
        <div className="tf-bkf__pair">
          <NumberField label="Fewest guests" value={fewest} minValue={1} maxValue={t.seats} onChange={(n) => setT({ ...t, minParty: Math.max(1, Math.round(n || 1)) })} description={fewest > 1 ? `Online, parties under ${fewest} don’t get it.` : 'Any party that fits.'} />
          <NumberField label="Most guests" value={t.seats} minValue={1} maxValue={30} onChange={(n) => setT({ ...t, seats: Math.max(1, Math.round(n || 1)) })} />
        </div>
        <ZonePick zones={zones} value={t.area} onChange={(area) => setT({ ...t, area })} />
        <p className="tf-bkf__muted tf-num">Code {t.code ?? '—'} · the printed QR keeps working after a rename.</p>
      </div>
    </Dialog>
  );
}
