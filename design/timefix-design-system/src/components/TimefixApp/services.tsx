// Settings › Services and Settings › Staff and shifts (spec 0066 B1, after Fresha's service menu, team members and scheduled shifts).
// Services: categories as sections, drag to order (also into another category), select several for Move to, Online, Offline or Archive,
// archived under a fold with Restore, a starter service when empty, and a drawer with what it needs and a cancellation note.
// Staff: people in order (the order "Any professional" breaks ties by), Add staff with just a name and title, a profile (photo, title,
// colour, bio, places, services, member link, regular week, time off and blocks), Archive asking first. Shifts: one place's week.
import { useState, type ReactNode } from 'react';
import { ArrowLeft, Archive, ArchiveRestore, CalendarOff, ChevronLeft, ChevronRight, Clock, Copy, FolderInput, Globe, MapPin, MoreHorizontal, Pencil, Plus, Scissors, Store, Trash2, UserPlus, Users } from 'lucide-react';
import { parseDate } from '@internationalized/date';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Checklist } from '../Checklist/Checklist.tsx';
import { HoursEditor, HoursSummary, type WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ColorSwatchPicker } from '../ColorPicker/ColorPicker.tsx';
import { PhotoCrop, CroppedImage, type PhotoCropValue } from '../PhotoCrop/PhotoCrop.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { BulkActionBar, BarButton, SaveBar } from '../FloatingBar/FloatingBar.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { DragArea, DragGroup, DragList, useDragGroup } from '../../lib/drag.ts';
import { DragHandle, DragItem } from '../DragHandle/DragHandle.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { STAFF_HUES, bizOf, currentBiz, type BizState, type Staff } from '../BookingsFlow/biz.ts';
import { TEAM, isoDay, mondayOf, nextId, plural, priceText, slugify, type BookingPage, type BookingsAction, type BookingsState, type TimeBlock, type TimeOff } from '../BookingsFlow/state.ts';
import { newPage } from '../BookingsFlow/seed.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (v: string | null | undefined, d: number) => { if (!v) return d; const [h = '0', m = '0'] = v.split(':'); return Number(h) * 60 + Number(m); };
const clock = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const OTHER = 'c-other';

/* ------------------------------------------------------------------ setup */

/** The Appointments checklist (spec 0068): business and place, hours, a service, its people, their shifts, Publish. */
function AppointmentsSetup({ s, z, act, onGo }: { readonly s: BookingsState; readonly z: BizState; readonly act: (a: BookingsAction) => void; readonly onGo: (id: string) => void }) {
  const b = currentBiz(z);
  const services = s.pages.filter((p) => p.kind === 'service' && !p.archived);
  const steps = [
    { id: 'business', title: 'Add your business and place', description: b.places[0]?.address || 'No address yet', icon: <Store {...i16} />, actionLabel: 'Open', isDone: b.places.every((p) => p.address.trim() !== '') },
    { id: 'hours', title: 'Set opening hours', description: b.places[0]?.name ?? '', icon: <Clock {...i16} />, actionLabel: 'Set hours', isDone: b.places.every((p) => Object.values(p.hours).some((d) => d.on)) },
    { id: 'service', title: 'Add a service', description: services.length ? plural(services.length, 'service') : 'What guests book', icon: <Scissors {...i16} />, actionLabel: 'Add', isDone: services.length > 0 },
    { id: 'people', title: 'Pick who does each service', description: 'Everyone, or chosen staff', icon: <Users {...i16} />, actionLabel: 'Pick', isDone: services.length > 0 && services.every((p) => p.hosts.length > 0) },
    { id: 'shifts', title: 'Give your staff shifts', description: 'Their regular week', icon: <Clock {...i16} />, actionLabel: 'Open shifts', isDone: z.staff.filter((x) => !x.archived).every((x) => x.placeIds.some((pl) => z.shifts[`${pl}|${x.id}`])) },
    { id: 'publish', title: 'Publish your page', description: `timefix.com/${b.handle}`, icon: <Globe {...i16} />, actionLabel: 'Open page', isDone: Boolean(b.page.live) },
  ];
  if ((z.hidden ?? []).includes('setup:appointments') || steps.every((x) => x.isDone)) return null;
  return <Checklist title="Set up Appointments" steps={steps} defaultExpanded onAction={onGo} onHide={() => act({ type: 'biz/set', biz: { ...z, hidden: [...(z.hidden ?? []), 'setup:appointments'] } })} />;
}

/* ------------------------------------------------------------------ services */

/** Props for ServicesScreen. */
export interface ServicesScreenProps {
  readonly bookings?: BookingsState;
  readonly act: (a: BookingsAction) => void;
  /** Goes to another settings page (Business, Staff and shifts) from the checklist. */
  readonly onGo: (page: 'business' | 'staff', sub?: string) => void;
}

