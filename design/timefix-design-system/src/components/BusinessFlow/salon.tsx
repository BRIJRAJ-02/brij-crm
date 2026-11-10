// Salon: the day's calendar (one column a person), the service menu, and the team. Calm by default; details open in drawers.
import { useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Scissors, Trash2, UserPlus } from 'lucide-react';
import { WeekCalendar, type WeekBusy, type WeekEvent } from '../WeekCalendar/WeekCalendar.tsx';
import { formatClock, formatClockRange } from '../WeekCalendar/clock.ts';
import { HoursEditor, summarizeHours } from '../HoursEditor/HoursEditor.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Avatar, AvatarGroup } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { Section, SettingRow, TabToolbar, i14, i16 } from '../BookingsFlow/parts.tsx';
import { weekdays } from '../BookingsFlow/seed.ts';
import {
  at, canDo, dayFrom, dayKey, doers, first, isoDay, lengthText, minutesOf, nextId, pickAny, plural, priceText, rupees, sameDay, serviceById, serviceSlots, staffById, variantOf,
  type Appointment, type AppointmentStatus, type BizAction, type BizState, type PriceType, type Service, type Staff, type Variant,
} from './state.ts';

type Dispatch = (a: BizAction) => void;
const patch = (dispatch: Dispatch, p: Partial<BizState>) => dispatch({ type: 'patch', patch: p });
const STATUS: Readonly<Record<AppointmentStatus, { readonly label: string; readonly hue: 'gray' | 'blue' | 'green' | 'orange' | 'red' }>> = {
  booked: { label: 'Booked', hue: 'gray' }, arrived: { label: 'Arrived', hue: 'blue' }, done: { label: 'Done', hue: 'green' }, 'no-show': { label: 'No-show', hue: 'orange' }, cancelled: { label: 'Cancelled', hue: 'red' },
};

/* ------------------------------------------------------------------ Calendar */

/** The day's appointments, one column a person; drag empty time to book, click one to open it. */
export function CalendarTab({ state, dispatch, onOpen }: { readonly state: BizState; readonly dispatch: Dispatch; readonly onOpen: (id: string) => void }) {
  const now = new Date();
  const [offset, setOffset] = useState(0);
  const [booking, setBooking] = useState<{ readonly staffId: string; readonly start: number } | 'blank'>();
  const day = dayFrom(now, offset);
  const people = state.staff.filter((p) => !p.archived);
  const todays = state.appointments.filter((a) => a.status !== 'cancelled' && sameDay(a.start, day));
  const events: WeekEvent[] = todays.flatMap((a) => {
    const col = people.findIndex((p) => p.id === a.staffId);
    const svc = serviceById(state, a.serviceId);
    return col < 0 ? [] : [{ id: a.id, title: `${a.client.name} · ${svc?.name ?? ''}`, day: col, start: minutesOf(a.start), end: minutesOf(a.end), kind: a.status === 'done' || a.status === 'no-show' ? 'internal' as const : 'meeting' as const, location: STATUS[a.status].label }];
  });
  // Time someone isn't working shows hatched, so the free time reads at a glance.
  const busy: WeekBusy[] = people.flatMap((p, col) => {
    const d = p.week[dayKey(day)];
    if (!d.on) return [{ id: `${p.id}-off`, day: col, start: 9 * 60, end: 21 * 60, source: 'Not working' }];
    const out: WeekBusy[] = [];
    let from = 9 * 60;
    d.ranges.forEach((r) => { if (r.start > from) out.push({ id: `${p.id}-${from}`, day: col, start: from, end: r.start, source: 'Not working' }); from = r.end; });
    if (from < 21 * 60) out.push({ id: `${p.id}-${from}`, day: col, start: from, end: 21 * 60, source: 'Not working' });
    return out;
  });
  const takings = todays.filter((a) => a.status !== 'no-show').reduce((t, a) => t + (variantOf(serviceById(state, a.serviceId), a.variantId)?.price ?? 0), 0);
  return (
    <div className="tf-bkf__meetings" data-view="week">
      <div className="tf-bkf__stack tf-bkf__stack--12 tf-bkf__calfill">
        <TabToolbar
          start={<span className="tf-bkf__weeknav">
            <IconButton size="sm" label="Previous day" onPress={() => setOffset(offset - 1)}><ChevronLeft {...i16} /></IconButton>
            <span className="tf-num" aria-live="polite">{offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatLongDay(day).split(' ')[0]}, {formatDay(day)}</span>
            <IconButton size="sm" label="Next day" onPress={() => setOffset(offset + 1)}><ChevronRight {...i16} /></IconButton>
            {offset !== 0 && <Button size="sm" variant="ghost" onPress={() => setOffset(0)}>Today</Button>}
          </span>}
          count={`${plural(todays.length, 'appointment')} · ${rupees(takings)}`}
          action={<Button variant="primary" icon={<CalendarPlus {...i14} />} onPress={() => setBooking('blank')}>New appointment</Button>} />
        <div className="tf-bzf-cal">
          <WeekCalendar startHour={9} endHour={21} days={people.map((p, i) => ({ weekday: first(p.name), date: i + 1, label: `${p.name}, ${p.title}`, isToday: false }))}
            events={events} busy={busy} now={offset === 0 ? { day: -1, minutes: minutesOf(now) } : undefined}
            onReschedule={(e) => onOpen(e.id)}
            selectionMenu={(sel, close) => {
              const p = people[sel.day];
              if (!p) return null;
              return (
                <div className="tf-bkf-pickmenu">
                  <div className="tf-bkf-pickmenu__head"><span className="tf-bkf-pickmenu__time tf-num">{formatClock(sel.start)}</span><span className="tf-bkf-pickmenu__sub">{first(p.name)} · {formatDay(day)}</span></div>
                  <Button variant="primary" icon={<CalendarPlus {...i14} />} onPress={() => { close(); setBooking({ staffId: p.id, start: sel.start }); }}>New appointment</Button>
                </div>
              );
            }} />
        </div>
      </div>
      {booking && <NewAppointmentDialog state={state} day={day} preset={booking === 'blank' ? undefined : booking} onClose={() => setBooking(undefined)}
        onBook={(a) => { patch(dispatch, { appointments: [...state.appointments, a] }); setBooking(undefined); }} />}
    </div>
  );
}

