// Settings › Business (spec 0065 H0, 0066 B4 lite): the businesses a workspace runs (switch, add with the setup card, copy, remove asking
// first), the shown one's profile, its places (each with its week of hours, special days and details) and its public page, edited as a
// draft with a gallery, About, amenities and search listing, published through the PublishBar and shared with the ShareSheet.
import { useState } from 'react';
import { parseDate } from '@internationalized/date';
import { ArrowLeft, Building2, CalendarClock, ChevronRight, Clock, Copy, Eye, Globe, ImagePlus, MapPin, MoreHorizontal, Plus, Share2, Store, Trash2, X } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch, Checkbox } from '../Checkbox/Checkbox.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Checklist } from '../Checklist/Checklist.tsx';
import { HoursEditor, HoursSummary } from '../HoursEditor/HoursEditor.tsx';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { CroppedImage, PhotoCrop } from '../PhotoCrop/PhotoCrop.tsx';
import { PublishBar } from '../FloatingBar/FloatingBar.tsx';
import { ShareSheet } from '../ShareSheet/ShareSheet.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { DragList } from '../../lib/drag.ts';
import { DragHandle, DragItem } from '../DragHandle/DragHandle.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { AMENITIES, BIZ_ZONES, CURRENCIES, bizOf, currentBiz, newBusiness, pageDiff, pageProblems, type BizPage, type BizState, type Business, type Place, type SpecialDay } from '../BookingsFlow/biz.ts';
import { isoDay, nextId, type BookingsAction, type BookingsState, type BusinessProfile } from '../BookingsFlow/state.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (v: string | null | undefined, d: number) => { if (!v) return d; const [h = '0', m = '0'] = v.split(':'); return Number(h) * 60 + Number(m); };
const clock = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Today's hours at a place: a special day first, else its week. */
export function todayAt(p: Place, now = new Date()): string {
  const sd = p.specialDays.find((d) => d.date === isoDay(now));
  if (sd) return sd.closed ? `Closed today · ${sd.note || 'special day'}` : `${clock(sd.start)} – ${clock(sd.end)} today · ${sd.note || 'special day'}`;
  const d = p.hours[DAYS[now.getDay()] ?? 'mon'];
  return d?.on && d.ranges[0] ? `Open today ${d.ranges.map((r) => `${clock(r.start)} – ${clock(r.end)}`).join(', ')}` : 'Closed today';
}

/** The profile the rest of Bookings reads (the public page, Pages, Home), from a business. */
export function profileFrom(b: Business, base?: BusinessProfile): BusinessProfile {
  const live = b.page.live;
  return {
    rating: 0, reviews: 0, ...base, kind: b.kind, kindLabel: b.kindLabel, handle: b.handle, address: b.places[0]?.address ?? '', area: b.places[0]?.name ?? '', phone: b.phone,
    about: live?.about ?? b.description, amenities: live?.amenities ?? [], photos: (live?.gallery ?? []).map((g) => g.src), published: Boolean(live),
  };
}

/** Props for BusinessScreen. */
export interface BusinessScreenProps {
  readonly bookings?: BookingsState;
  readonly act: (a: BookingsAction) => void;
  /** Opens the public page as a guest. */
  readonly onSeePage?: () => void;
}

type View = { readonly at: 'home' } | { readonly at: 'place'; readonly id: string } | { readonly at: 'page' };

