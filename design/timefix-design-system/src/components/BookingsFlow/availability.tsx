// Availability: saved hours with the HoursEditor, time off, calendars and their health, and the team's week.
import { useEffect, useState, type CSSProperties } from 'react';
import { type Key } from 'react-aria-components';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { CalendarX2, MoreHorizontal, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { HoursEditor, summarizeHours, HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { DateRangePicker } from '../DatePicker/DatePicker.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { CalendarConnections, type CalendarProvider } from '../CalendarConnections/CalendarConnections.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDate, formatDay } from '../../lib/format.ts';
import { Section, TabToolbar, i14, i16 } from './parts.tsx';
import { weekdays } from './seed.ts';
import {
  HOST, TEAM, busyOn, dayFrom, first, isOff, isoDay, memberHours, mondayOf, nextId, parseDay, plural,
  type BookedMeeting, type BookingsAction, type BookingsState, type TimeOff,
} from './state.ts';

/** Props for AvailabilityTab. */
export interface AvailabilityTabProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  /** Hands meetings on during time off; returns how many found a new host. */
  readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>) => number;
}

/** The Availability tab. */
export function AvailabilityTab({ state, dispatch, onReassignMany }: AvailabilityTabProps) {
  const [current, setCurrent] = useState(state.defaultHoursId);
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (!state.savedHours.some((h) => h.id === current)) setCurrent(state.defaultHoursId); }, [state.savedHours, current, state.defaultHoursId]);
  const set = state.savedHours.find((h) => h.id === current) ?? state.savedHours[0];
  const today = isoDay(new Date());
  const soon = isoDay(dayFrom(new Date(), 14));
  const away = new Set(state.timeOff.filter((t) => t.to >= today && t.from <= soon).map((t) => t.member)).size;
  return (
    <div className="tf-bkf__tab">
      <TabToolbar start={set && <SavedHoursSwitch state={state} dispatch={dispatch} set={set} onPick={setCurrent} />}
        count={away ? `${away} away in the next two weeks` : 'No one away in the next two weeks'}
        action={<Button variant="primary" icon={<Plus {...i14} />} onPress={() => setAdding(true)}>Add time off</Button>} />
      <div className="tf-bkf__avail">
        <div className="tf-bkf-sections tf-bkf__avail-main">{set && <HoursSection state={state} dispatch={dispatch} set={set} />}</div>
        <div className="tf-bkf-sections tf-bkf__avail-side">
          <TimeOffSection state={state} dispatch={dispatch} onReassignMany={onReassignMany} adding={adding} onAddingChange={setAdding} />
          <CalendarsSection state={state} dispatch={dispatch} />
        </div>
        <div className="tf-bkf-sections tf-bkf__avail-wide"><TeamWeek state={state} /></div>
      </div>
    </div>
  );
}

type SavedSet = BookingsState['savedHours'][number];
const usedByOf = (state: BookingsState, set: SavedSet) => state.pages.filter((p) => p.hoursFrom === set.id || (p.hoursFrom === 'working' && set.id === state.defaultHoursId));

/** The hours being edited, and which pages use them. */
function HoursSection({ state, dispatch, set }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly set: SavedSet }) {
  const usedBy = usedByOf(state, set);
  return (
    <Section title={set.name} description={`${summarizeHours(set.hours)}, India time${set.id === state.defaultHoursId ? ' · your default' : ''}`}>
      <div className="tf-bkf__stack">
        <HoursEditor value={set.hours} onChange={(hours) => dispatch({ type: 'hours/set', id: set.id, hours })} />
        <p className="tf-bkf__muted">{usedBy.length ? `Used by ${usedBy.map((p) => p.name).join(', ')}.` : 'No page uses these yet. Pick them in a page’s When section.'}</p>
      </div>
    </Section>
  );
}