/** Settings › Services. */
export function ServicesScreen({ bookings: s, act, onGo }: ServicesScreenProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<BookingPage | 'new'>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [ask, setAsk] = useState<{ readonly kind: 'category'; readonly id?: string } | { readonly kind: 'delete-category'; readonly id: string }>();
  if (!s) return <SettingsSection title="Services"><p className="tf-rec__muted">Open Bookings once to load your services.</p></SettingsSection>;
  const z = bizOf(s);
  const cats = [...(s.categories ?? [])];
  const all = s.pages.filter((p) => p.kind === 'service');
  const live = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  const catOf = (p: BookingPage) => (p.categoryId && cats.some((c) => c.id === p.categoryId) ? p.categoryId : OTHER);
  const groups = [...cats, ...(live.some((p) => catOf(p) === OTHER) ? [{ id: OTHER, name: 'Other services' }] : [])];
  const others = s.pages.filter((p) => p.kind !== 'service');
  const setPages = (pages: ReadonlyArray<BookingPage>, message?: string, tone?: 'success') => {
    const was = s.pages;
    act({ type: 'pages/set', pages: [...others, ...pages] });
    if (message) toast({ message, tone, action: tone ? undefined : { label: 'Undo', onAction: () => act({ type: 'pages/set', pages: was }) } });
  };
  const patchMany = (ids: ReadonlySet<string>, patch: Partial<BookingPage>, message: string) => { setPages(all.map((p) => (ids.has(p.id) ? { ...p, ...patch } : p)), message); setPicked(new Set()); };
  const who = (p: BookingPage) => (p.hosts.length >= z.staff.filter((x) => !x.archived).length ? 'Everyone' : p.hosts.map((h) => h.split(' ')[0]).join(', ') || 'Nobody yet');
  const starter = () => {
    const hair = cats.find((c) => c.name === 'Hair') ?? { id: nextId('c'), name: 'Hair' };
    if (!cats.some((c) => c.id === hair.id)) act({ type: 'categories/set', categories: [...cats, hair] });
    const p = newPage(s.pages, { name: 'Haircut', slug: 'haircut', kind: 'service', categoryId: hair.id, durations: [45], price: 1200, priceType: 'fixed', places: ['in-person'], address: currentBiz(z).places[0]?.address ?? '', hostMode: 'roundrobin', hosts: z.staff.filter((x) => !x.archived).map((x) => x.name), shareOut: 'equal' });
    act({ type: 'page/upsert', page: p }); toast({ message: 'Haircut added in Hair. Change its price and length any time.', tone: 'success' });
  };
  const moveCat = (i: number, by: number) => { const next = [...cats]; const [x] = next.splice(i, 1); if (x) next.splice(i + by, 0, x); act({ type: 'categories/set', categories: next }); };
  return (
    <>
      <AppointmentsSetup s={s} z={z} act={act} onGo={(id) => { if (id === 'service') setEditing('new'); else if (id === 'shifts') onGo('staff', 'shifts'); else if (id === 'people') onGo('staff'); else onGo('business'); }} />
      <div className="tf-bizset__bar">
        <span className="tf-rec__muted tf-num">{plural(live.length, 'service')} · {plural(cats.length, 'category', 'categories')}</span>
        <span className="tf-bkf__spacer" />
        <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setAsk({ kind: 'category' })}>New category</Button>
        <Button variant="primary" icon={<Plus {...i14} />} onPress={() => setEditing('new')}>New service</Button>
      </div>
      {live.length === 0 ? (
        <EmptyState icon={<Scissors size={20} strokeWidth={1.75} />} title="No services yet" description="Start with the one most people book. You can change everything after." action={<Button variant="primary" onPress={starter}>Add Haircut</Button>} />
      ) : (
        <DragArea groups={Object.fromEntries(groups.map((g) => [g.id, live.filter((p) => catOf(p) === g.id).map((p) => p.id)]))} groupName={(g) => groups.find((x) => x.id === g)?.name ?? 'a category'}
          textOf={(id) => all.find((p) => p.id === id)?.name ?? 'service'}
          overlay={(id) => { const p = all.find((x) => x.id === id); return p ? <div className="tf-bizset__svc"><DragHandle label="" reveal="always" isLifted /><ServiceText p={p} who={who(p)} /></div> : null; }}
          onChange={(next, moved) => {
            const placed = groups.flatMap((g) => (next[g.id] ?? []).map((id) => { const p = all.find((x) => x.id === id); return p && catOf(p) !== g.id ? { ...p, categoryId: g.id === OTHER ? undefined : g.id } : p; })).filter((p): p is BookingPage => Boolean(p));
            const p = placed.find((x) => x.id === moved); const was = all.find((x) => x.id === moved);
            setPages([...placed, ...archived], p && was && catOf(p) !== catOf(was) ? `${p.name} moved to ${groups.find((g) => g.id === catOf(p))?.name}` : undefined);
          }}>
          {(order) => groups.map((g, gi) => (
            <ServiceGroup key={g.id} id={g.id} name={g.name} ids={order[g.id] ?? []} all={all} picked={picked} who={who}
              onPick={(id, on) => setPicked((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n; })}
              onOpen={(p) => setEditing(p)} onOnline={(p, on) => setPages(all.map((x) => (x.id === p.id ? { ...x, isOn: on } : x)), on ? `${p.name} is bookable online` : `${p.name} is staff only`)}
              onArchive={(p) => patchMany(new Set([p.id]), { archived: true, isOn: false }, `${p.name} archived`)}
              menu={g.id === OTHER ? undefined : (
                <MenuTrigger>
                  <IconButton size="sm" label={`More for ${g.name}`}><MoreHorizontal {...i14} /></IconButton>
                  <Menu aria-label={`${g.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'rename') setAsk({ kind: 'category', id: g.id }); else if (k === 'up') moveCat(gi, -1); else if (k === 'down') moveCat(gi, 1); else if (k === 'delete') setAsk({ kind: 'delete-category', id: g.id }); }}>
                    <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename</MenuItem>
                    {gi > 0 && <MenuItem id="up">Move up</MenuItem>}
                    {gi < cats.length - 1 && <MenuItem id="down">Move down</MenuItem>}
                    <MenuSeparator />
                    <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete category…</MenuItem>
                  </Menu>
                </MenuTrigger>
              )} />
          ))}
        </DragArea>
      )}
      {archived.length > 0 && (
        <ShowMore showLabel={`Archived · ${archived.length}`} hideLabel={`Hide archived · ${archived.length}`}>
          <ul className="tf-set__list">{archived.map((p) => (
            <li key={p.id}><span className="tf-bizset__text"><strong>{p.name}</strong><span className="tf-rec__muted">Off your page. Bookings already made stay.</span></span>
              <Button size="sm" variant="ghost" icon={<ArchiveRestore {...i14} />} onPress={() => setPages(all.map((x) => (x.id === p.id ? { ...x, archived: undefined } : x)), `${p.name} restored, staff only until you turn it on`, 'success')}>Restore</Button></li>
          ))}</ul>
        </ShowMore>
      )}
      {picked.size > 0 && (
        <BulkActionBar count={picked.size} onClear={() => setPicked(new Set())}>
          <MenuTrigger>
            <BarButton icon={<FolderInput {...i14} />}>Move to</BarButton>
            <Menu aria-label="Move to" onAction={(k) => patchMany(picked, { categoryId: String(k) === OTHER ? undefined : String(k) }, `${plural(picked.size, 'service')} moved to ${groups.find((g) => g.id === k)?.name ?? 'Other services'}`)}>
              {cats.map((c) => <MenuItem key={c.id} id={c.id}>{c.name}</MenuItem>)}
            </Menu>
          </MenuTrigger>
          <BarButton onPress={() => patchMany(picked, { isOn: true }, `${plural(picked.size, 'service')} bookable online`)}>Online</BarButton>
          <BarButton onPress={() => patchMany(picked, { isOn: false }, `${plural(picked.size, 'service')} staff only`)}>Offline</BarButton>
          <BarButton icon={<Archive {...i14} />} onPress={() => patchMany(picked, { archived: true, isOn: false }, `${plural(picked.size, 'service')} archived`)}>Archive</BarButton>
        </BulkActionBar>
      )}
      {editing && <ServiceDrawer s={s} z={z} cats={cats} service={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)}
        onSave={(p) => { act({ type: 'page/upsert', page: p }); setEditing(undefined); toast({ message: editing === 'new' ? `${p.name} added` : `${p.name} saved`, tone: 'success' }); }} />}
      {ask?.kind === 'category' && <CategoryDialog name={cats.find((c) => c.id === ask.id)?.name} taken={cats.filter((c) => c.id !== ask.id).map((c) => c.name.toLowerCase())} onClose={() => setAsk(undefined)}
        onSave={(name) => { act({ type: 'categories/set', categories: ask.id ? cats.map((c) => (c.id === ask.id ? { ...c, name } : c)) : [...cats, { id: nextId('c'), name }] }); setAsk(undefined); toast({ message: ask.id ? 'Category renamed' : `${name} added`, tone: 'success' }); }} />}
      {ask?.kind === 'delete-category' && (() => { const c = cats.find((x) => x.id === ask.id); const n = all.filter((p) => p.categoryId === ask.id).length; return (
        <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) setAsk(undefined); }} title={`Delete ${c?.name ?? 'category'}?`} tone="danger" confirmLabel="Delete category"
          consequence={n ? `Its ${plural(n, 'service')} stay, under Other services.` : 'It has no services.'}
          onConfirm={() => { const was = cats; act({ type: 'categories/set', categories: cats.filter((x) => x.id !== ask.id) }); setAsk(undefined); toast({ message: `${c?.name ?? 'Category'} deleted`, action: { label: 'Undo', onAction: () => act({ type: 'categories/set', categories: was }) } }); }} />); })()}
    </>
  );
}

function ServiceText({ p, who }: { readonly p: BookingPage; readonly who: string }) {
  return (
    <span className="tf-bizset__text">
      <strong>{p.name}</strong>
      <span className="tf-rec__muted tf-num">{p.durations.join(' or ')} min · {priceText(p)} · {who}{p.needs ? ` · needs ${p.needs.name ?? `a ${p.needs.kind}`}` : ''}</span>
    </span>
  );
}

function ServiceGroup({ id, name, ids, all, picked, who, onPick, onOpen, onOnline, onArchive, menu }: {
  readonly id: string; readonly name: string; readonly ids: ReadonlyArray<string>; readonly all: ReadonlyArray<BookingPage>; readonly picked: ReadonlySet<string>; readonly who: (p: BookingPage) => string;
  readonly onPick: (id: string, on: boolean) => void; readonly onOpen: (p: BookingPage) => void; readonly onOnline: (p: BookingPage, on: boolean) => void; readonly onArchive: (p: BookingPage) => void; readonly menu?: ReactNode;
}) {
  const drop = useDragGroup(id);
  return (
    <section className="tf-bkf-card tf-bizset__group" aria-label={name}>
      <div className="tf-bizset__grouphead"><h3 className="tf-bizset__h">{name}</h3><span className="tf-rec__muted tf-num">{plural(ids.length, 'service')}</span><span className="tf-bkf__spacer" />{menu}</div>
      <DragGroup id={id}>
        <ul ref={drop.ref} className="tf-bizset__svcs" aria-label={name} data-over={drop.isOver || undefined}>
          {ids.length === 0 && <li className="tf-bizset__empty">Drop a service here</li>}
          {ids.map((sid) => { const p = all.find((x) => x.id === sid); if (!p) return null; return (
            <DragItem key={sid} id={sid} group={id} className="tf-bizset__svc">
              {(d) => <>
                <Checkbox aria-label={`Select ${p.name}`} isSelected={picked.has(sid)} onChange={(on) => onPick(sid, on)} />
                <DragHandle label={`Move ${p.name}`} isLifted={d.isDragging} drag={d.grip} />
                <button type="button" className="tf-bizset__open" onClick={() => onOpen(p)} aria-label={`Edit ${p.name}`}><ServiceText p={p} who={who(p)} /></button>
                <Switch aria-label={`${p.name} bookable online`} isSelected={p.isOn} onChange={(on) => onOnline(p, on)}><span className="tf-bkf__onword">{p.isOn ? 'Online' : 'Staff only'}</span></Switch>
                <MenuTrigger>
                  <IconButton size="sm" label={`More for ${p.name}`}><MoreHorizontal {...i14} /></IconButton>
                  <Menu aria-label={`${p.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'edit') onOpen(p); else if (k === 'archive') onArchive(p); }}>
                    <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit</MenuItem>
                    <MenuItem id="archive" icon={<Archive {...i16} />}>Archive</MenuItem>
                  </Menu>
                </MenuTrigger>
              </>}
            </DragItem>
          ); })}
        </ul>
      </DragGroup>
    </section>
  );
}