/** Settings › Business. */
export function BusinessScreen({ bookings, act, onSeePage }: BusinessScreenProps) {
  const { toast } = useToast();
  const [view, setView] = useState<View>({ at: 'home' });
  if (!bookings) return <SettingsSection title="Business"><p className="tf-rec__muted">Open Bookings once to load your business.</p></SettingsSection>;
  const z = bizOf(bookings);
  const b = currentBiz(z);
  const save = (next: BizState, message?: string, undo?: BizState) => {
    act({ type: 'biz/set', biz: next, business: profileFrom(currentBiz(next), bookings.business) });
    if (message) toast({ message, tone: undo ? undefined : 'success', action: undo ? { label: 'Undo', onAction: () => act({ type: 'biz/set', biz: undo, business: profileFrom(currentBiz(undo), bookings.business) }) } : undefined });
  };
  const setBiz = (nb: Business, message?: string, undo = false) => save({ ...z, businesses: z.businesses.map((x) => (x.id === nb.id ? nb : x)) }, message, undo ? z : undefined);
  if (view.at === 'place') {
    const place = b.places.find((p) => p.id === view.id);
    if (place) return <PlacePage business={b} place={place} onBack={() => setView({ at: 'home' })} onSave={(p, message, undo) => setBiz({ ...b, places: b.places.map((x) => (x.id === p.id ? p : x)) }, message, undo)}
      onRemove={b.places.length > 1 ? () => { setBiz({ ...b, places: b.places.filter((x) => x.id !== place.id) }, `${place.name} removed`, true); setView({ at: 'home' }); } : undefined} />;
  }
  if (view.at === 'page') return <BusinessPageEditor business={b} onBack={() => setView({ at: 'home' })} onSave={setBiz} onSeePage={onSeePage} />;
  return <BusinessHome z={z} b={b} save={save} setBiz={setBiz} onPlace={(id) => setView({ at: 'place', id })} onPage={() => setView({ at: 'page' })} />;
}