/** Saved sets of hours behind a switch, with New and a menu (rename, set as default, delete). */
function SavedHoursSwitch({ state, dispatch, set, onPick: setCurrent }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly set: SavedSet; readonly onPick: (id: string) => void }) {
  const { toast } = useToast();
  const [naming, setNaming] = useState<{ readonly id?: string; readonly name: string }>();
  const [deleting, setDeleting] = useState(false);
  const usedBy = usedByOf(state, set);
  const saveName = () => {
    if (!naming || !naming.name.trim()) return;
    if (naming.id) dispatch({ type: 'hours/saved', savedHours: state.savedHours.map((h) => (h.id === naming.id ? { ...h, name: naming.name.trim() } : h)), defaultHoursId: state.defaultHoursId });
    else {
      const id = nextId('hours');
      dispatch({ type: 'hours/saved', savedHours: [...state.savedHours, { id, name: naming.name.trim(), hours: weekdays(9, 17, id) }], defaultHoursId: state.defaultHoursId });
      setCurrent(id);
    }
    setNaming(undefined);
  };
  return (
    <>
          <SegmentedControl aria-label="Saved hours" selectedKey={set.id} onSelectionChange={setCurrent} items={state.savedHours.map((h) => ({ id: h.id, label: h.name }))} />
          <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => setNaming({ name: '' })}>New</Button>
        <MenuTrigger>
          <IconButton size="sm" label={`More for ${set.name}`}><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label={`${set.name} actions`} placement="bottom end" onAction={(k: Key) => {
            if (k === 'rename') setNaming({ id: set.id, name: set.name });
            else if (k === 'default') { dispatch({ type: 'hours/saved', savedHours: state.savedHours, defaultHoursId: set.id }); toast({ message: `${set.name} is your default now`, tone: 'success' }); }
            else if (k === 'delete') setDeleting(true);
          }}>
            <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename</MenuItem>
            <MenuItem id="default" icon={<Star {...i16} />} isDisabled={set.id === state.defaultHoursId}>Set as default</MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger isDisabled={set.id === state.defaultHoursId}>Delete</MenuItem>
          </Menu>
        </MenuTrigger>
      <Dialog isOpen={naming !== undefined} onOpenChange={(o) => { if (!o) setNaming(undefined); }} size="md" title={naming?.id ? 'Rename hours' : 'New set of hours'}
        description={naming?.id ? undefined : 'Starts as Mon–Fri, 9 to 5. Change it after.'}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!naming?.name.trim()} onPress={saveName}>{naming?.id ? 'Rename' : 'Create'}</Button></>}>
        <TextField label="Name" value={naming?.name ?? ''} onChange={(name) => setNaming((n) => ({ ...n, name }))} placeholder="Weekend clinic" autoFocus />
      </Dialog>
      <ConfirmDialog isOpen={deleting} onOpenChange={setDeleting} title={`Delete ${set.name}?`}
        consequence={usedBy.length ? `${plural(usedBy.length, 'page')} use${usedBy.length === 1 ? 's' : ''} these hours; ${usedBy.length === 1 ? 'it moves' : 'they move'} to your default hours.` : 'No page uses these hours.'}
        confirmLabel="Delete hours" onConfirm={() => {
          usedBy.forEach((p) => dispatch({ type: 'page/upsert', page: { ...p, hoursFrom: 'working' } }));
          dispatch({ type: 'hours/saved', savedHours: state.savedHours.filter((h) => h.id !== set.id), defaultHoursId: state.defaultHoursId });
        }} />
    </>
  );
}