function CategoryDialog({ name: start = '', taken, onClose, onSave }: { readonly name?: string; readonly taken: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (name: string) => void }) {
  const [name, setName] = useState(start);
  const clash = taken.includes(name.trim().toLowerCase());
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={start ? 'Rename category' : 'New category'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || clash} onPress={() => onSave(name.trim())}>{start ? 'Rename' : 'Add category'}</Button></>}>
      <TextField label="Name" value={name} onChange={setName} placeholder="Nails" autoFocus isInvalid={clash} errorMessage="You already have a category with this name." />
    </Dialog>
  );
}

/** One service in a drawer: name, category, description, length and price, who does it, what it needs, time after, online, cancellation note. */
function ServiceDrawer({ s, z, cats, service, onClose, onSave }: { readonly s: BookingsState; readonly z: BizState; readonly cats: ReadonlyArray<{ readonly id: string; readonly name: string }>; readonly service?: BookingPage; readonly onClose: () => void; readonly onSave: (p: BookingPage) => void }) {
  const staff = z.staff.filter((x) => !x.archived);
  const [p, setP] = useState<BookingPage>(() => service ?? newPage(s.pages, { name: '', slug: '', kind: 'service', categoryId: cats[0]?.id, durations: [45], price: 0, priceType: 'fixed', places: ['in-person'], address: currentBiz(z).places[0]?.address ?? '', hostMode: 'roundrobin', hosts: staff.map((x) => x.name), shareOut: 'equal' }));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<BookingPage>) => setP((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(p) !== JSON.stringify(service ?? {});
  const everyone = p.hosts.length === staff.length;
  const needs = p.needs ? (p.needs.name ? `named:${p.needs.kind}` : p.needs.kind) : 'none';
  const ok = p.name.trim() !== '' && p.hosts.length > 0;
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={service ? service.name : 'New service'} subtitle={cats.find((c) => c.id === p.categoryId)?.name ?? 'Other services'} width="lg"
      saveState={dirty ? 'dirty' : 'clean'} saveLabel={service ? 'Save service' : 'Add service'} onDiscard={onClose}
      onSave={() => { setTried(true); if (ok) onSave({ ...p, name: p.name.trim(), slug: p.slug || slugify(p.name), hostMode: p.hosts.length > 1 ? 'roundrobin' : 'one' }); }}>
      <div className="tf-bkf-cards"><section className="tf-bkf-card"><div className="tf-bkf__stack">
        <TextField label="Name" value={p.name} onChange={(name) => set({ name })} placeholder="Haircut and blow dry" autoFocus={!service} isInvalid={tried && !p.name.trim()} errorMessage="Give the service a name." />
        <Select label="Category" value={p.categoryId ?? OTHER} onChange={(v) => v && set({ categoryId: v === OTHER ? undefined : v })} items={[...cats.map((c) => ({ id: c.id, label: c.name })), { id: OTHER, label: 'Other services' }]} />
        <TextArea label="Description" aside="Optional" rows={2} value={p.description} onChange={(description) => set({ description })} placeholder="What’s included, in a line" />
        <div className="tf-bkf__pair">
          <NumberField label="Length" value={p.durations[0] ?? 45} minValue={5} maxValue={480} step={5} unit="min" onChange={(n) => set({ durations: [Number.isFinite(n) ? n : 45] })} />
          <NumberField label="Time after" value={p.bufferAfter} minValue={0} maxValue={120} step={5} unit="min" description="Cleanup before the next guest." onChange={(n) => set({ bufferAfter: Number.isFinite(n) ? n : 0 })} />
        </div>
        <div className="tf-bkf__pair">
          <Select label="Price" value={p.priceType ?? 'fixed'} onChange={(v) => v && set({ priceType: v === 'from' ? 'from' : v === 'free' ? 'free' : 'fixed' })} items={[{ id: 'fixed', label: 'Fixed' }, { id: 'from', label: 'From' }, { id: 'free', label: 'Free' }]} />
          {p.priceType !== 'free' && <NumberField label="Amount" value={p.price ?? 0} minValue={0} formatOptions={{ style: 'currency', currency: currentBiz(z).currency, maximumFractionDigits: 0 }} onChange={(n) => set({ price: Number.isFinite(n) ? n : 0 })} />}
        </div>
      </div></section>
      <section className="tf-bkf-card"><div className="tf-bkf__stack">
        <div className="tf-bkf__group"><span className="tf-bkf__label">Who does it</span>
          <SegmentedControl aria-label="Who does it" size="sm" selectedKey={everyone ? 'all' : 'some'} onSelectionChange={(k) => set({ hosts: k === 'all' ? staff.map((x) => x.name) : p.hosts.slice(0, 1) })} items={[{ id: 'all', label: 'Everyone' }, { id: 'some', label: 'Chosen people' }]} />
          {!everyone && <div className="tf-bizset__checks">{staff.map((x) => <Checkbox key={x.id} isSelected={p.hosts.includes(x.name)} onChange={(on) => set({ hosts: on ? [...p.hosts, x.name] : p.hosts.filter((h) => h !== x.name) })}>{x.name}</Checkbox>)}</div>}
          {tried && p.hosts.length === 0 && <p className="tf-bizset__error" role="alert">Pick at least one person, or guests can’t book it.</p>}
        </div>
        <Select label="What it needs" value={needs} description="Guests are only offered times when one is free."
          onChange={(v) => set({ needs: v === 'room' || v === 'chair' ? { kind: v } : v === 'named:room' ? { kind: 'room', name: 'Colour room' } : v === 'named:chair' ? { kind: 'chair', name: 'Basin chair' } : undefined })}
          items={[{ id: 'none', label: 'Nothing extra' }, { id: 'chair', label: 'Any chair' }, { id: 'room', label: 'Any room' }, { id: 'named:chair', label: 'The basin chair' }, { id: 'named:room', label: 'The colour room' }]} />
        <Switch isSelected={p.isOn} onChange={(isOn) => set({ isOn })}>Bookable online</Switch>
        <TextArea label="Cancellation note" aside="Optional" rows={2} value={p.cancelNote ?? ''} onChange={(cancelNote) => set({ cancelNote: cancelNote || undefined })} placeholder="Cancel up to 24 hours before at no charge." description="Guests read it before they book." />
      </div></section></div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ staff */

/** Props for StaffScreen. */
export interface StaffScreenProps {
  readonly bookings?: BookingsState;
  readonly act: (a: BookingsAction) => void;
  readonly onGo: (page: 'business' | 'services') => void;
  /** Opens on Shifts. */
  readonly startOn?: 'staff' | 'shifts';
}

/** Settings › Staff and shifts. */
export function StaffScreen({ bookings: s, act, onGo, startOn = 'staff' }: StaffScreenProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'staff' | 'shifts'>(startOn);
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<Staff>();
  if (!s) return <SettingsSection title="Staff"><p className="tf-rec__muted">Open Bookings once to load your staff.</p></SettingsSection>;
  const z = bizOf(s);
  const save = (next: BizState, message?: string, undo?: boolean) => { act({ type: 'biz/set', biz: next }); if (message) toast({ message, tone: undo ? undefined : 'success', action: undo ? { label: 'Undo', onAction: () => act({ type: 'biz/set', biz: z }) } : undefined }); };
  const live = z.staff.filter((x) => !x.archived);
  const gone = z.staff.filter((x) => x.archived);
  const upcoming = (x: Staff) => s.meetings.filter((m) => m.host === x.name && m.start > new Date() && m.status !== 'cancelled').length;
  const person = z.staff.find((x) => x.id === open);
  if (person) return <StaffProfile s={s} z={z} person={person} onBack={() => setOpen(undefined)} save={save} onArchive={() => setArchiving(person)} act={act} archiveAsk={archiving && <ArchiveAsk x={archiving} count={upcoming(archiving)} onClose={() => setArchiving(undefined)} onArchive={() => { save({ ...z, staff: z.staff.map((y) => (y.id === archiving.id ? { ...y, archived: true } : y)) }, `${archiving.name} archived`, true); setArchiving(undefined); setOpen(undefined); }} />} />;
  const places = currentBiz(z).places;
  return (
    <>
      <AppointmentsSetup s={s} z={z} act={act} onGo={(id) => { if (id === 'shifts') setTab('shifts'); else if (id === 'service' || id === 'people') onGo('services'); else onGo('business'); }} />
      <div className="tf-bizset__bar">
        <SegmentedControl aria-label="Staff or shifts" selectedKey={tab} onSelectionChange={(k) => setTab(k === 'shifts' ? 'shifts' : 'staff')} items={[{ id: 'staff', label: 'Staff', icon: <Users {...i14} /> }, { id: 'shifts', label: 'Shifts', icon: <Clock {...i14} /> }]} />
        <span className="tf-bkf__spacer" />
        {tab === 'staff' && <Button variant="primary" icon={<UserPlus {...i14} />} onPress={() => setAdding(true)}>Add staff</Button>}
      </div>
      {tab === 'shifts' ? <ShiftsGrid s={s} z={z} save={save} act={act} /> : (
        <section className="tf-bkf-card" aria-label="Staff">
          <p className="tf-rec__muted">Drag to order. When a guest picks “Any professional”, the first free person in this order gets the booking.</p>
          {live.length === 0 ? <EmptyState size="sm" icon={<Users size={20} strokeWidth={1.75} />} title="No staff yet" description="Add the people guests book with." /> : (
            <DragList ids={live.map((x) => x.id)} textOf={(id) => z.staff.find((x) => x.id === id)?.name ?? 'person'}
              onReorder={(ids) => save({ ...z, staff: [...ids.map((id) => z.staff.find((x) => x.id === id)).filter((x): x is Staff => Boolean(x)), ...gone] }, 'Order saved', true)}
              overlay={(id) => { const x = z.staff.find((y) => y.id === id); return x ? <div className="tf-bizset__person"><DragHandle label="" reveal="always" isLifted /><StaffFace x={x} /><span className="tf-bizset__text"><strong>{x.name}</strong><span className="tf-rec__muted">{x.title}</span></span></div> : null; }}>
              <ul className="tf-bizset__people" aria-label="Staff, in order">
                {live.map((x) => (
                  <DragItem key={x.id} id={x.id} className="tf-bizset__person">
                    {(d) => <>
                      <DragHandle label={`Move ${x.name}`} isLifted={d.isDragging} drag={d.grip} />
                      <button type="button" className="tf-bizset__open" onClick={() => setOpen(x.id)} aria-label={`Open ${x.name}`}>
                        <StaffFace x={x} />
                        <span className="tf-bizset__text"><strong>{x.name}</strong><span className="tf-rec__muted">{x.title} · {x.placeIds.map((id) => places.find((pl) => pl.id === id)?.name).filter(Boolean).join(', ') || 'No place'} · {plural(x.serviceIds.length, 'service')}</span></span>
                        <span className="tf-rec__muted">{x.member ? 'Signs in' : 'No sign in'}</span>
                      </button>
                      <MenuTrigger>
                        <IconButton size="sm" label={`More for ${x.name}`}><MoreHorizontal {...i14} /></IconButton>
                        <Menu aria-label={`${x.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'open') setOpen(x.id); else if (k === 'archive') setArchiving(x); }}>
                          <MenuItem id="open" icon={<Pencil {...i16} />}>Open profile</MenuItem>
                          <MenuSeparator />
                          <MenuItem id="archive" icon={<Archive {...i16} />} isDanger>Archive…</MenuItem>
                        </Menu>
                      </MenuTrigger>
                    </>}
                  </DragItem>
                ))}
              </ul>
            </DragList>
          )}
          {gone.length > 0 && <ShowMore showLabel={`Archived · ${gone.length}`} hideLabel={`Hide archived · ${gone.length}`}>
            <ul className="tf-set__list">{gone.map((x) => <li key={x.id}><span className="tf-bizset__text"><strong>{x.name}</strong><span className="tf-rec__muted">{x.title}</span></span>
              <Button size="sm" variant="ghost" icon={<ArchiveRestore {...i14} />} onPress={() => save({ ...z, staff: z.staff.map((y) => (y.id === x.id ? { ...y, archived: undefined } : y)) }, `${x.name} restored`)}>Restore</Button></li>)}</ul>
          </ShowMore>}
        </section>
      )}
      {adding && <AddStaff onClose={() => setAdding(false)} onAdd={(name, title) => {
        const id = nextId('st'); const pls = places.map((p) => p.id);
        const x: Staff = { id, name, title, colour: STAFF_HUES[z.staff.length % STAFF_HUES.length] ?? 'blue', bio: '', placeIds: pls, serviceIds: s.pages.filter((p) => p.kind === 'service' && !p.archived).map((p) => p.id) };
        save({ ...z, staff: [...z.staff, x], shifts: { ...z.shifts, ...Object.fromEntries(places.map((p) => [`${p.id}|${id}`, p.hours])) } }, `${name} added at every place, doing every service`);
        act({ type: 'pages/set', pages: s.pages.map((p) => (p.kind === 'service' && !p.archived ? { ...p, hosts: [...p.hosts, name] } : p)) });
        setAdding(false); setOpen(id);
      }} />}
      {archiving && !person && <ArchiveAsk x={archiving} count={upcoming(archiving)} onClose={() => setArchiving(undefined)} onArchive={() => { save({ ...z, staff: z.staff.map((y) => (y.id === archiving.id ? { ...y, archived: true } : y)) }, `${archiving.name} archived`, true); setArchiving(undefined); }} />}
    </>
  );
}

function StaffFace({ x, size = 32 }: { readonly x: Staff; readonly size?: 28 | 32 | 56 }) {
  return x.photo ? <Avatar name={x.name} src={x.photo} size={size} /> : <span className={`tf-bizset__face tf-bizset__face--${x.colour}`} data-size={size} aria-hidden="true">{x.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>;
}

function ArchiveAsk({ x, count, onClose, onArchive }: { readonly x: Staff; readonly count: number; readonly onClose: () => void; readonly onArchive: () => void }) {
  if (count > 0) return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`${x.name} has ${plural(count, 'visit')} to come`} description="Move or cancel them in Meetings first, then archive."
      actions={<Button variant="primary" slot="close">OK</Button>} />
  );
  return <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Archive ${x.name}?`} tone="danger" confirmLabel="Archive" consequence="Guests can’t book them, and they leave every service and shift. Their past visits stay." onConfirm={onArchive} />;
}

function AddStaff({ onClose, onAdd }: { readonly onClose: () => void; readonly onAdd: (name: string, title: string) => void }) {
  const [name, setName] = useState(''); const [title, setTitle] = useState('');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Add staff" description="They start at every place on its opening week, doing every service. Change it on their profile."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onAdd(name.trim(), title.trim() || 'Stylist')}>Add and open</Button></>}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={name} onChange={setName} placeholder="Meera Joshi" autoFocus />
        <TextField label="Title" aside="Optional" value={title} onChange={setTitle} placeholder="Senior stylist" />
      </div>
    </Dialog>
  );
}

/** One person's profile: photo, name, title, colour, bio, places, services, member link (SaveBar); each place's regular week; time off and blocks; Archive. */
function StaffProfile({ s, z, person, onBack, save, onArchive, act, archiveAsk }: {
  readonly s: BookingsState; readonly z: BizState; readonly person: Staff; readonly onBack: () => void; readonly save: (next: BizState, message?: string, undo?: boolean) => void; readonly onArchive: () => void;
  readonly act: (a: BookingsAction) => void; readonly archiveAsk?: ReactNode;
}) {
  const { toast } = useToast();
  const [x, setX] = useState(person);
  const [bar, setBar] = useState<'saving' | 'saved'>();
  const [crop, setCrop] = useState(false);
  const [photoCrop, setPhotoCrop] = useState<PhotoCropValue>();
  const [away, setAway] = useState<'off' | 'block'>();
  const places = currentBiz(z).places;
  const services = s.pages.filter((p) => p.kind === 'service' && !p.archived);
  const dirty = JSON.stringify(x) !== JSON.stringify(person);
  const linkedElsewhere = (m: string) => z.staff.some((y) => y.id !== x.id && y.member === m);
  const today = isoDay(new Date());
  const offs = s.timeOff.filter((t) => t.member === person.name && t.to >= today);
  const blocks = s.blocks.filter((b) => b.member === person.name && b.day >= today);
  const commit = () => {
    setBar('saving');
    window.setTimeout(() => {
      save({ ...z, staff: z.staff.map((y) => (y.id === x.id ? x : y)) });
      // Services follow the profile: they take this person in or out.
      act({ type: 'pages/set', pages: s.pages.map((p) => (p.kind !== 'service' ? p : x.serviceIds.includes(p.id) ? (p.hosts.includes(x.name) ? p : { ...p, hosts: [...p.hosts.filter((h) => h !== person.name), x.name] }) : { ...p, hosts: p.hosts.filter((h) => h !== person.name && h !== x.name) })) });
      setBar('saved'); window.setTimeout(() => setBar(undefined), 1200);
    }, 400);
  };
  return (
    <div className="tf-bizset__page">
      <div className="tf-bizset__back"><Button variant="ghost" size="sm" icon={<ArrowLeft {...i14} />} onPress={onBack}>Staff</Button><span className="tf-bizset__crumb">{person.name}</span></div>
      <SettingsSection title="Profile" description="What guests see when they pick someone.">
        <div className="tf-bkf__stack"><div className="tf-set__row">
          {x.photo ? (photoCrop ? <CroppedImage src={x.photo} crop={photoCrop} width={56} alt={x.name} /> : <Avatar name={x.name} src={x.photo} size={56} />) : <StaffFace x={x} size={56} />}
          <span className="tf-bkf__row"><Button size="sm" variant="secondary" onPress={() => setCrop(true)}>{x.photo ? 'Change photo' : 'Add a photo'}</Button>{x.photo && <Button size="sm" variant="ghost" onPress={() => setX({ ...x, photo: undefined })}>Remove</Button>}</span>
        </div>
        <div className="tf-rec__form tf-set__narrow">
          <TextField label="Name" value={x.name} onChange={(name) => setX({ ...x, name })} isInvalid={!x.name.trim()} errorMessage="They need a name." />
          <TextField label="Title" value={x.title} onChange={(title) => setX({ ...x, title })} description="Guests see it when they pick someone." />
        </div>
        <ColorSwatchPicker label="Colour on the calendar" isLabelShown value={x.colour} onChange={(colour: Hue) => setX({ ...x, colour })} />
        <TextArea label="Bio" aside="Optional" rows={2} showCount maxLength={160} value={x.bio} onChange={(bio) => setX({ ...x, bio })} placeholder="Colour specialist. Ten years of balayage." />
        <fieldset className="tf-set__check"><legend>Works at</legend>{places.map((p) => <Checkbox key={p.id} isSelected={x.placeIds.includes(p.id)} onChange={(on) => setX({ ...x, placeIds: on ? [...x.placeIds, p.id] : x.placeIds.filter((i) => i !== p.id) })}>{p.name}</Checkbox>)}</fieldset>
        <fieldset className="tf-set__check"><legend>Does</legend><div className="tf-bizset__checks">{services.map((p) => <Checkbox key={p.id} isSelected={x.serviceIds.includes(p.id)} onChange={(on) => setX({ ...x, serviceIds: on ? [...x.serviceIds, p.id] : x.serviceIds.filter((i) => i !== p.id) })}>{p.name}</Checkbox>)}</div></fieldset>
        <Select label="Member link" value={x.member ?? 'none'} description={x.member ? 'Their hours and time off come from their own Availability.' : 'Link them to let them sign in and keep their own hours.'}
          onChange={(v) => v && setX({ ...x, member: v === 'none' ? undefined : v })} items={[{ id: 'none', label: 'Not linked' }, ...TEAM.map((m) => ({ id: m, label: m, isDisabled: linkedElsewhere(m), description: linkedElsewhere(m) ? 'Linked to someone else' : undefined }))]} /></div>
      </SettingsSection>
      {places.filter((p) => x.placeIds.includes(p.id)).map((p) => { const key = `${p.id}|${person.id}`; const week = z.shifts[key] ?? p.hours; return (
        <SettingsSection key={p.id} title={`Regular week at ${p.name}`} description="Saved as you change it.">
          <HoursSummary value={week} />
          <HoursEditor value={week} onChange={(h) => save({ ...z, shifts: { ...z.shifts, [key]: h } })} />
        </SettingsSection>
      ); })}
      <SettingsSection title="Time off and blocks" description="Coming up. Guests can’t book them then."
        action={x.member ? undefined : <span className="tf-bkf__row"><Button variant="secondary" icon={<CalendarOff {...i14} />} onPress={() => setAway('off')}>Add time off</Button><Button variant="secondary" onPress={() => setAway('block')}>Block time</Button></span>}>
        {x.member ? <p className="tf-rec__muted">Linked to {x.member}: their time off comes from their own Availability.</p>
          : offs.length + blocks.length === 0 ? <p className="tf-rec__muted">Nothing coming up.</p> : (
            <ul className="tf-set__list">
              {offs.map((t) => <li key={t.id}><span className="tf-bizset__text"><strong>{t.from === t.to ? t.from : `${t.from} to ${t.to}`}</strong><span className="tf-rec__muted">Time off{t.note ? ` · ${t.note}` : ''}</span></span>
                <Button size="sm" variant="ghost" onPress={() => { act({ type: 'timeoff/set', timeOff: s.timeOff.filter((y) => y.id !== t.id) }); toast({ message: 'Time off removed', action: { label: 'Undo', onAction: () => act({ type: 'timeoff/set', timeOff: s.timeOff }) } }); }}>Remove</Button></li>)}
              {blocks.map((b) => <li key={b.id}><span className="tf-bizset__text"><strong>{b.day} · {clock(b.start)} – {clock(b.end)}</strong><span className="tf-rec__muted">{b.label}</span></span>
                <Button size="sm" variant="ghost" onPress={() => { act({ type: 'block/remove', id: b.id }); toast({ message: 'Block removed', action: { label: 'Undo', onAction: () => act({ type: 'block/add', block: b }) } }); }}>Remove</Button></li>)}
            </ul>
          )}
      </SettingsSection>
      <SettingsSection title="Archive" description="They leave every service and shift. Past visits stay." tone="danger" action={<Button variant="secondary" icon={<Archive {...i14} />} onPress={onArchive}>Archive {person.name.split(' ')[0]}…</Button>}><span /></SettingsSection>
      <SaveBar status={bar ?? (dirty ? 'unsaved' : 'hidden')} onSave={() => { if (x.name.trim()) commit(); }} onDiscard={() => setX(person)} />
      {crop && <PhotoCrop isOpen onOpenChange={setCrop} shape="round" src={x.photo} title="Their photo" onSave={(src, c) => { setX({ ...x, photo: src }); setPhotoCrop(c); setCrop(false); }} />}
      {away && <AwayDialog kind={away} name={person.name} onClose={() => setAway(undefined)} onBlock={(b) => { act({ type: 'block/add', block: b }); setAway(undefined); toast({ message: 'Time blocked', tone: 'success' }); }}
        onOff={(t) => { act({ type: 'timeoff/set', timeOff: [...s.timeOff, t] }); setAway(undefined); toast({ message: 'Time off added', tone: 'success' }); }} />}
      {archiveAsk}
    </div>
  );
}

/** Time off (whole days, a reason) or a block (a day and its hours). */
function AwayDialog({ kind, name, onClose, onOff, onBlock }: { readonly kind: 'off' | 'block'; readonly name: string; readonly onClose: () => void; readonly onOff: (t: TimeOff) => void; readonly onBlock: (b: TimeBlock) => void }) {
  const start = isoDay(new Date(Date.now() + 86_400_000));
  const [from, setFrom] = useState(start); const [to, setTo] = useState(start);
  const [a, setA] = useState(13 * 60); const [b, setB] = useState(14 * 60);
  const [note, setNote] = useState(kind === 'off' ? '' : 'Training');
  const bad = kind === 'off' ? to < from : b <= a;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={kind === 'off' ? `Time off for ${name.split(' ')[0]}` : `Block time for ${name.split(' ')[0]}`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={bad} onPress={() => kind === 'off'
        ? onOff({ id: nextId('off'), member: name, from, to, allDay: true, start: 0, end: 1440, note: note.trim(), reason: 'other' })
        : onBlock({ id: nextId('blk'), member: name, day: from, start: a, end: b, kind: 'block', label: note.trim() || 'Blocked' })}>{kind === 'off' ? 'Add time off' : 'Block time'}</Button></>}>
      <div className="tf-bkf__stack">
        <div className="tf-bkf__pair">
          <DatePicker label={kind === 'off' ? 'From' : 'Day'} value={parseDate(from)} onChange={(v) => { if (v) { setFrom(v.toString()); if (v.toString() > to) setTo(v.toString()); } }} />
          {kind === 'off' && <DatePicker label="Until" value={parseDate(to)} onChange={(v) => { if (v) setTo(v.toString()); }} isInvalid={bad} errorMessage="Ends on or after it starts." />}
        </div>
        {kind === 'block' && <div className="tf-bkf__pair">
          <TimeSelect label="From" value={hm(a)} onChange={(v) => setA(mins(v, 780))} hourCycle={12} step={15} />
          <TimeSelect label="Until" value={hm(b)} onChange={(v) => setB(mins(v, 840))} hourCycle={12} step={15} isInvalid={bad} errorMessage="Ends after it starts." />
        </div>}
        <TextField label={kind === 'off' ? 'Note' : 'What for'} aside={kind === 'off' ? 'Optional' : undefined} value={note} onChange={setNote} placeholder={kind === 'off' ? 'Family wedding' : 'Training'} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ shifts */

/** One place's week: a row a person, a cell a day. A cell opens that date's hours; a row's menu sets the regular week, copies this week to all weeks or to others, adds time off or blocks time. */
function ShiftsGrid({ s, z, save, act }: { readonly s: BookingsState; readonly z: BizState; readonly save: (next: BizState, message?: string, undo?: boolean) => void; readonly act: (a: BookingsAction) => void }) {
  const { toast } = useToast();
  const places = currentBiz(z).places;
  const [placeId, setPlaceId] = useState(places[0]?.id ?? '');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [cell, setCell] = useState<{ readonly x: Staff; readonly date: Date }>();
  const [regular, setRegular] = useState<Staff>();
  const [copyTo, setCopyTo] = useState<Staff>();
  const [away, setAway] = useState<{ readonly x: Staff; readonly kind: 'off' | 'block' }>();
  const place = places.find((p) => p.id === placeId) ?? places[0];
  if (!place) return null;
  const people = z.staff.filter((x) => !x.archived && x.placeIds.includes(place.id));
  const days = KEYS.map((_, i) => new Date(week.getFullYear(), week.getMonth(), week.getDate() + i));
  const regularOf = (x: Staff): WeekHours => z.shifts[`${place.id}|${x.id}`] ?? place.hours;
  const on = (x: Staff, d: Date) => {
    const own = s.overrides?.[`${x.name}|${isoDay(d)}`];
    const off = s.timeOff.find((t) => t.member === x.name && t.from <= isoDay(d) && t.to >= isoDay(d));
    const day = own ?? regularOf(x)[KEYS[(d.getDay() + 6) % 7] ?? 'mon'];
    return { day, own: Boolean(own), off };
  };
  const copyWeekToAll = (x: Staff) => {
    const next = Object.fromEntries(KEYS.map((k, i) => { const d = days[i]; return [k, d ? on(x, d).day : regularOf(x)[k]]; })) as unknown as WeekHours;
    const was = z;
    save({ ...z, shifts: { ...z.shifts, [`${place.id}|${x.id}`]: next } });
    act({ type: 'overrides/merge', patch: Object.fromEntries(days.map((d) => [`${x.name}|${isoDay(d)}`, null])) });
    toast({ message: `${x.name.split(' ')[0]}’s week is now every week`, action: { label: 'Undo', onAction: () => save(was) } });
  };
  return (
    <section className="tf-bkf-card" aria-label="Shifts">
      <div className="tf-bizset__bar">
        {places.length > 1 && <Select label="Place" isLabelHidden value={place.id} onChange={(v) => v && setPlaceId(v)} items={places.map((p) => ({ id: p.id, label: p.name }))} />}
        <IconButton label="Previous week" onPress={() => setWeek(new Date(week.getFullYear(), week.getMonth(), week.getDate() - 7))}><ChevronLeft {...i16} /></IconButton>
        <strong className="tf-num">{days[0]?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {days[6]?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</strong>
        <IconButton label="Next week" onPress={() => setWeek(new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7))}><ChevronRight {...i16} /></IconButton>
        <Button size="sm" variant="ghost" onPress={() => setWeek(mondayOf(new Date()))}>This week</Button>
        <span className="tf-bkf__spacer" /><span className="tf-rec__muted"><MapPin {...i14} aria-hidden /> {place.name}</span>
      </div>
      {people.length === 0 ? <EmptyState size="sm" icon={<Users size={20} strokeWidth={1.75} />} title={`Nobody works at ${place.name} yet`} description="Add the place on someone’s profile." /> : (
        <div className="tf-bizset__gridwrap">
          <table className="tf-bizset__grid">
            <thead><tr><th scope="col">Staff</th>{days.map((d) => <th key={d.toISOString()} scope="col" className="tf-num">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</th>)}<th scope="col"><span className="tf-bizset__sr">Actions</span></th></tr></thead>
            <tbody>
              {people.map((x) => (
                <tr key={x.id}>
                  <th scope="row"><span className="tf-bizset__who"><StaffFace x={x} size={28} /><span>{x.name}</span></span></th>
                  {days.map((d) => { const c = on(x, d); return (
                    <td key={d.toISOString()}>
                      <button type="button" className="tf-bizset__cell" data-own={c.own || undefined} data-off={(c.off || !c.day?.on) || undefined} onClick={() => setCell({ x, date: d })}
                        aria-label={`${x.name}, ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${c.off ? 'away' : c.day?.on ? c.day.ranges.map((r) => `${clock(r.start)} to ${clock(r.end)}`).join(', ') : 'off'}`}>
                        {c.off ? 'Away' : c.day?.on ? c.day.ranges.map((r) => `${clock(r.start)}–${clock(r.end)}`).join(', ') : 'Off'}
                      </button>
                    </td>
                  ); })}
                  <td>
                    <MenuTrigger>
                      <IconButton size="sm" label={`Shifts for ${x.name}`}><MoreHorizontal {...i14} /></IconButton>
                      <Menu aria-label={`Shifts for ${x.name}`} placement="bottom end" onAction={(k) => {
                        if (k === 'regular') setRegular(x); else if (k === 'all') copyWeekToAll(x); else if (k === 'others') setCopyTo(x);
                        else if (k === 'off') setAway({ x, kind: 'off' }); else if (k === 'block') setAway({ x, kind: 'block' });
                      }}>
                        <MenuItem id="regular" icon={<Clock {...i16} />}>Set regular week…</MenuItem>
                        <MenuItem id="all" icon={<Copy {...i16} />}>Copy this week to all weeks</MenuItem>
                        <MenuItem id="others" icon={<Users {...i16} />}>Copy shifts to others…</MenuItem>
                        <MenuSeparator />
                        <MenuItem id="off" icon={<CalendarOff {...i16} />} isDisabled={Boolean(x.member)} description={x.member ? 'From their own Availability' : undefined}>Add time off…</MenuItem>
                        <MenuItem id="block" isDisabled={Boolean(x.member)} description={x.member ? 'From their own Availability' : undefined}>Block time…</MenuItem>
                      </Menu>
                    </MenuTrigger>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tf-rec__muted">A date with its own hours shows in blue. Time off shows as Away.</p>
      {cell && (() => { const c = on(cell.x, cell.date); return <DayDialog x={cell.x} date={cell.date} day={c.day} own={c.own} onClose={() => setCell(undefined)}
        onSave={(day) => { act({ type: 'overrides/merge', patch: { [`${cell.x.name}|${isoDay(cell.date)}`]: day } }); setCell(undefined); toast({ message: day ? 'Hours saved for that day' : 'Back to the regular week', tone: 'success' }); }} />; })()}
      {regular && <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setRegular(undefined); }} title={`${regular.name}’s regular week at ${place.name}`} description="Every week, unless a date has its own hours." actions={<Button variant="primary" slot="close">Done</Button>}>
        <HoursEditor value={regularOf(regular)} onChange={(h) => save({ ...z, shifts: { ...z.shifts, [`${place.id}|${regular.id}`]: h } })} />
      </Dialog>}
      {copyTo && <CopyShifts from={copyTo} people={people.filter((x) => x.id !== copyTo.id)} onClose={() => setCopyTo(undefined)}
        onCopy={(ids) => { const w = regularOf(copyTo); save({ ...z, shifts: { ...z.shifts, ...Object.fromEntries(ids.map((id) => [`${place.id}|${id}`, w])) } }, `${copyTo.name.split(' ')[0]}’s shifts copied to ${plural(ids.length, 'person', 'people')}`, true); setCopyTo(undefined); }} />}
      {away && <AwayDialog kind={away.kind} name={away.x.name} onClose={() => setAway(undefined)} onBlock={(b) => { act({ type: 'block/add', block: b }); setAway(undefined); toast({ message: 'Time blocked', tone: 'success' }); }}
        onOff={(t) => { act({ type: 'timeoff/set', timeOff: [...s.timeOff, t] }); setAway(undefined); toast({ message: 'Time off added', tone: 'success' }); }} />}
    </section>
  );
}

function DayDialog({ x, date, day, own, onClose, onSave }: { readonly x: Staff; readonly date: Date; readonly day?: WeekHours['mon']; readonly own: boolean; readonly onClose: () => void; readonly onSave: (d: WeekHours['mon'] | null) => void }) {
  const r = day?.ranges[0];
  const [working, setWorking] = useState(Boolean(day?.on));
  const [a, setA] = useState(r?.start ?? 600); const [b, setB] = useState(r?.end ?? 1080);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`${x.name.split(' ')[0]} on ${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`} description="Only this date changes."
      actions={<>{own && <Button variant="ghost" onPress={() => onSave(null)}>Back to regular</Button>}<span className="tf-bkf__spacer" /><Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isDisabled={working && b <= a} onPress={() => onSave({ on: working, ranges: [{ id: nextId('r'), start: a, end: b }] })}>Save</Button></>}>
      <div className="tf-bkf__stack">
        <Switch isSelected={working} onChange={setWorking}>Working this day</Switch>
        {working && <div className="tf-bkf__pair">
          <TimeSelect label="From" value={hm(a)} onChange={(v) => setA(mins(v, 600))} hourCycle={12} step={15} />
          <TimeSelect label="Until" value={hm(b)} onChange={(v) => setB(mins(v, 1080))} hourCycle={12} step={15} isInvalid={b <= a} errorMessage="Ends after it starts." />
        </div>}
      </div>
    </Dialog>
  );
}

function CopyShifts({ from, people, onClose, onCopy }: { readonly from: Staff; readonly people: ReadonlyArray<Staff>; readonly onClose: () => void; readonly onCopy: (ids: ReadonlyArray<string>) => void }) {
  const [ids, setIds] = useState<ReadonlyArray<string>>([]);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Copy ${from.name.split(' ')[0]}’s shifts`} description="Their regular week replaces the regular week of the people you pick."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={ids.length === 0} onPress={() => onCopy(ids)}>Copy to {ids.length ? plural(ids.length, 'person', 'people') : 'them'}</Button></>}>
      {people.length === 0 ? <p className="tf-rec__muted">Nobody else works at this place.</p> : <fieldset className="tf-set__check"><legend>Copy to</legend>
        {people.map((x) => <Checkbox key={x.id} isSelected={ids.includes(x.id)} onChange={(on) => setIds(on ? [...ids, x.id] : ids.filter((i) => i !== x.id))}>{x.name}</Checkbox>)}</fieldset>}
    </Dialog>
  );
}