function BusinessHome({ z, b, save, setBiz, onPlace, onPage }: {
  readonly z: BizState; readonly b: Business; readonly save: (next: BizState, message?: string, undo?: BizState) => void; readonly setBiz: (nb: Business, message?: string) => void;
  readonly onPlace: (id: string) => void; readonly onPage: () => void;
}) {
  const [form, setForm] = useState(b);
  const [formFor, setFormFor] = useState(b.id);
  if (formFor !== b.id) { setFormFor(b.id); setForm(b); }
  const [ask, setAsk] = useState<{ readonly kind: 'add' } | { readonly kind: 'copy'; readonly from: Business } | { readonly kind: 'remove'; readonly target: Business } | { readonly kind: 'place' }>();
  const dirty = (['name', 'kindLabel', 'email', 'website', 'phone', 'description', 'currency', 'zone'] as const).some((k) => form[k] !== b[k]);
  const emailBad = form.email.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
  const diff = pageDiff(b);
  const steps = [
    { id: 'profile', title: 'Fill in your profile', description: 'Email and a line about the business', icon: <Store {...i16} />, actionLabel: 'Fill in', isDone: Boolean(b.email && b.description) },
    { id: 'hours', title: 'Set your opening hours', description: b.places[0]?.name ?? 'Your place', icon: <Clock {...i16} />, actionLabel: 'Set hours', isDone: b.places.every((p) => Object.values(p.hours).some((d) => d.on)) },
    { id: 'address', title: 'Add every place’s address', description: 'Guests find you with it', icon: <MapPin {...i16} />, actionLabel: 'Add', isDone: b.places.every((p) => p.address.trim() !== '') },
    { id: 'page', title: 'Publish your business page', description: `timefix.com/${b.handle}`, icon: <Globe {...i16} />, actionLabel: 'Open page', isDone: Boolean(b.page.live) },
  ];
  const hidden = (z.hidden ?? []).includes(`setup:${b.id}`);
  return (
    <>
      {!hidden && steps.some((s) => !s.isDone) && (
        <Checklist title={`Finish setting up ${b.name}`} steps={steps} defaultExpanded
          onAction={(id) => { if (id === 'page') onPage(); else if (id === 'profile') document.getElementById('tf-bizset-email')?.focus(); else onPlace(b.places.find((p) => !p.address.trim())?.id ?? b.places[0]?.id ?? ''); }}
          onHide={() => save({ ...z, hidden: [...(z.hidden ?? []), `setup:${b.id}`] })} />
      )}
      <SettingsSection title="Businesses" description="Each has its own places, page and staff. The one shown is what Bookings and your page use."
        action={<Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setAsk({ kind: 'add' })}>Add business</Button>}>
        <ul className="tf-set__list">
          {z.businesses.map((x) => (
            <li key={x.id} className="tf-bizset__row">
              <span className="tf-bizset__tile" aria-hidden="true"><Building2 {...i16} /></span>
              <span className="tf-bizset__text"><strong>{x.name}</strong><span className="tf-rec__muted">{x.kindLabel} · {x.places.length === 1 ? '1 place' : `${x.places.length} places`} · timefix.com/{x.handle}</span></span>
              {x.id === z.currentId ? <Tag size="sm" hue="green">Shown</Tag> : <Button size="sm" variant="secondary" onPress={() => save({ ...z, currentId: x.id }, `Showing ${x.name}`, z)}>Switch</Button>}
              <MenuTrigger>
                <IconButton size="sm" label={`More for ${x.name}`}><MoreHorizontal {...i14} /></IconButton>
                <Menu aria-label={`${x.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'copy') setAsk({ kind: 'copy', from: x }); else if (k === 'remove') setAsk({ kind: 'remove', target: x }); }}>
                  <MenuItem id="copy" icon={<Copy {...i16} />} description="Places, hours and page, under a new name">Copy business…</MenuItem>
                  <MenuSeparator />
                  <MenuItem id="remove" icon={<Trash2 {...i16} />} isDanger isDisabled={z.businesses.length === 1} description={z.businesses.length === 1 ? 'A workspace keeps one business' : undefined}>Remove business…</MenuItem>
                </Menu>
              </MenuTrigger>
            </li>
          ))}
        </ul>
      </SettingsSection>
      <SettingsSection title="Profile" description={`What guests read about ${b.name}. Prices show in its currency; times on its clock.`}
        action={<span className="tf-bkf__row">{dirty && <Button variant="ghost" onPress={() => setForm(b)}>Discard</Button>}<Button variant="primary" isDisabled={!dirty || !form.name.trim() || emailBad} onPress={() => setBiz({ ...form, name: form.name.trim() }, 'Profile saved')}>Save</Button></span>}>
        <div className="tf-bkf__stack"><div className="tf-rec__form tf-set__narrow">
          <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} isInvalid={!form.name.trim()} errorMessage="Give the business a name." />
          <TextField label="What it is" value={form.kindLabel} onChange={(kindLabel) => setForm({ ...form, kindLabel })} placeholder="Hair salon" description="Under the name on your page." />
          <TextField id="tf-bizset-email" label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} placeholder="hello@lumen.in" isInvalid={emailBad} errorMessage="That doesn’t look like an email." description="Guests’ replies and booking emails come from here." />
          <TextField label="Website" aside="Optional" value={form.website} onChange={(website) => setForm({ ...form, website })} placeholder="lumen.in" />
          <TextField label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} placeholder="+91 98200 11223" />
          <Select label="Currency" value={form.currency} onChange={(v) => v && setForm({ ...form, currency: v })} items={CURRENCIES.map((c) => ({ id: c.id, label: c.label }))} />
          <Select label="Time zone" value={form.zone} onChange={(v) => v && setForm({ ...form, zone: v })} items={BIZ_ZONES.map((c) => ({ id: c.id, label: c.label }))} description="A new place starts on it." />
        </div>
        <TextArea label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} rows={3} showCount maxLength={300} placeholder="A calm studio for cuts and colour." /></div>
      </SettingsSection>
      <SettingsSection title="Places" description="Where you work from. Each keeps its own hours, special days and details."
        action={<Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setAsk({ kind: 'place' })}>Add place</Button>}>
        <ul className="tf-set__list">
          {b.places.map((p) => (
            <li key={p.id}>
              <button type="button" className="tf-set__open" onClick={() => onPlace(p.id)} aria-label={`Open ${p.name}`}>
                <span className="tf-bizset__text"><strong>{p.name}</strong><span className="tf-rec__muted">{p.address || 'No address yet'}</span></span>
                <span className="tf-rec__muted tf-num">{todayAt(p)}</span>
                <ChevronRight {...i16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </SettingsSection>
      <SettingsSection title="Business page" description={`timefix.com/${b.handle}: photos, about, amenities and what guests can book.`}
        status={<Tag size="sm" hue={!b.page.live ? 'gray' : diff.length ? 'orange' : 'green'}>{!b.page.live ? 'Not published' : diff.length ? `${diff.length} unpublished ${diff.length === 1 ? 'change' : 'changes'}` : 'Published'}</Tag>}
        action={<Button variant="secondary" onPress={onPage}>Edit page</Button>}>
        <p className="tf-rec__muted">{b.page.draft.gallery.length} photos · {b.page.draft.amenities.length} amenities · {b.places.filter((p) => p.listed).length} of {b.places.length} places listed in search</p>
      </SettingsSection>
      {ask?.kind === 'add' && <BusinessCard hoursFrom={b.places[0]?.hours} onClose={() => setAsk(undefined)} onCreate={(nb) => { save({ ...z, businesses: [...z.businesses, nb], currentId: nb.id }, `${nb.name} added and shown`, z); setAsk(undefined); }} />}
      {ask?.kind === 'copy' && <CopyBusiness from={ask.from} z={z} onClose={() => setAsk(undefined)} onCopy={(next, name) => { save(next, `${name} made from ${ask.from.name}`, z); setAsk(undefined); }} />}
      {ask?.kind === 'remove' && <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) setAsk(undefined); }} title={`Remove ${ask.target.name}?`} tone="danger" confirmLabel="Remove business"
        consequence={<>Its {ask.target.places.length === 1 ? 'place' : `${ask.target.places.length} places`}, page and shifts go, and timefix.com/{ask.target.handle} stops working. Bookings already made stay in Meetings.</>}
        onConfirm={() => { const rest = z.businesses.filter((x) => x.id !== ask.target.id); save({ ...z, businesses: rest, currentId: z.currentId === ask.target.id ? rest[0]?.id ?? '' : z.currentId }, `${ask.target.name} removed`, z); setAsk(undefined); }} />}
      {ask?.kind === 'place' && <NewPlace zone={b.zone} hours={b.places[0]?.hours} onClose={() => setAsk(undefined)} onAdd={(p) => { setBiz({ ...b, places: [...b.places, p] }, `${p.name} added`); setAsk(undefined); onPlace(p.id); }} />}
    </>
  );
}

/** The first short card for a new business: name, kind, the first place's address, time zone and currency. */
function BusinessCard({ hoursFrom, onClose, onCreate }: { readonly hoursFrom?: Place['hours']; readonly onClose: () => void; readonly onCreate: (b: Business) => void }) {
  const [v, setV] = useState({ name: '', kind: 'salon' as 'salon' | 'restaurant', address: '', zone: 'Asia/Kolkata', currency: 'INR' });
  const [tried, setTried] = useState(false);
  const ok = v.name.trim() !== '' && v.address.trim() !== '';
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Set up a business" description="Just enough to start. Hours, staff and the page come next."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { setTried(true); if (ok && hoursFrom) onCreate(newBusiness({ ...v, name: v.name.trim(), address: v.address.trim() }, hoursFrom)); }}>Create business</Button></>}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={v.name} onChange={(name) => setV({ ...v, name })} placeholder="Lumen Juhu" autoFocus isInvalid={tried && !v.name.trim()} errorMessage="Give it a name." />
        <Select label="What it is" value={v.kind} onChange={(k) => k && setV({ ...v, kind: k === 'restaurant' ? 'restaurant' : 'salon' })} items={[{ id: 'salon', label: 'Salon, clinic or studio' }, { id: 'restaurant', label: 'Restaurant or café' }]} />
        <TextField label="Address of the first place" value={v.address} onChange={(address) => setV({ ...v, address })} placeholder="22 Juhu Tara Road, Mumbai" isInvalid={tried && !v.address.trim()} errorMessage="Guests need an address to find you." />
        <div className="tf-bkf__pair">
          <Select label="Time zone" value={v.zone} onChange={(z) => z && setV({ ...v, zone: z })} items={BIZ_ZONES.map((c) => ({ id: c.id, label: c.label }))} />
          <Select label="Currency" value={v.currency} onChange={(c) => c && setV({ ...v, currency: c })} items={CURRENCIES.map((c) => ({ id: c.id, label: c.label }))} />
        </div>
      </div>
    </Dialog>
  );
}

/** Copy a business: places and hours always; its page and its staff if picked. */
function CopyBusiness({ from, z, onClose, onCopy }: { readonly from: Business; readonly z: BizState; readonly onClose: () => void; readonly onCopy: (next: BizState, name: string) => void }) {
  const [name, setName] = useState(`${from.name} copy`);
  const [page, setPage] = useState(true);
  const [staff, setStaff] = useState(true);
  const go = () => {
    const ids = new Map(from.places.map((p) => [p.id, nextId('pl')]));
    const nb: Business = { ...from, id: nextId('biz'), name: name.trim(), handle: `${from.handle}-2`, places: from.places.map((p) => ({ ...p, id: ids.get(p.id) ?? nextId('pl') })), page: page ? { draft: from.page.draft } : { draft: { gallery: [], about: '', amenities: [] } } };
    const people = staff ? z.staff.filter((s) => s.placeIds.some((id) => ids.has(id))).map((s) => ({ ...s, placeIds: [...s.placeIds, ...s.placeIds.map((id) => ids.get(id)).filter((x): x is string => Boolean(x))] })) : [];
    const shifts = staff ? Object.fromEntries(Object.entries(z.shifts).flatMap(([k, v]) => { const [pl, st] = k.split('|'); const to = pl ? ids.get(pl) : undefined; return to ? [[k, v], [`${to}|${st}`, v]] : [[k, v]]; })) : z.shifts;
    onCopy({ ...z, businesses: [...z.businesses, nb], staff: z.staff.map((s) => people.find((p) => p.id === s.id) ?? s), shifts }, nb.name);
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Copy ${from.name}`} description="The copy starts unpublished at its own address. Bookings and clients stay with the original."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={go}>Make copy</Button></>}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={name} onChange={setName} autoFocus />
        <fieldset className="tf-set__check"><legend>Bring along</legend>
          <Checkbox isSelected isDisabled>Places and their hours</Checkbox>
          <Checkbox isSelected={page} onChange={setPage}>The business page as a draft</Checkbox>
          <Checkbox isSelected={staff} onChange={setStaff}>Staff and their shifts</Checkbox>
        </fieldset>
      </div>
    </Dialog>
  );
}

function NewPlace({ zone, hours, onClose, onAdd }: { readonly zone: string; readonly hours?: Place['hours']; readonly onClose: () => void; readonly onAdd: (p: Place) => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Add a place" description="It starts on the first place’s hours. Change them on its page."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || !address.trim() || !hours} onPress={() => hours && onAdd({ id: nextId('pl'), name: name.trim(), address: address.trim(), zone, hours, specialDays: [], listed: true })}>Add place</Button></>}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={name} onChange={setName} placeholder="Juhu" autoFocus />
        <TextField label="Address" value={address} onChange={setAddress} placeholder="22 Juhu Tara Road, Mumbai" />
      </div>
    </Dialog>
  );
}

/** One place: its week of hours (saved as each changes), special days (removal with Undo) and details. */
function PlacePage({ business, place, onBack, onSave, onRemove }: {
  readonly business: Business; readonly place: Place; readonly onBack: () => void; readonly onSave: (p: Place, message?: string, undo?: boolean) => void; readonly onRemove?: () => void;
}) {
  const [details, setDetails] = useState(place);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saved'>('idle');
  const dirty = (['name', 'address', 'phone', 'zone', 'listed'] as const).some((k) => details[k] !== place[k]);
  const upcoming = [...place.specialDays].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <div className="tf-bizset__back"><Button variant="ghost" size="sm" icon={<ArrowLeft {...i14} />} onPress={onBack}>{business.name}</Button></div>
      <SettingsSection title={`${place.name} · hours`} description="Guests book inside these. Each change saves at once." status={saved === 'saved' ? <span className="tf-rec__muted" role="status">Saved</span> : undefined}>
        <HoursSummary value={place.hours} />
        <HoursEditor value={place.hours} onChange={(hours) => { onSave({ ...place, hours }); setSaved('saved'); }} />
      </SettingsSection>
      <SettingsSection title="Special days" description="A holiday, a late night or a day closed. They beat the week."
        action={<Button variant="secondary" icon={<CalendarClock {...i14} />} onPress={() => setAdding(true)}>Add special day</Button>}>
        {upcoming.length === 0 ? <p className="tf-rec__muted">None yet. Open as usual every week.</p> : (
          <ul className="tf-set__list">{upcoming.map((d) => (
            <li key={d.id}>
              <span className="tf-bizset__text"><strong>{dayLabel(d.date)}</strong><span className="tf-rec__muted">{d.closed ? 'Closed' : `${clock(d.start)} – ${clock(d.end)}`}{d.note ? ` · ${d.note}` : ''}</span></span>
              <IconButton size="sm" label={`Remove ${dayLabel(d.date)}`} onPress={() => onSave({ ...place, specialDays: place.specialDays.filter((x) => x.id !== d.id) }, `${dayLabel(d.date)} removed`, true)}><X {...i14} /></IconButton>
            </li>
          ))}</ul>
        )}
      </SettingsSection>
      <SettingsSection title="Details" description="How guests find this place."
        action={<span className="tf-bkf__row">{onRemove && <Button variant="ghost" icon={<Trash2 {...i14} />} onPress={() => setRemoving(true)}>Remove place</Button>}<Button variant="primary" isDisabled={!dirty || !details.name.trim() || !details.address.trim()} onPress={() => onSave(details, 'Details saved')}>Save</Button></span>}>
        <div className="tf-rec__form tf-set__narrow">
          <TextField label="Name" value={details.name} onChange={(name) => setDetails({ ...details, name })} isInvalid={!details.name.trim()} errorMessage="Give the place a name." />
          <TextField label="Address" value={details.address} onChange={(address) => setDetails({ ...details, address })} isInvalid={!details.address.trim()} errorMessage="Guests need an address." />
          <TextField label="Phone" aside="Optional" value={details.phone ?? ''} onChange={(phone) => setDetails({ ...details, phone })} />
          <Select label="Time zone" value={details.zone} onChange={(v) => v && setDetails({ ...details, zone: v })} items={BIZ_ZONES.map((c) => ({ id: c.id, label: c.label }))} />
        </div>
        <div className="tf-set__switch"><span><strong>List in search</strong><span className="tf-rec__muted">Search engines and Timefix’s directory show this place.</span></span><Switch aria-label="List in search" isSelected={details.listed} onChange={(listed) => setDetails({ ...details, listed })} /></div>
      </SettingsSection>
      {adding && <SpecialDayDialog onClose={() => setAdding(false)} taken={place.specialDays.map((d) => d.date)} onAdd={(d) => { onSave({ ...place, specialDays: [...place.specialDays, d] }, `${dayLabel(d.date)} added`); setAdding(false); }} />}
      {removing && onRemove && <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) setRemoving(false); }} title={`Remove ${place.name}?`} tone="danger" confirmLabel="Remove place"
        consequence="Its hours, special days and tables go. Bookings already made there stay in Meetings." onConfirm={() => { setRemoving(false); onRemove(); }} />}
    </>
  );
}

