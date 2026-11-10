// Restaurant: the day's reservations (a list or the floor), walk-ins and new bookings, the tables, and the online booking rules.
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CalendarPlus, ChevronLeft, ChevronRight, DoorOpen, LayoutGrid, List, Plus, Settings2, Users } from 'lucide-react';
import { formatClock } from '../WeekCalendar/clock.ts';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { cx } from '../../lib/cx.ts';
import { formatDay } from '../../lib/format.ts';
import { Section, SettingRow, TabToolbar, i14, i16 } from '../BookingsFlow/parts.tsx';
import {
  at, dayFrom, dayKey, first, fitTables, isoDay, minutesOf, nextId, plural, sameDay, tableNames,
  type BizAction, type BizState, type OnlineRules, type Reservation, type ReservationStatus, type Table,
} from './state.ts';

type Dispatch = (a: BizAction) => void;
const patch = (dispatch: Dispatch, p: Partial<BizState>) => dispatch({ type: 'patch', patch: p });
const STATUS: Readonly<Record<ReservationStatus, { readonly label: string; readonly hue: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple' }>> = {
  booked: { label: 'Booked', hue: 'gray' }, confirmed: { label: 'Confirmed', hue: 'blue' }, seated: { label: 'Seated', hue: 'green' }, finished: { label: 'Finished', hue: 'gray' }, 'no-show': { label: 'No-show', hue: 'orange' }, cancelled: { label: 'Cancelled', hue: 'red' },
};
/** The one next step for a reservation, as its main button. */
const NEXT: Partial<Record<ReservationStatus, { readonly to: ReservationStatus; readonly label: string }>> = { booked: { to: 'confirmed', label: 'Confirm' }, confirmed: { to: 'seated', label: 'Seat' }, seated: { to: 'finished', label: 'Finish' } };