/** Time off: a list of dates with Add time off; meetings inside the dates are offered Reassign or Keep. */
function TimeOffSection({ state, dispatch, onReassignMany, adding, onAddingChange: setAdding }: AvailabilityTabProps & { readonly adding: boolean; readonly onAddingChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [member, setMember] = useState(HOST);
  const [range, setRange] = useState<{ start: CalendarDate; end: CalendarDate } | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('17:00');
  const [note, setNote] = useState('');
  const [clash, setClash] = useState<{ readonly entry: TimeOff; readonly meetings: ReadonlyArray<BookedMeeting> }>();
  const today = isoDay(new Date());
  const list = state.timeOff.filter((t) => t.to >= today);
  useEffect(() => {
    if (!adding) return;
    setMember(HOST); setRange({ start: parseDate(isoDay(dayFrom(new Date(), 7))), end: parseDate(isoDay(dayFrom(new Date(), 7))) }); setAllDay(true); setNote('');
  }, [adding]);
  const mins = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const add = () => {
    if (!range) return;
    const entry: TimeOff = { id: nextId('off'), member, from: range.start.toString(), to: range.end.toString(), allDay, start: allDay ? 0 : mins(from), end: allDay ? 0 : mins(to), note: note.trim() };
    dispatch({ type: 'timeoff/set', timeOff: [...state.timeOff, entry] });
    setAdding(false);
    const inside = state.meetings.filter((m) => m.host === member && m.status !== 'cancelled' && entry.from <= isoDay(m.start) && isoDay(m.start) <= entry.to
      && (allDay || (minutesOf(m.start) < entry.end && entry.start < minutesOf(m.end))));
    if (inside.length) setClash({ entry, meetings: inside });
    else toast({ message: member === HOST ? 'Time off added. Your pages offer no times then.' : `Time off added for ${member}.`, tone: 'success' });
  };
  const when = (t: TimeOff) => `${formatDate(parseDay(t.from))}${t.to !== t.from ? ` – ${formatDate(parseDay(t.to))}` : ''}${t.allDay ? '' : `, ${formatClockRange(t.start, t.end)}`}`;
  return (
    <Section title="Time off" description="Who's away, and when.">
      {list.length === 0 && <p className="tf-bkf__muted">No one is away.</p>}
      {list.length > 0 && (
        <ul className="tf-bkf__list-plain">
          {list.map((t) => (
            <li key={t.id} className="tf-bkf__off">
              <CalendarX2 {...i14} aria-hidden="true" />
              <Avatar name={t.member} size={20} />
              <span className="tf-num"><strong>{t.member === HOST ? 'You' : t.member}</strong> · {when(t)}</span>
              <span className="tf-bkf__muted">{[t.note, t.member === HOST ? 'Your pages offer no times then.' : ''].filter(Boolean).join(' · ') || 'Time off'}</span>
              <span className="tf-bkf__spacer" />
              <Tooltip label="Remove"><IconButton size="sm" label={`Remove time off on ${when(t)}`} onPress={() => {
                dispatch({ type: 'timeoff/set', timeOff: state.timeOff.filter((x) => x.id !== t.id) });
                toast({ message: 'Time off removed', action: { label: 'Undo', onAction: () => dispatch({ type: 'timeoff/set', timeOff: [...state.timeOff] }) } });
              }}><X {...i14} /></IconButton></Tooltip>
            </li>
          ))}
        </ul>
      )}
      <Dialog isOpen={adding} onOpenChange={setAdding} size="md" title="Add time off" description="Guests can't book then. Meetings already booked are shown next."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!range} onPress={add}>Add time off</Button></>}>
        <div className="tf-bkf__stack">
          <Select label="Who" items={TEAM.map((n) => ({ id: n, label: n === HOST ? `${n} (you)` : n, icon: <Avatar name={n} size={20} /> }))} value={member} onChange={(v) => { if (v) setMember(v); }} />
          <DateRangePicker label="Dates" value={range} onChange={(r) => setRange(r ? { start: r.start, end: r.end } : null)} />
          <Switch isSelected={allDay} onChange={setAllDay}>All day</Switch>
          {!allDay && <div className="tf-bkf__pair"><TimeSelect label="From" value={from} hourCycle={12} onChange={(v) => { if (v) setFrom(v); }} /><TimeSelect label="To" value={to} hourCycle={12} onChange={(v) => { if (v) setTo(v); }} /></div>}
          <TextField label="Note" aside="Optional" value={note} onChange={setNote} placeholder="Conference in Berlin" />
        </div>
      </Dialog>
      <Dialog isOpen={clash !== undefined} onOpenChange={(o) => { if (!o) setClash(undefined); }} size="md" title={`${plural(clash?.meetings.length ?? 0, 'meeting is', 'meetings are')} booked then`}
        description="Hand them to a teammate who's free, or keep them and take them anyway."
        actions={<>
          <Button variant="ghost" onPress={() => { setClash(undefined); toast({ message: 'Time off added. The meetings stay with you.' }); }}>Keep them</Button>
          <Button variant="primary" onPress={() => { if (!clash) return; const n = onReassignMany(clash.meetings); setClash(undefined); toast({ message: n === clash.meetings.length ? `${plural(n, 'meeting')} reassigned` : `${n} of ${clash.meetings.length} reassigned; no one was free for the rest`, tone: 'success' }); }}>Reassign</Button>
        </>}>
        <ul className="tf-bkf__list-plain">
          {clash?.meetings.map((m) => <li key={m.id} className="tf-bkf__off"><span className="tf-num">{formatDay(m.start)}, {formatClockRange(minutesOf(m.start), minutesOf(m.end))}</span><span>{m.title} with {m.invitee.name}</span></li>)}
        </ul>
      </Dialog>
    </Section>
  );
}