function SpecialDayDialog({ taken, onClose, onAdd }: { readonly taken: ReadonlyArray<string>; readonly onClose: () => void; readonly onAdd: (d: SpecialDay) => void }) {
  const [date, setDate] = useState(isoDay(new Date(Date.now() + 7 * 86_400_000)));
  const [closed, setClosed] = useState(true);
  const [start, setStart] = useState(600); const [end, setEnd] = useState(1080);
  const [note, setNote] = useState('');
  const clash = taken.includes(date); const backwards = !closed && end <= start;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Add a special day"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={clash || backwards} onPress={() => onAdd({ id: nextId('sd'), date, closed, start, end, note: note.trim() })}>Add day</Button></>}>
      <div className="tf-bkf__stack">
        <DatePicker label="Day" value={parseDate(date)} onChange={(v) => { if (v) setDate(v.toString()); }} errorMessage={clash ? 'This day already has its own hours.' : undefined} isInvalid={clash} />
        <Switch isSelected={closed} onChange={setClosed}>Closed all day</Switch>
        {!closed && <div className="tf-bkf__pair">
          <TimeSelect label="Opens" value={hm(start)} onChange={(v) => setStart(mins(v, 600))} hourCycle={12} step={30} />
          <TimeSelect label="Closes" value={hm(end)} onChange={(v) => setEnd(mins(v, 1080))} hourCycle={12} step={30} isInvalid={backwards} errorMessage="Closes after it opens." />
        </div>}
        <TextField label="Note" aside="Optional" value={note} onChange={setNote} placeholder="Diwali" />
      </div>
    </Dialog>
  );
}