/** A new appointment, as the front desk books it: service, who, when, and the client. Times are only ones that are free. */
function NewAppointmentDialog({ state, day, preset, onClose, onBook }: { readonly state: BizState; readonly day: Date; readonly preset?: { readonly staffId: string; readonly start: number }; readonly onClose: () => void; readonly onBook: (a: Appointment) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const live = state.services.filter((x) => !x.archived);
  const presetPerson = preset ? staffById(state, preset.staffId) : undefined;
  const [serviceId, setServiceId] = useState(live.find((x) => !presetPerson || canDo(presetPerson, x))?.id ?? '');
  const svc = serviceById(state, serviceId);
  const [variantId, setVariantId] = useState(svc?.variants[0]?.id ?? '');
  const variant = variantOf(svc, variantId);
  const [staffId, setStaffId] = useState(preset?.staffId ?? 'any');
  const [dayId, setDayId] = useState(isoDay(day));
  const pickDay = Array.from({ length: 14 }, (_, n) => dayFrom(now, n)).find((d) => isoDay(d) === dayId) ?? day;
  const times = useMemo(() => (svc && variant ? serviceSlots(state, svc, variant, staffId, pickDay, new Date(0)) : []), [state, svc, variant, staffId, pickDay]);
  const [time, setTime] = useState<number | undefined>(preset?.start);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const ok = svc && variant && time !== undefined && times.includes(time) && name.trim();
  const book = () => {
    if (!svc || !variant || time === undefined) return;
    const who = staffId === 'any' ? pickAny(state, svc, pickDay, time, time + variant.minutes)?.id : staffId;
    if (!who) return;
    onBook({ id: nextId('a'), serviceId: svc.id, variantId: variant.id, staffId: who, start: at(pickDay, time), end: at(pickDay, time + variant.minutes), client: { name: name.trim(), phone: phone.trim(), email: '' }, status: 'booked', source: 'phone' });
    toast({ message: `${first(name)} booked with ${first(staffById(state, who)?.name ?? '')}, ${formatDay(pickDay)} at ${formatClock(time)}`, tone: 'success' });
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="New appointment" size="md"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ok} onPress={book}>Book</Button></>}>
      <div className="tf-bkf__stack">
        <Select label="Service" value={serviceId || null} onChange={(v) => { if (v) { setServiceId(v); setVariantId(serviceById(state, v)?.variants[0]?.id ?? ''); setTime(undefined); } }}
          items={live.map((x) => ({ id: x.id, label: x.name, description: `${lengthText(x.variants[0]?.minutes ?? 0)} · ${priceText(x.variants[0] ?? { id: '', name: '', minutes: 0, price: 0, priceType: 'free' })}` }))} />
        {svc && svc.variants.length > 1 && <ChoiceChips label="Option" selectionMode="single" size="sm" selectedKeys={[variantId]} onSelectionChange={(k) => { const v = [...k][0]; if (v) { setVariantId(v); setTime(undefined); } }}
          items={svc.variants.map((v) => ({ id: v.id, label: `${v.name} · ${lengthText(v.minutes)}` }))} />}
        <div className="tf-bkf__pair">
          <Select label="With" value={staffId} onChange={(v) => { if (v) { setStaffId(v); setTime(undefined); } }}
            items={[{ id: 'any', label: 'Anyone free' }, ...(svc ? doers(state, svc) : []).map((p) => ({ id: p.id, label: p.name, icon: <Avatar name={p.name} size={20} /> }))]} />
          <Select label="Day" value={dayId} onChange={(v) => { if (v) { setDayId(v); setTime(undefined); } }}
            items={Array.from({ length: 14 }, (_, n) => dayFrom(now, n)).map((d, n) => ({ id: isoDay(d), label: n === 0 ? `Today, ${formatDay(d)}` : n === 1 ? `Tomorrow, ${formatDay(d)}` : formatDay(d) }))} />
        </div>
        {times.length === 0 ? <p className="tf-bkf__muted">No free times that day for this. Try another day or person.</p> : (
          <ChoiceChips label="Time" selectionMode="single" size="sm" selectedKeys={time !== undefined && times.includes(time) ? [String(time)] : []} onSelectionChange={(k) => { const v = [...k][0]; setTime(v === undefined ? undefined : Number(v)); }}
            items={times.filter((m) => m % 30 === 0 || times.length < 16).slice(0, 24).map((m) => ({ id: String(m), label: formatClock(m) }))} />
        )}
        <div className="tf-bkf__pair">
          <TextField label="Client name" value={name} onChange={setName} isRequired />
          <TextField label="Phone" aside="Optional" type="tel" value={phone} onChange={setPhone} />
        </div>
      </div>
    </Dialog>
  );
}