/** The day's book: times with their guests, party sizes and tables; one tap moves a reservation on (confirm, seat, finish). Or the floor, table by table. */
export function ReservationsTab({ state, dispatch }: { readonly state: BizState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const now = new Date();
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'list' | 'floor'>('list');
  const [creating, setCreating] = useState<'new' | 'walkin'>();
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string>();
  const day = dayFrom(now, offset);
  const today = state.reservations.filter((r) => sameDay(r.start, day)).sort((a, b) => a.start.getTime() - b.start.getTime());
  const live = today.filter((r) => r.status !== 'cancelled' && r.status !== 'no-show');
  const covers = live.reduce((t, r) => t + r.party, 0);
  const move = (r: Reservation, to: ReservationStatus) => {
    const before = state.reservations;
    patch(dispatch, { reservations: state.reservations.map((x) => (x.id === r.id ? { ...x, status: to, seatedAt: to === 'seated' ? new Date() : x.seatedAt } : x)) });
    toast({ message: `${first(r.guest.name)}, party of ${r.party}: ${STATUS[to].label.toLowerCase()}`, action: { label: 'Undo', onAction: () => patch(dispatch, { reservations: before }) } });
  };
  const toCancel = state.reservations.find((r) => r.id === cancelId);
  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<>
          <span className="tf-bkf__weeknav">
            <IconButton size="sm" label="Previous day" onPress={() => setOffset(offset - 1)}><ChevronLeft {...i16} /></IconButton>
            <span className="tf-num" aria-live="polite">{offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatDay(day)}{offset < 2 ? `, ${formatDay(day)}` : ''}</span>
            <IconButton size="sm" label="Next day" onPress={() => setOffset(offset + 1)}><ChevronRight {...i16} /></IconButton>
            {offset !== 0 && <Button size="sm" variant="ghost" onPress={() => setOffset(0)}>Today</Button>}
          </span>
          <SegmentedControl aria-label="View" selectedKey={view} onSelectionChange={(k) => setView(k === 'floor' ? 'floor' : 'list')}
            items={[{ id: 'list', label: 'List', icon: <List {...i14} /> }, { id: 'floor', label: 'Floor', icon: <LayoutGrid {...i14} /> }]} />
        </>}
        count={`${plural(live.length, 'booking')} · ${plural(covers, 'cover')}`}
        action={<span className="tf-row">
          <IconButton label="Online booking" onPress={() => setOnlineOpen(true)}><Settings2 {...i16} /></IconButton>
          {offset === 0 && <Button variant="secondary" icon={<DoorOpen {...i14} />} onPress={() => setCreating('walkin')}>Walk in</Button>}
          <Button variant="primary" icon={<CalendarPlus {...i14} />} onPress={() => setCreating('new')}>New booking</Button>
        </span>} />
      {view === 'list' ? (
        today.length === 0 ? <EmptyState icon={<Users size={20} strokeWidth={1.75} />} title="No bookings this day" description="Bookings from your page, the phone and walk-ins show here." /> : (
          <ul className="tf-bzf-book" aria-label="Bookings">
            {today.map((r) => {
              const next = NEXT[r.status];
              const late = r.status === 'confirmed' || r.status === 'booked' ? sameDay(r.start, now) && now.getTime() - r.start.getTime() > 15 * 60_000 : false;
              return (
                <li key={r.id} className={cx('tf-bzf-res', (r.status === 'cancelled' || r.status === 'no-show' || r.status === 'finished') && 'is-done')}>
                  <span className="tf-bzf-res__time tf-num">{formatClock(minutesOf(r.start))}</span>
                  <span className="tf-bzf-res__who">
                    <span className="tf-bzf-res__name">{r.guest.name}{r.occasion && <Tag size="sm" hue="purple">{r.occasion}</Tag>}{late && <Tag size="sm" hue="orange">15 min late</Tag>}</span>
                    <span className="tf-bzf-res__sub tf-num">{r.guest.phone}{r.note ? ` · ${r.note}` : ''}</span>
                  </span>
                  <span className="tf-bzf-res__party tf-num"><Users {...i14} aria-hidden="true" />{r.party}</span>
                  <span className="tf-bzf-res__table tf-num">{r.tables.length ? tableNames(state, r.tables) : 'No table'}</span>
                  <span className="tf-bzf-res__status"><Tag size="sm" hue={STATUS[r.status].hue}>{STATUS[r.status].label}</Tag></span>
                  <span className="tf-bzf-res__act">
                    {next && <Button size="sm" variant={r.status === 'confirmed' ? 'primary' : 'secondary'} onPress={() => move(r, next.to)}>{next.label}</Button>}
                    {(r.status === 'booked' || r.status === 'confirmed') && <Button size="sm" variant="ghost" onPress={() => setCancelId(r.id)}>Cancel</Button>}
                    {late && <Button size="sm" variant="ghost" onPress={() => move(r, 'no-show')}>No-show</Button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : <Floor state={state} day={day} now={now} />}
      {creating && <BookingDialog state={state} day={day} walkIn={creating === 'walkin'} onClose={() => setCreating(undefined)}
        onBook={(r) => {
          patch(dispatch, { reservations: [...state.reservations, r] });
          setCreating(undefined);
          toast({ message: r.source === 'walk-in' ? `Party of ${r.party} seated at ${tableNames(state, r.tables)}` : `${first(r.guest.name)}, party of ${r.party}, ${formatDay(r.start)} at ${formatClock(minutesOf(r.start))}`, tone: 'success' });
        }} />}
      {onlineOpen && <OnlineDrawer state={state} onClose={() => setOnlineOpen(false)} onSave={(online) => { patch(dispatch, { online }); setOnlineOpen(false); toast({ message: online.accept ? 'Online booking saved' : 'Online booking is off', tone: 'success' }); }} />}
      <ConfirmDialog isOpen={toCancel !== undefined} onOpenChange={(o) => { if (!o) setCancelId(undefined); }} title="Cancel this booking?" consequence={toCancel ? `${first(toCancel.guest.name)} is told by text. Their table frees up.` : ''}
        confirmLabel="Cancel booking" cancelLabel="Keep it" onConfirm={() => { if (toCancel) move(toCancel, 'cancelled'); setCancelId(undefined); }} />
    </div>
  );
}

/** The floor: tables by area, each free, booked soon (within the hour), or seated with how long they've sat. */
function Floor({ state, day, now }: { readonly state: BizState; readonly day: Date; readonly now: Date }) {
  const isToday = sameDay(day, now);
  const m = isToday ? minutesOf(now) : 19 * 60;
  return (
    <div className="tf-bkf-cards">
      {state.areas.map((area) => (
        <Section key={area.id} className="tf-bkf-card" title={area.name} description={plural(state.tables.filter((t) => t.areaId === area.id).length, 'table')}>
          <div className="tf-bzf-floor">
            {state.tables.filter((t) => t.areaId === area.id).map((t) => {
              const here = state.reservations.filter((r) => r.tables.includes(t.id) && sameDay(r.start, day) && (r.status === 'booked' || r.status === 'confirmed' || r.status === 'seated'));
              const seated = here.find((r) => r.status === 'seated');
              const soon = here.filter((r) => r.status !== 'seated').map((r) => minutesOf(r.start)).filter((x) => x >= m - 15).sort((a, b) => a - b)[0];
              const state0 = seated ? 'seated' : soon !== undefined && soon - m <= 60 ? 'soon' : 'free';
              return (
                <div key={t.id} className="tf-bzf-table" data-state={state0}>
                  <span className="tf-bzf-table__name">{t.name}</span>
                  <span className="tf-bzf-table__seats tf-num"><Users size={12} strokeWidth={1.75} aria-hidden="true" />{t.seats}</span>
                  <span className="tf-bzf-table__line tf-num">
                    {seated ? `${first(seated.guest.name)} · ${Math.max(0, Math.round((now.getTime() - (seated.seatedAt ?? seated.start).getTime()) / 60_000))} min` : soon !== undefined ? `Next ${formatClock(soon)}` : 'Free'}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

/** A booking from the phone (name, day, time, party, a table that fits), or a walk-in seated now at the best free table. */
function BookingDialog({ state, day, walkIn, onClose, onBook }: { readonly state: BizState; readonly day: Date; readonly walkIn: boolean; readonly onClose: () => void; readonly onBook: (r: Reservation) => void }) {
  const now = new Date();
  const [party, setParty] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [dayId, setDayId] = useState(isoDay(day));
  const [time, setTime] = useState(19 * 60);
  const pickDay = Array.from({ length: 30 }, (_, n) => dayFrom(now, n)).find((d) => isoDay(d) === dayId) ?? day;
  const start = walkIn ? Math.ceil(minutesOf(now) / 15) * 15 : time;
  const fit = fitTables(state, party, walkIn ? now : pickDay, start, false);
  const [tableId, setTableId] = useState<string>('best');
  const chosen = tableId === 'best' ? fit?.map((t) => t.id) : [tableId];
  const free = state.tables.filter((t) => t.seats >= party && fitTables({ ...state, tables: [t] }, party, walkIn ? now : pickDay, start, false) !== undefined);
  const hours = state.business.hours[dayKey(pickDay)];
  const times = hours.on ? hours.ranges.flatMap((r) => Array.from({ length: Math.max(0, Math.floor((r.end - 60 - r.start) / 30) + 1) }, (_, n) => r.start + n * 30)) : [];
  const ok = chosen && chosen.length > 0 && (walkIn || name.trim()) && (walkIn || times.includes(time));
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={walkIn ? 'Walk in' : 'New booking'} description={walkIn ? 'Seat a party now at a free table.' : undefined} size="md"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ok} onPress={() => {
        if (!chosen) return;
        onBook({ id: nextId('r'), start: at(walkIn ? now : pickDay, start), party, tables: chosen, guest: { name: name.trim() || 'Walk-in', phone: phone.trim(), email: '' }, note: note.trim(), status: walkIn ? 'seated' : 'confirmed', source: walkIn ? 'walk-in' : 'phone', seatedAt: walkIn ? now : undefined });
      }}>{walkIn ? 'Seat now' : 'Book'}</Button></>}>
      <div className="tf-bkf__stack">
        <ChoiceChips label="Party" selectionMode="single" size="sm" selectedKeys={[String(party)]} onSelectionChange={(k) => { const v = [...k][0]; if (v) { setParty(Number(v)); setTableId('best'); } }}
          items={[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => ({ id: String(n), label: String(n) }))} />
        {!walkIn && (
          <div className="tf-bkf__pair">
            <Select label="Day" value={dayId} onChange={(v) => { if (v) setDayId(v); }} items={Array.from({ length: 30 }, (_, n) => dayFrom(now, n)).map((d, n) => ({ id: isoDay(d), label: n === 0 ? `Today, ${formatDay(d)}` : n === 1 ? `Tomorrow, ${formatDay(d)}` : formatDay(d) }))} />
            <Select label="Time" value={String(time)} onChange={(v) => { if (v) setTime(Number(v)); }} items={(times.length ? times : [time]).map((m) => ({ id: String(m), label: formatClock(m), isDisabled: !times.includes(m) }))} />
          </div>
        )}
        {!hours.on && !walkIn ? <p className="tf-bkf__muted">You're closed that day.</p> : (
          <Select label="Table" value={tableId} onChange={(v) => setTableId(v ?? 'best')}
            items={[{ id: 'best', label: fit ? `Best fit · ${fit.map((t) => t.name).join(' + ')}` : 'Nothing free for that party', isDisabled: !fit }, ...free.map((t) => ({ id: t.id, label: `${t.name} · seats ${t.seats}` }))]} />
        )}
        {!walkIn && (
          <div className="tf-bkf__pair">
            <TextField label="Name" value={name} onChange={setName} isRequired />
            <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
          </div>
        )}
        {walkIn && <TextField label="Name" aside="Optional" value={name} onChange={setName} />}
        {!walkIn && <TextArea label="Note" aside="Optional" rows={2} value={note} onChange={setNote} placeholder="High chair, allergies, a quiet corner" />}
      </div>
    </Dialog>
  );
}

/** Online booking: on or off, how far ahead, party sizes; the finer rules sit under More options. */
function OnlineDrawer({ state, onClose, onSave }: { readonly state: BizState; readonly onClose: () => void; readonly onSave: (o: OnlineRules) => void }) {
  const [o, setO] = useState<OnlineRules>(state.online);
  const set = (p: Partial<OnlineRules>) => setO((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(o) !== JSON.stringify(state.online);
  const live = state.tables.filter((t) => t.online).length;
  return (
    <Drawer isOpen onOpenChange={(v) => { if (!v) onClose(); }} title="Online booking" subtitle={o.accept ? `Guests book at timefix.com/${state.business.handle}` : 'Guests can’t book online right now'} saveState={dirty ? 'dirty' : 'idle'} onSave={() => onSave(o)} onDiscard={onClose}>
      <div className="tf-bkf-settings">
        <SettingRow title="Take bookings online" description={live ? `${plural(live, 'table')} can be booked online.` : 'Put a table online first, under Tables.'}>
          <Switch aria-label="Take bookings online" isSelected={o.accept} onChange={(accept) => set({ accept })} />
        </SettingRow>
        <SettingRow title="How far ahead" description="The latest day guests can pick.">
          <Select label="How far ahead" isLabelHidden className="tf-bkf__inline-select" value={String(o.window)} onChange={(v) => set({ window: Number(v ?? 60) })} items={[14, 30, 60, 90].map((n) => ({ id: String(n), label: `${n} days` }))} />
        </SettingRow>
        <SettingRow title="Party size" description="Bigger parties are asked to call.">
          <span className="tf-bkf-setting__pair">
            <NumberField aria-label="Smallest party" value={o.partyMin} minValue={1} maxValue={o.partyMax} onChange={(n) => set({ partyMin: Number.isFinite(n) ? n : 1 })} />
            <NumberField aria-label="Largest party" value={o.partyMax} minValue={o.partyMin} maxValue={20} onChange={(n) => set({ partyMax: Number.isFinite(n) ? n : 8 })} />
          </span>
        </SettingRow>
      </div>
      <ShowMore showLabel="More options" hideLabel="Fewer options">
        <div className="tf-bkf-settings">
          <SettingRow title="Times every" description="How often a booking can start.">
            <Select label="Times every" isLabelHidden className="tf-bkf__inline-select" value={String(o.interval)} onChange={(v) => set({ interval: Number(v ?? 30) })} items={[15, 30, 60].map((n) => ({ id: String(n), label: `${n} min` }))} />
          </SettingRow>
          <SettingRow title="Table held for" description="How long a booking keeps its table.">
            <Select label="Table held for" isLabelHidden className="tf-bkf__inline-select" value={String(o.turn)} onChange={(v) => set({ turn: Number(v ?? 90) })} items={[60, 90, 120, 150].map((n) => ({ id: String(n), label: `${n} min` }))} />
          </SettingRow>
          <SettingRow title="Book at least" description="How soon before a time it can still be booked.">
            <Select label="Book at least" isLabelHidden className="tf-bkf__inline-select" value={String(o.lead)} onChange={(v) => set({ lead: Number(v ?? 120) })} items={[0, 30, 60, 120, 240].map((n) => ({ id: String(n), label: n ? `${n < 60 ? `${n} min` : `${n / 60} h`} before` : 'Any time' }))} />
          </SettingRow>
          <SettingRow title="Most guests a time" description="Caps covers starting together. Empty is no cap.">
            <NumberField aria-label="Most guests a time" showSteppers={false} value={o.maxCovers || Number.NaN} minValue={1} placeholder="No cap" onChange={(n) => set({ maxCovers: Number.isFinite(n) ? n : 0 })} />
          </SettingRow>
          <SettingRow title="Guests can change or cancel" description="After this, they're asked to call.">
            <Select label="Change cut-off" isLabelHidden className="tf-bkf__inline-select" value={String(o.cutoff)} onChange={(v) => set({ cutoff: Number(v ?? 2) })} items={[0, 1, 2, 4, 24].map((n) => ({ id: String(n), label: n ? `Until ${n} h before` : 'Up to the time' }))} />
          </SettingRow>
        </div>
      </ShowMore>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ Tables */

/** Tables by area: name, seats, online, and whether it joins its neighbours. Add several at once ("T10 to T14"). */
export function TablesTab({ state, dispatch }: { readonly state: BizState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState('');
  const [seats, setSeats] = useState(4);
  const [areaId, setAreaId] = useState(state.areas[0]?.id ?? '');
  const [edit, setEdit] = useState<string>();
  const setTable = (t: Table) => patch(dispatch, { tables: state.tables.map((x) => (x.id === t.id ? t : x)) });
  /** "T10 to T14" (or "T10-T14") makes five; a single name makes one. */
  const names = (() => {
    const m = range.trim().match(/^([A-Za-z]*)(\d+)\s*(?:to|-|–)\s*[A-Za-z]*(\d+)$/);
    if (m) { const [, p = '', a = '0', b = '0'] = m; const lo = Number(a); const hi = Math.min(Number(b), lo + 30); return hi >= lo ? Array.from({ length: hi - lo + 1 }, (_, n) => `${p}${lo + n}`) : []; }
    return range.trim() ? [range.trim()] : [];
  })();
  const editing = state.tables.find((t) => t.id === edit);
  return (
    <div className="tf-bkf__tab">
      <TabToolbar count={`${plural(state.tables.length, 'table')} · ${state.tables.reduce((t, x) => t + x.seats, 0)} seats`} action={<Button variant="primary" icon={<Plus {...i14} />} onPress={() => { setRange(''); setAdding(true); }}>Add tables</Button>} />
      <div className="tf-bkf-cards">
        {state.areas.map((area) => (
          <Section key={area.id} className="tf-bkf-card" title={area.name} description={plural(state.tables.filter((t) => t.areaId === area.id).length, 'table')}>
            <ul className="tf-bzf-list" aria-label={area.name}>
              {state.tables.filter((t) => t.areaId === area.id).map((t) => (
                <li key={t.id} className="tf-bzf-row tf-bzf-row--table">
                  <AriaButton className="tf-bzf-row__open" onPress={() => setEdit(t.id)} aria-label={`Edit ${t.name}`}>
                    <span className="tf-bzf-row__name">{t.name}</span>
                    <span className="tf-bzf-row__sub tf-num">Seats {t.seats}{t.joinable ? ' · joins neighbours' : ''}</span>
                  </AriaButton>
                  <Switch isSelected={t.online} onChange={(online) => setTable({ ...t, online })} aria-label={`${t.name} bookable online`}><span className="tf-bkf__onword">{t.online ? 'Online' : 'Staff only'}</span></Switch>
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </div>
      <Dialog isOpen={adding} onOpenChange={setAdding} title="Add tables" description="One name, or a run like T10 to T14."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={names.length === 0} onPress={() => {
          const made = names.map((n) => ({ id: nextId('t'), name: n, seats, areaId, online: true, joinable: false }));
          patch(dispatch, { tables: [...state.tables, ...made] }); setAdding(false); toast({ message: `${plural(made.length, 'table')} added`, tone: 'success' });
        }}>{names.length > 1 ? `Add ${names.length} tables` : 'Add table'}</Button></>}>
        <div className="tf-bkf__stack">
          <TextField label="Names" value={range} onChange={setRange} placeholder="T10 to T14" autoFocus description={names.length > 1 ? `${names[0]} … ${names[names.length - 1]}` : undefined} />
          <div className="tf-bkf__pair">
            <NumberField label="Seats each" value={seats} minValue={1} maxValue={20} onChange={(n) => setSeats(Number.isFinite(n) ? n : 2)} />
            <Select label="Area" value={areaId} onChange={(v) => setAreaId(v ?? '')} items={state.areas.map((a) => ({ id: a.id, label: a.name }))} />
          </div>
        </div>
      </Dialog>
      {editing && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setEdit(undefined); }} title={editing.name}
          actions={<Button variant="primary" slot="close">Done</Button>}>
          <div className="tf-bkf__stack">
            <div className="tf-bkf__pair">
              <TextField label="Name" value={editing.name} onChange={(name) => setTable({ ...editing, name })} />
              <NumberField label="Seats" value={editing.seats} minValue={1} maxValue={20} onChange={(n) => setTable({ ...editing, seats: Number.isFinite(n) ? n : editing.seats })} />
            </div>
            <Select label="Area" value={editing.areaId} onChange={(v) => { if (v) setTable({ ...editing, areaId: v }); }} items={state.areas.map((a) => ({ id: a.id, label: a.name }))} />
            <Switch isSelected={editing.joinable} onChange={(joinable) => setTable({ ...editing, joinable })}>Can join the next table for bigger parties</Switch>
          </div>
        </Dialog>
      )}
    </div>
  );
}