/** The public page as a draft: address, gallery, About, amenities and search listing; Publish puts it live. */
function BusinessPageEditor({ business: b, onBack, onSave, onSeePage }: { readonly business: Business; readonly onBack: () => void; readonly onSave: (nb: Business, message?: string, undo?: boolean) => void; readonly onSeePage?: () => void }) {
  const { toast } = useToast();
  const [cropping, setCropping] = useState<{ readonly id?: string; readonly src?: string }>();
  const [sharing, setSharing] = useState(false);
  const [bar, setBar] = useState<'publishing' | 'published'>();
  const [handle, setHandle] = useState(b.handle);
  const d = b.page.draft;
  const setDraft = (patch: Partial<BizPage>) => onSave({ ...b, page: { ...b.page, draft: { ...d, ...patch } } });
  const diff = pageDiff(b);
  const problems = pageProblems(b);
  const handleBad = !/^[a-z0-9-]{3,30}$/.test(handle);
  const publish = () => {
    const first = !b.page.live;
    setBar('publishing');
    window.setTimeout(() => { onSave({ ...b, page: { draft: d, live: d } }); setBar('published'); window.setTimeout(() => setBar(undefined), 1400); if (first) setSharing(true); }, 500);
  };
  return (
    <div className="tf-bizset__page">
      <div className="tf-bizset__back"><Button variant="ghost" size="sm" icon={<ArrowLeft {...i14} />} onPress={onBack}>{b.name}</Button>
        <span className="tf-bkf__spacer" />
        {onSeePage && <Button variant="ghost" icon={<Eye {...i14} />} onPress={onSeePage}>See it as a guest</Button>}
        <Button variant="secondary" icon={<Share2 {...i14} />} isDisabled={!b.page.live} onPress={() => setSharing(true)}>Share</Button></div>
      {problems.length > 0 && <Callout tone="warning">Before it can go live: {problems.map((p) => p.text.replace(/\.$/, '').toLowerCase()).join('; ')}.</Callout>}
      <SettingsSection title="Address" description="Changing it stops the old link working.">
        <div className="tf-set__row"><TextField label="Page address" description={`timefix.com/${handle}`} value={handle} onChange={(v) => setHandle(v.toLowerCase())} className="tf-set__grow" isInvalid={handleBad} errorMessage="3 to 30 letters, numbers or dashes." />
          <Button variant="secondary" isDisabled={handleBad || handle === b.handle} onPress={() => onSave({ ...b, handle }, `Your page is now timefix.com/${handle}`, true)}>Claim</Button></div>
      </SettingsSection>
      <SettingsSection title="Gallery" description="The first photo leads the page. Drag to reorder; each gets a short description for screen readers."
        action={<Button variant="secondary" icon={<ImagePlus {...i14} />} isDisabled={d.gallery.length >= 12} onPress={() => setCropping({})}>Add photo</Button>}>
        {d.gallery.length === 0 ? <EmptyState size="sm" icon={<ImagePlus size={20} strokeWidth={1.75} />} title="No photos yet" description="Add your space, your work and your team. Wide photos work best." />
          : (
            <DragList ids={d.gallery.map((g) => g.id)} layout="grid" textOf={(id) => d.gallery.find((g) => g.id === id)?.caption || 'Photo'}
              onReorder={(ids) => setDraft({ gallery: ids.map((id) => d.gallery.find((g) => g.id === id)).filter((g): g is BizPage['gallery'][number] => Boolean(g)) })}
              overlay={(id) => { const g = d.gallery.find((x) => x.id === id); return g ? <div className="tf-bizset__photo"><Photo g={g} /></div> : null; }}>
              <ul className="tf-bizset__gallery" aria-label="Gallery, in page order">
                {d.gallery.map((g, i) => (
                  <DragItem key={g.id} id={g.id} className="tf-bizset__photo">
                    {(r) => <>
                      <Photo g={g} />
                      <span className="tf-bizset__photobar"><DragHandle label={`Move photo ${i + 1}`} reveal="always" size="sm" isLifted={r.isDragging} drag={r.grip} />{i === 0 && <Tag size="sm">Cover</Tag>}<span className="tf-bkf__spacer" />
                        <MenuTrigger>
                          <IconButton size="sm" label={`More for photo ${i + 1}`}><MoreHorizontal {...i14} /></IconButton>
                          <Menu aria-label={`Photo ${i + 1}`} placement="bottom end" onAction={(k) => {
                            if (k === 'crop') setCropping({ id: g.id, src: g.src });
                            else if (k === 'first') setDraft({ gallery: [g, ...d.gallery.filter((x) => x.id !== g.id)] });
                            else if (k === 'remove') onSave({ ...b, page: { ...b.page, draft: { ...d, gallery: d.gallery.filter((x) => x.id !== g.id) } } }, 'Photo removed', true);
                          }}>
                            <MenuItem id="crop">Adjust crop</MenuItem>
                            {i > 0 && <MenuItem id="first">Make it the cover</MenuItem>}
                            <MenuSeparator />
                            <MenuItem id="remove" icon={<Trash2 {...i16} />} isDanger>Remove</MenuItem>
                          </Menu>
                        </MenuTrigger></span>
                      <TextField aria-label={`Description of photo ${i + 1}`} value={g.caption} placeholder="Describe it" onChange={(caption) => setDraft({ gallery: d.gallery.map((x) => (x.id === g.id ? { ...x, caption } : x)) })} />
                    </>}
                  </DragItem>
                ))}
              </ul>
            </DragList>
          )}
      </SettingsSection>
      <SettingsSection title="About" description="A few lines guests read under your name.">
        <TextArea aria-label="About" value={d.about} onChange={(about) => setDraft({ about })} rows={4} showCount maxLength={500} />
      </SettingsSection>
      <SettingsSection title="Amenities" description="What guests can count on.">
        <ChoiceChips label="Amenities" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={[...d.amenities]} items={AMENITIES.map((a) => ({ id: a, label: a }))} onSelectionChange={(k) => setDraft({ amenities: AMENITIES.filter((a) => k.has(a)) })} />
      </SettingsSection>
      <SettingsSection title="Listing" description="Each place’s address shows on the page; listed places can be found in search.">
        {b.places.map((p) => (
          <div key={p.id} className="tf-set__switch"><span><strong>{p.name}</strong><span className="tf-rec__muted">{p.address || 'No address yet'}</span></span>
            <Switch aria-label={`List ${p.name} in search`} isSelected={p.listed} onChange={(listed) => onSave({ ...b, places: b.places.map((x) => (x.id === p.id ? { ...x, listed } : x)) }, listed ? `${p.name} is listed` : `${p.name} is unlisted`)} /></div>
        ))}
      </SettingsSection>
      <PublishBar status={bar ?? (diff.length > 0 ? 'draft' : 'live')} changes={b.page.live ? diff.length : 1} message={b.page.live ? undefined : 'Not published yet'} isPublishDisabled={problems.length > 0}
        onPublish={publish} onDiscard={b.page.live ? () => { const was = b; onSave({ ...b, page: { draft: b.page.live ?? d, live: b.page.live } }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => onSave(was) } }); } : undefined} />
      <ShareSheet isOpen={sharing} onOpenChange={setSharing} title={bar === 'published' ? `${b.name} is live` : `Share ${b.name}`} url={`timefix.com/${b.handle}`} name={b.name} invite="Book with us:" description="Your business page: photos, about and what guests can book." />
      {cropping && <PhotoCrop isOpen onOpenChange={(o) => { if (!o) setCropping(undefined); }} shape="wide" src={cropping.src} title={cropping.id ? 'Adjust crop' : 'Add a photo'}
        initialCrop={cropping.id ? d.gallery.find((g) => g.id === cropping.id)?.crop : undefined}
        onSave={(src, crop) => {
          if (cropping.id) setDraft({ gallery: d.gallery.map((g) => (g.id === cropping.id ? { ...g, src, crop } : g)) });
          else setDraft({ gallery: [...d.gallery, { id: nextId('g'), src, caption: '', crop }] });
          setCropping(undefined);
        }} />}
    </div>
  );
}

/** A gallery photo as framed in the cropper, 200px wide. */
function Photo({ g }: { readonly g: BizPage['gallery'][number] }) {
  return g.crop ? <CroppedImage src={g.src} crop={g.crop} width={200} alt={g.caption} /> : <img src={g.src} alt={g.caption} className="tf-bizset__img" />;
}