/** One appointment: who, what, when; mark arrived, done or no-show; move or cancel. Cancel asks first. */
export function AppointmentDrawer({ state, dispatch, id, onClose }: { readonly state: BizState; readonly dispatch: Dispatch; readonly id: string | undefined; readonly onClose: () => void }) {
  const { toast } = useToast();
  const [cancelling, setCancelling] = useState(false);
  const a = state.appointments.find((x) => x.id === id);
  const svc = a ? serviceById(state, a.serviceId) : undefined;
  const person = a ? staffById(state, a.staffId) : undefined;
  const set = (status: AppointmentStatus) => {
    if (!a) return;
    const before = a;
    patch(dispatch, { appointments: state.appointments.map((x) => (x.id === a.id ? { ...x, status } : x)) });
    toast({ message: `${first(a.client.name)}: ${STATUS[status].label.toLowerCase()}`, action: { label: 'Undo', onAction: () => patch(dispatch, { appointments: state.appointments.map((x) => (x.id === before.id ? before : x)) }) } });
  };
  const past = a ? a.start.getTime() <= Date.now() : false;
  return (
    <>
      <Drawer isOpen={a !== undefined} onOpenChange={(o) => { if (!o) onClose(); }} title={a?.client.name ?? ''} subtitle={a ? `${svc?.name ?? ''} · ${formatDay(a.start)}, ${formatClockRange(minutesOf(a.start), minutesOf(a.end))}` : undefined}
        leading={a ? <Avatar name={a.client.name} size={32} /> : undefined}>
        {a && (
          <div className="tf-bkf-cards">
            <Section className="tf-bkf-card" title="Appointment" action={<Tag size="sm" hue={STATUS[a.status].hue}>{STATUS[a.status].label}</Tag>}>
              <dl className="tf-bzf-facts">
                <dt>Service</dt><dd>{svc?.name}{svc && svc.variants.length > 1 ? ` · ${variantOf(svc, a.variantId)?.name}` : ''}</dd>
                <dt>With</dt><dd className="tf-bzf-who"><Avatar name={person?.name ?? ''} size={20} />{person?.name}</dd>
                <dt>When</dt><dd className="tf-num">{formatLongDay(a.start)}, {formatClockRange(minutesOf(a.start), minutesOf(a.end))}</dd>
                <dt>Price</dt><dd>{priceText(variantOf(svc, a.variantId) ?? { id: '', name: '', minutes: 0, price: 0, priceType: 'free' })}</dd>
                <dt>Phone</dt><dd className="tf-num">{a.client.phone || 'Not given'}</dd>
                <dt>Booked</dt><dd>{a.source === 'online' ? 'Online' : a.source === 'walk-in' ? 'Walk-in' : 'By phone'}</dd>
              </dl>
            </Section>
            {a.status !== 'cancelled' && (
              <div className="tf-row">
                {a.status === 'booked' && <Button variant="primary" onPress={() => set('arrived')}>Arrived</Button>}
                {a.status === 'arrived' && <Button variant="primary" onPress={() => set('done')}>Done</Button>}
                {past && a.status === 'booked' && <Button variant="secondary" onPress={() => set('no-show')}>No-show</Button>}
                {(a.status === 'booked' || a.status === 'arrived') && <Button variant="ghost" onPress={() => setCancelling(true)}>Cancel appointment</Button>}
              </div>
            )}
          </div>
        )}
      </Drawer>
      <ConfirmDialog isOpen={cancelling} onOpenChange={setCancelling} title="Cancel this appointment?" consequence={a ? `${first(a.client.name)} is told by text. The time opens up for others.` : ''}
        confirmLabel="Cancel appointment" cancelLabel="Keep it" onConfirm={() => { set('cancelled'); setCancelling(false); onClose(); }} />
    </>
  );
}