/** Calendars with health (connected, needs reconnect, some calendars skipped), conflicts, and where new bookings go. */
function CalendarsSection({ state, dispatch }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void }) {
  const skippedIn = Object.entries(state.health.skipped).filter(([, n]) => n > 0);
  const connect = (provider: CalendarProvider) => new Promise<void>((resolve) => {
    window.setTimeout(() => {
      dispatch({ type: 'calendar/set', calendars: [...state.calendars, { id: nextId('cal'), provider, email: provider === 'Google' ? 'priya@northwind.com' : 'priya.raman@icloud.com', calendars: 2, status: 'connected', checkConflicts: true }] });
      resolve();
    }, 900);
  });
  const targets = state.calendars.filter((c) => c.status === 'connected').flatMap((c) => (c.provider === 'Google' ? [{ id: 'work', label: 'Work', description: `Google · ${c.email}` }, { id: 'personal', label: 'Personal', description: `Google · ${c.email}` }] : [{ id: c.id, label: 'Calendar', description: `${c.provider} · ${c.email}` }]));
  return (
    <Section title="Calendars" description="Times you're busy there are never offered to guests.">
      <div className="tf-bkf__stack">
        {state.calendars.length === 0 && <Callout tone="warning">Connect a calendar so guests never book over your meetings. Your pages work without one.</Callout>}
        {skippedIn.map(([id, n]) => (
          <Callout key={id} tone="info" action={{ label: 'Check them too', onPress: () => dispatch({ type: 'calendar/set', calendars: state.calendars, health: { ...state.health, skipped: { ...state.health.skipped, [id]: 0 } } }) }}>
            Some calendars skipped: {plural(n, 'calendar')} in {state.calendars.find((c) => c.id === id)?.email ?? 'Google'} {n === 1 ? 'isn’t' : 'aren’t'} checked for conflicts (Holidays in India).
          </Callout>
        ))}
        <CalendarConnections accounts={state.calendars} onConnect={connect}
          onCheckConflicts={(id, on) => dispatch({ type: 'calendar/set', calendars: state.calendars.map((c) => (c.id === id ? { ...c, checkConflicts: on } : c)) })}
          onReconnect={(id) => new Promise<void>((r) => { window.setTimeout(() => { dispatch({ type: 'calendar/set', calendars: state.calendars.map((c) => (c.id === id ? { ...c, status: 'connected' } : c)) }); r(); }, 800); })} />
        {targets.length > 0 && (
          <Select label="New bookings go to" items={targets} value={targets.some((t) => t.id === state.health.bookingCalendar) ? state.health.bookingCalendar : targets[0]?.id ?? null}
            onChange={(v) => { if (v) dispatch({ type: 'calendar/set', calendars: state.calendars, health: { ...state.health, bookingCalendar: v } }); }}
            description="Each page can pick another under After booking." />
        )}
      </div>
    </Section>
  );
}

/** The team's week: members down the side, the days across; each cell shows working hours, time off and how much is booked or busy. */
function TeamWeek({ state }: { readonly state: BookingsState }) {
  const [week, setWeek] = useState(0);
  const now = new Date();
  const monday = dayFrom(mondayOf(now), week * 7);
  const days = Array.from({ length: 5 }, (_, n) => dayFrom(monday, n));
  return (
    <Section title="Team week" description="Who's around, at a glance."
      action={<span className="tf-bkf__row">
        <Button size="sm" variant="ghost" onPress={() => setWeek((w) => w - 1)} aria-label="Previous week">Previous</Button>
        <Button size="sm" variant="ghost" onPress={() => setWeek((w) => w + 1)} aria-label="Next week">Next</Button>
      </span>}>
      <div className="tf-bkf-tw" role="table" aria-label="Team week" style={{ '--tf-bkf-days': days.length } as CSSProperties}>
        <div className="tf-bkf-tw__row" role="row">
          <span role="columnheader" className="tf-bkf-tw__corner">Member</span>
          {days.map((d) => <span key={isoDay(d)} role="columnheader" className="tf-bkf-tw__day tf-num">{formatDay(d)}</span>)}
        </div>
        {TEAM.map((name) => (
          <div key={name} className="tf-bkf-tw__row" role="row">
            <span role="rowheader" className="tf-bkf-tw__who"><Avatar name={name} size={20} />{first(name)}</span>
            {days.map((d) => {
              const hours = memberHours(state, name)[HOURS_DAYS[(d.getDay() + 6) % 7] ?? 'mon'];
              const off = isOff(state, name, d);
              const booked = state.meetings.filter((m) => m.host === name && m.status !== 'cancelled' && m.start.toDateString() === d.toDateString());
              const busy = busyOn(state, name, d);
              const open = hours.on ? hours.ranges.reduce((s, r) => s + r.end - r.start, 0) : 0;
              const taken = booked.reduce((s, m) => s + (m.end.getTime() - m.start.getTime()) / 60_000, 0) + busy.reduce((s, b) => s + b.end - b.start, 0);
              const share = open ? Math.min(1, taken / open) : 0;
              return (
                <span key={isoDay(d)} role="cell" className="tf-bkf-tw__cell" data-off={off ? true : undefined}
                  aria-label={off ? `${name} is off` : hours.on ? `${name}: ${hours.ranges.map((r) => formatClockRange(r.start, r.end)).join(', ')}, ${plural(booked.length, 'meeting')}` : `${name} doesn't work this day`}>
                  {off ? <Tag size="sm" hue="orange">{off.note || 'Off'}</Tag> : hours.on ? (
                    <>
                      <span className="tf-bkf-tw__hours tf-num">{hours.ranges.map((r) => formatClockRange(r.start, r.end)).join(', ')}</span>
                      <span className="tf-bkf-tw__bar" style={{ '--tf-bkf-share': share } as CSSProperties} aria-hidden="true" />
                      <span className="tf-bkf__muted tf-num">{plural(booked.length, 'meeting')}</span>
                    </>
                  ) : <span className="tf-bkf__muted">Not working</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </Section>
  );
}