/* ------------------------------------------------------------------ Services */

/** The menu, by category: each service with its length, price, who does it, and whether guests can book it online. */
export function ServicesTab({ state, dispatch }: { readonly state: BizState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const [open, setOpen] = useState<string | 'new'>();
  const live = state.services.filter((x) => !x.archived);
  const archived = state.services.filter((x) => x.archived);
  const setOnline = (svc: Service, online: boolean) => patch(dispatch, { services: state.services.map((x) => (x.id === svc.id ? { ...x, online } : x)) });
  if (live.length === 0 && archived.length === 0) {
    return <EmptyState icon={<Scissors size={20} strokeWidth={1.75} />} title="No services yet" description="Add what you offer, with its length and price. Guests book from this list."
      action={<Button variant="primary" icon={<Plus {...i14} />} onPress={() => setOpen('new')}>Add a service</Button>} />;
  }
  return (
    <div className="tf-bkf__tab">
      <TabToolbar count={`${plural(live.length, 'service')} · ${live.filter((x) => x.online).length} online`} action={<Button variant="primary" icon={<Plus {...i14} />} onPress={() => setOpen('new')}>New service</Button>} />
      <div className="tf-bkf-cards">
        {state.categories.map((c) => {
          const rows = live.filter((x) => x.categoryId === c.id);
          if (rows.length === 0) return null;
          return (
            <Section key={c.id} className="tf-bkf-card" title={c.name} description={plural(rows.length, 'service')}>
              <ul className="tf-bzf-list" aria-label={c.name}>
                {rows.map((svc) => {
                  const people = doers(state, svc);
                  const v0 = svc.variants[0];
                  return (
                    <li key={svc.id} className="tf-bzf-row">
                      <AriaButton className="tf-bzf-row__open" onPress={() => setOpen(svc.id)} aria-label={`Edit ${svc.name}`}>
                        <span className="tf-bzf-row__name">{svc.name}</span>
                        <span className="tf-bzf-row__sub tf-num">{svc.variants.length > 1 ? `${svc.variants.length} options · ` : ''}{lengthText(v0?.minutes ?? 0)}</span>
                      </AriaButton>
                      <span className="tf-bzf-row__price tf-num">{v0 ? priceText(v0) : ''}</span>
                      <span className="tf-bzf-row__who">{people.length === 0 ? <Tag size="sm" hue="orange">No one</Tag> : <AvatarGroup names={people.map((p) => p.name)} size={20} max={3} />}</span>
                      <Switch isSelected={svc.online} onChange={(on) => { setOnline(svc, on); toast({ message: on ? `${svc.name} is bookable online` : `${svc.name} is off the page` }); }} aria-label={`${svc.name} bookable online`}>
                        <span className="tf-bkf__onword">{svc.online ? 'Online' : 'Off'}</span>
                      </Switch>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}
        {archived.length > 0 && (
          <ShowMore showLabel={`Archived (${archived.length})`} hideLabel="Hide archived">
            <ul className="tf-bzf-list">
              {archived.map((svc) => (
                <li key={svc.id} className="tf-bzf-row is-archived">
                  <span className="tf-bzf-row__name">{svc.name}</span><span /><span />
                  <Button size="sm" variant="ghost" onPress={() => patch(dispatch, { services: state.services.map((x) => (x.id === svc.id ? { ...x, archived: false } : x)) })}>Restore</Button>
                </li>
              ))}
            </ul>
          </ShowMore>
        )}
      </div>
      {open && <ServiceDrawer state={state} service={open === 'new' ? undefined : serviceById(state, open)} onClose={() => setOpen(undefined)}
        onSave={(svc) => {
          const exists = state.services.some((x) => x.id === svc.id);
          patch(dispatch, { services: exists ? state.services.map((x) => (x.id === svc.id ? svc : x)) : [...state.services, svc] });
          setOpen(undefined);
          toast({ message: exists ? `${svc.name} saved` : `${svc.name} added`, tone: 'success' });
        }}
        onArchive={(svc) => {
          // Services with appointments ahead are archived, never deleted, so history stays whole.
          patch(dispatch, { services: state.services.map((x) => (x.id === svc.id ? { ...x, archived: true, online: false } : x)) });
          setOpen(undefined);
          toast({ message: `${svc.name} archived`, action: { label: 'Undo', onAction: () => patch(dispatch, { services: state.services }) } });
        }} />}
    </div>
  );
}

const PRICE_TYPES: ReadonlyArray<{ readonly id: PriceType; readonly label: string }> = [{ id: 'fixed', label: 'Fixed' }, { id: 'from', label: 'From' }, { id: 'free', label: 'Free' }, { id: 'request', label: 'On request' }];

/** Add or edit a service: name, category, its options (length and price), who does it. Clean-up time and the note sit under More options. */
function ServiceDrawer({ state, service, onClose, onSave, onArchive }: { readonly state: BizState; readonly service: Service | undefined; readonly onClose: () => void; readonly onSave: (s: Service) => void; readonly onArchive: (s: Service) => void }) {
  const blank: Service = { id: nextId('s'), categoryId: state.categories[0]?.id ?? 'c-other', name: '', description: '', variants: [{ id: nextId('v'), name: '', minutes: 30, price: 0, priceType: 'fixed' }], staff: 'all', bufferAfter: 0, online: true };
  const [draft, setDraft] = useState<Service>(service ?? blank);
  const set = (p: Partial<Service>) => setDraft((d) => ({ ...d, ...p }));
  const setVariant = (id: string, p: Partial<Variant>) => set({ variants: draft.variants.map((v) => (v.id === id ? { ...v, ...p } : v)) });
  const dirty = JSON.stringify(draft) !== JSON.stringify(service ?? blank);
  const upcoming = service ? state.appointments.filter((a) => a.serviceId === service.id && a.status === 'booked' && a.start > new Date()).length : 0;
  const people = state.staff.filter((p) => !p.archived);
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={service ? service.name : 'New service'} saveState={dirty ? 'dirty' : 'idle'} saveLabel={service ? 'Save' : 'Add service'}
      onSave={() => { if (draft.name.trim()) onSave({ ...draft, name: draft.name.trim() }); }} onDiscard={onClose}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} isRequired isInvalid={dirty && !draft.name.trim()} errorMessage="Give it a name." autoFocus={!service} />
        <Select label="Category" value={draft.categoryId} onChange={(v) => { if (v) set({ categoryId: v }); }} items={state.categories.map((c) => ({ id: c.id, label: c.name }))} />
        <TextArea label="Description" aside="Optional" rows={2} value={draft.description} onChange={(description) => set({ description })} placeholder="What it includes, in a line" />
        <div className="tf-bzf-variants">
          <span className="tf-bkf__label">{draft.variants.length > 1 ? 'Options' : 'Length and price'}</span>
          {draft.variants.map((v) => (
            <div key={v.id} className="tf-bzf-variant">
              {draft.variants.length > 1 && <TextField label="Option" isLabelHidden value={v.name} onChange={(name) => setVariant(v.id, { name })} placeholder="Long hair" />}
              <Select label="Length" isLabelHidden value={String(v.minutes)} onChange={(m) => setVariant(v.id, { minutes: Number(m ?? 30) })}
                items={[15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240].map((m) => ({ id: String(m), label: lengthText(m) }))} />
              <Select label="Price type" isLabelHidden value={v.priceType} onChange={(t) => setVariant(v.id, { priceType: (t ?? 'fixed') as PriceType })} items={PRICE_TYPES} />
              {(v.priceType === 'fixed' || v.priceType === 'from') && <NumberField aria-label="Price" value={v.price} minValue={0} step={50} showSteppers={false} formatOptions={{ style: 'currency', currency: 'INR', maximumFractionDigits: 0 }} onChange={(n) => setVariant(v.id, { price: Number.isFinite(n) ? n : 0 })} />}
              {draft.variants.length > 1 && <IconButton size="sm" label="Remove option" onPress={() => set({ variants: draft.variants.filter((x) => x.id !== v.id) })}><Trash2 {...i14} /></IconButton>}
            </div>
          ))}
          {draft.variants.length < 8 && <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => set({ variants: [...draft.variants, { id: nextId('v'), name: '', minutes: draft.variants[0]?.minutes ?? 30, price: draft.variants[0]?.price ?? 0, priceType: 'fixed' }] })}>Add an option</Button>}
        </div>
        <ChoiceChips label="Who does it" selectionMode="multiple" size="sm" selectedKeys={draft.staff === 'all' ? people.map((p) => p.id) : draft.staff}
          onSelectionChange={(k) => set({ staff: k.size === people.length ? 'all' : [...k] })}
          items={people.map((p) => ({ id: p.id, label: first(p.name) }))} />
        <Switch isSelected={draft.online} onChange={(online) => set({ online })}>Guests can book it online</Switch>
        <ShowMore showLabel="More options" hideLabel="Fewer options">
          <div className="tf-bkf-settings">
            <SettingRow title="Clean-up after" description="Kept free after each one.">
              <Select label="Clean-up after" isLabelHidden className="tf-bkf__inline-select" value={String(draft.bufferAfter)} onChange={(v) => set({ bufferAfter: Number(v ?? 0) })}
                items={[0, 5, 10, 15, 30, 45, 60].map((m) => ({ id: String(m), label: m ? `${m} min` : 'None' }))} />
            </SettingRow>
            {service && (
              <SettingRow title="Archive" description={upcoming ? `${plural(upcoming, 'appointment')} ahead stay booked.` : 'It comes off the menu; past appointments keep it.'}>
                <Button size="sm" variant="ghost" onPress={() => onArchive(service)}>Archive</Button>
              </SettingRow>
            )}
          </div>
        </ShowMore>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ Team */

/** The people guests book with: title, what they do, and their usual week. */
export function TeamTab({ state, dispatch }: { readonly state: BizState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const people = state.staff.filter((p) => !p.archived);
  const today = new Date();
  return (
    <div className="tf-bkf__tab">
      <TabToolbar count={plural(people.length, 'person', 'people')} action={<Button variant="primary" icon={<UserPlus {...i14} />} onPress={() => { setName(''); setTitle(''); setAdding(true); }}>Add someone</Button>} />
      <div className="tf-bkf-card">
        <ul className="tf-bzf-list" aria-label="Team">
          {people.map((p) => {
            const d = p.week[dayKey(today)];
            const services = state.services.filter((x) => !x.archived && canDo(p, x)).length;
            return (
              <li key={p.id} className="tf-bzf-row tf-bzf-row--person">
                <AriaButton className="tf-bzf-row__open tf-bzf-row__open--person" onPress={() => setOpen(p.id)} aria-label={`Open ${p.name}`}>
                  <Avatar name={p.name} size={32} />
                  <span className="tf-bzf-row__text"><span className="tf-bzf-row__name">{p.name}</span><span className="tf-bzf-row__sub">{p.title} · {plural(services, 'service')}</span></span>
                </AriaButton>
                <span className="tf-bzf-row__sub tf-num">{d.on ? `Today ${d.ranges.map((r) => formatClockRange(r.start, r.end)).join(', ')}` : 'Off today'}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {open && <StaffDrawer state={state} person={staffById(state, open)} onClose={() => setOpen(undefined)}
        onSave={(p) => { patch(dispatch, { staff: state.staff.map((x) => (x.id === p.id ? p : x)) }); setOpen(undefined); toast({ message: `${first(p.name)} saved`, tone: 'success' }); }}
        onArchive={(p) => { patch(dispatch, { staff: state.staff.map((x) => (x.id === p.id ? { ...x, archived: true } : x)) }); setOpen(undefined); toast({ message: `${first(p.name)} archived`, action: { label: 'Undo', onAction: () => patch(dispatch, { staff: state.staff }) } }); }} />}
      <Dialog isOpen={adding} onOpenChange={setAdding} title="Add someone" description="They start on your opening hours, doing every service. Change that on their profile."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => {
          const p: Staff = { id: nextId('p'), name: name.trim(), title: title.trim() || 'Stylist', week: state.business.hours, services: 'all' };
          patch(dispatch, { staff: [...state.staff, p] }); setAdding(false); setOpen(p.id);
        }}>Add</Button></>}>
        <div className="tf-bkf__stack">
          <TextField label="Name" value={name} onChange={setName} isRequired autoFocus />
          <TextField label="Title" aside="Optional" value={title} onChange={setTitle} placeholder="Stylist" />
        </div>
      </Dialog>
    </div>
  );
}

/** One person: title, the services they do, their usual week. Archive sits under More options and waits while appointments are ahead. */
function StaffDrawer({ state, person, onClose, onSave, onArchive }: { readonly state: BizState; readonly person: Staff | undefined; readonly onClose: () => void; readonly onSave: (p: Staff) => void; readonly onArchive: (p: Staff) => void }) {
  const [draft, setDraft] = useState<Staff | undefined>(person);
  if (!person || !draft) return null;
  const set = (p: Partial<Staff>) => setDraft({ ...draft, ...p });
  const live = state.services.filter((x) => !x.archived && (x.staff === 'all' || x.staff.includes(person.id)));
  const ahead = state.appointments.filter((a) => a.staffId === person.id && a.status === 'booked' && a.start > new Date()).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(person);
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={person.name} subtitle={`${person.title} · ${summarizeHours(draft.week)}`} leading={<Avatar name={person.name} size={32} />} width="lg"
      saveState={dirty ? 'dirty' : 'idle'} onSave={() => onSave(draft)} onDiscard={onClose}>
      <div className="tf-bkf-cards">
        <Section className="tf-bkf-card" title="Profile">
          <div className="tf-bkf__stack">
            <div className="tf-bkf__pair">
              <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} />
              <TextField label="Title" value={draft.title} onChange={(title) => set({ title })} />
            </div>
            <ChoiceChips label="Services" selectionMode="multiple" size="sm" selectedKeys={draft.services === 'all' ? live.map((x) => x.id) : draft.services}
              onSelectionChange={(k) => set({ services: k.size === live.length ? 'all' : [...k] })} items={live.map((x) => ({ id: x.id, label: x.name }))} />
          </div>
        </Section>
        <Section className="tf-bkf-card" title="Usual week" description="When guests can book them. Never outside your opening hours.">
          <HoursEditor value={draft.week} onChange={(week) => set({ week })} />
          <Button size="sm" variant="ghost" onPress={() => set({ week: state.business.hours })}>Same as opening hours</Button>
        </Section>
        <ShowMore showLabel="More options" hideLabel="Fewer options">
          <div className="tf-bkf-settings">
            <SettingRow title="Archive" description={ahead ? `Not yet: ${plural(ahead, 'appointment')} ahead. Move them first.` : 'They come off the page; past appointments keep them.'}>
              <Button size="sm" variant="ghost" isDisabled={ahead > 0} onPress={() => onArchive(person)}>Archive</Button>
            </SettingRow>
          </div>
        </ShowMore>
      </div>
    </Drawer>
  );
}

/** Kept for symmetry with Bookings: a full week of 9 to 5, used by a blank person. */
export const defaultWeek = () => weekdays(10, 19, 'n');
