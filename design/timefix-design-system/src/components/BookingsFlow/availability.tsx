// Availability: saved hours with the HoursEditor, then time off and calendars beside them. The team's week lives on Roster.
import { TablesSection } from './tables.tsx';
import { useEffect, useState } from 'react';
import { type Key } from 'react-aria-components';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { CalendarX2, MoreHorizontal, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { HoursEditor, summarizeHours } from '../HoursEditor/HoursEditor.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { Dialog, ConfirmDialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { DateRangePicker } from '../DatePicker/DatePicker.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { CalendarConnections, type CalendarProvider } from '../CalendarConnections/CalendarConnections.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDate, formatDay } from '../../lib/format.ts';
import { Section, TabToolbar, i14, i16 } from './parts.tsx';
import { weekdays } from './seed.ts';
import {
  HOST, TEAM, TIME_OFF_REASONS, dayFrom, first, isoDay, nextId, parseDay, plural, type TimeOffReason,
  type BookedMeeting, type BookingsAction, type BookingsState, type TimeOff,
} from './state.ts';

/** Props for AvailabilityTab. */
export interface AvailabilityTabProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  /** Hands meetings on during time off; `pool` lists who to try, in order. Returns how many found a new host. */
  readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>, pool?: ReadonlyArray<string>) => number;
}

/** The Availability tab. */
export function AvailabilityTab({ state, dispatch, onReassignMany }: AvailabilityTabProps) {
  const [current, setCurrent] = useState(state.defaultHoursId);
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (!state.savedHours.some((h) => h.id === current)) setCurrent(state.defaultHoursId); }, [state.savedHours, current, state.defaultHoursId]);
  const set = state.savedHours.find((h) => h.id === current) ?? state.savedHours[0];
  return (
    <div className="tf-bkf__tab">
      <TabToolbar start={set && <SavedHoursSwitch state={state} dispatch={dispatch} set={set} onPick={setCurrent} />} />
      <div className="tf-bkf__avail">
        <div className="tf-bkf-cards tf-bkf__avail-main">
          <div className="tf-bkf-card">{set && <HoursSection state={state} dispatch={dispatch} set={set} />}</div>
          {state.tables && <div className="tf-bkf-card"><TablesSection state={state} dispatch={dispatch} /></div>}
          <div className="tf-bkf-card"><LimitsSection state={state} dispatch={dispatch} name={HOST} /></div>
        </div>
        <div className="tf-bkf-cards tf-bkf__avail-side">
          <div className="tf-bkf-card"><TimeOffSection state={state} dispatch={dispatch} onReassignMany={onReassignMany} adding={adding} onAddingChange={setAdding} /></div>
          <div className="tf-bkf-card"><CalendarsSection state={state} dispatch={dispatch} /></div>
        </div>
      </div>
    </div>
  );
}

/** Meeting limits for one person, across every page: most a day and most a week. Each is off until switched on. */
export function LimitsSection({ state, dispatch, name }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly name: string }) {
  const l = state.limits?.[name] ?? { perDay: 0, perWeek: 0 };
  const set = (patch: Partial<typeof l>) => dispatch({ type: 'limits/set', name, limits: { ...l, ...patch } });
  const you = name === HOST;
  return (
    <Section title="Meeting limits" description={`Across all ${you ? 'your' : `${first(name)}’s`} pages. Once a limit is reached, guests see no more times that day or week.`}>
      <div className="tf-bkf__limits">
        <div className="tf-bkf__limit">
          <Switch isSelected={l.perDay > 0} onChange={(on) => set({ perDay: on ? 4 : 0 })}>Most meetings a day</Switch>
          {l.perDay > 0 && <NumberField aria-label="Meetings a day" value={l.perDay} minValue={1} maxValue={40} onChange={(n) => { if (Number.isFinite(n) && n > 0) set({ perDay: n }); }} />}
        </div>
        <div className="tf-bkf__limit">
          <Switch isSelected={l.perWeek > 0} onChange={(on) => set({ perWeek: on ? 15 : 0 })}>Most meetings a week</Switch>
          {l.perWeek > 0 && <NumberField aria-label="Meetings a week" value={l.perWeek} minValue={1} maxValue={200} onChange={(n) => { if (Number.isFinite(n) && n > 0) set({ perWeek: n }); }} />}
        </div>
      </div>
    </Section>
  );
}

type SavedSet = BookingsState['savedHours'][number];
const usedByOf = (state: BookingsState, set: SavedSet) => state.pages.filter((p) => p.hoursFrom === set.id || (p.hoursFrom === 'working' && set.id === state.defaultHoursId));

/** The hours being edited, and which pages use them. */
function HoursSection({ state, dispatch, set }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly set: SavedSet }) {
  const usedBy = usedByOf(state, set);
  return (
    <Section title="Weekly hours" description={`${summarizeHours(set.hours)}, India time${set.id === state.defaultHoursId ? ' · your default' : ''}`}>
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
/** Time off for everyone, or for one person when `only` is given (the Roster drawer). */
export function TimeOffSection({ state, dispatch, onReassignMany, adding, onAddingChange: setAdding, only }: AvailabilityTabProps & { readonly adding: boolean; readonly onAddingChange: (open: boolean) => void; readonly only?: string }) {
  const { toast } = useToast();
  const [member, setMember] = useState(HOST);
  const [range, setRange] = useState<{ start: CalendarDate; end: CalendarDate } | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('17:00');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<TimeOffReason>('vacation');
  const [cover, setCover] = useState('none');
  const [clash, setClash] = useState<{ readonly entry: TimeOff; readonly meetings: ReadonlyArray<BookedMeeting> }>();
  const today = isoDay(new Date());
  const list = state.timeOff.filter((t) => t.to >= today && (only === undefined || t.member === only));
  useEffect(() => {
    if (!adding) return;
    setMember(only ?? HOST); setRange({ start: parseDate(isoDay(dayFrom(new Date(), 7))), end: parseDate(isoDay(dayFrom(new Date(), 7))) }); setAllDay(true); setNote(''); setReason('vacation'); setCover('none');
  }, [adding]);
  const mins = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const add = () => {
    if (!range) return;
    const entry: TimeOff = { id: nextId('off'), member, from: range.start.toString(), to: range.end.toString(), allDay, start: allDay ? 0 : mins(from), end: allDay ? 0 : mins(to), note: note.trim(), reason, cover: cover === 'none' ? undefined : cover };
    dispatch({ type: 'timeoff/set', timeOff: [...state.timeOff, entry] });
    setAdding(false);
    const inside = state.meetings.filter((m) => m.host === member && m.status !== 'cancelled' && entry.from <= isoDay(m.start) && isoDay(m.start) <= entry.to
      && (allDay || (minutesOf(m.start) < entry.end && entry.start < minutesOf(m.end))));
    if (inside.length) setClash({ entry, meetings: inside });
    else toast({ message: member === HOST ? 'Time off added. Your pages offer no times then.' : `Time off added for ${member}.`, tone: 'success' });
  };
  const when = (t: TimeOff) => `${formatDate(parseDay(t.from))}${t.to !== t.from ? ` – ${formatDate(parseDay(t.to))}` : ''}${t.allDay ? '' : `, ${formatClockRange(t.start, t.end)}`}`;
  return (
    <Section title="Time off" description={only ? 'Guests can’t book them then.' : "Who's away, and when."} action={<Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setAdding(true)}>Add</Button>}>
      {list.length === 0 && <p className="tf-bkf__muted">No one is away.</p>}
      {list.length > 0 && (
        <ul className="tf-bkf__list-plain">
          {list.map((t) => (
            <li key={t.id} className="tf-bkf__off">
              <CalendarX2 {...i14} aria-hidden="true" />
              <Avatar name={t.member} size={20} />
              <span className="tf-num"><strong>{t.member === HOST ? 'You' : t.member}</strong> · {when(t)}</span>
              <span className="tf-bkf__muted">{[TIME_OFF_REASONS.find((x) => x.id === t.reason)?.label, t.note, t.cover ? `${first(t.cover)} covers` : ''].filter(Boolean).join(' · ') || 'Time off'}</span>
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
          {only === undefined && <Select label="Who" items={TEAM.map((n) => ({ id: n, label: n === HOST ? `${n} (you)` : n, icon: <Avatar name={n} size={20} /> }))} value={member} onChange={(v) => { if (v) setMember(v); }} />}
          <DateRangePicker label="Dates" value={range} onChange={(r) => setRange(r ? { start: r.start, end: r.end } : null)} />
          <Switch isSelected={allDay} onChange={setAllDay}>All day</Switch>
          {!allDay && <div className="tf-bkf__pair"><TimeSelect label="From" value={from} hourCycle={12} onChange={(v) => { if (v) setFrom(v); }} /><TimeSelect label="To" value={to} hourCycle={12} onChange={(v) => { if (v) setTo(v); }} /></div>}
          <div className="tf-bkf__pair">
            <Select label="Reason" items={TIME_OFF_REASONS.map((x) => ({ id: x.id, label: x.label }))} value={reason} onChange={(v) => { if (v) setReason(v as TimeOffReason); }} />
            <Select label="Who covers" items={[{ id: 'none', label: 'No one' }, ...TEAM.filter((n) => n !== member).map((n) => ({ id: n, label: n, icon: <Avatar name={n} size={20} /> }))]} value={cover} onChange={(v) => setCover(v ?? 'none')}
              description="Their meetings go here first." />
          </div>
          <TextField label="Note" aside="Optional" value={note} onChange={setNote} placeholder="Conference in Berlin" />
        </div>
      </Dialog>
      <Dialog isOpen={clash !== undefined} onOpenChange={(o) => { if (!o) setClash(undefined); }} size="md" title={`${plural(clash?.meetings.length ?? 0, 'meeting is', 'meetings are')} booked then`}
        description={clash?.entry.cover ? `Hand them to ${first(clash.entry.cover)}, who's covering (or whoever is free), or keep them and take them anyway.` : "Hand them to a teammate who's free, or keep them and take them anyway."}
        actions={<>
          <Button variant="ghost" onPress={() => { setClash(undefined); toast({ message: 'Time off added. The meetings stay with you.' }); }}>Keep them</Button>
          <Button variant="primary" onPress={() => { if (!clash) return; const n = onReassignMany(clash.meetings, clash.entry.cover ? [clash.entry.cover, ...TEAM] : undefined); setClash(undefined); toast({ message: n === clash.meetings.length ? `${plural(n, 'meeting')} reassigned` : `${n} of ${clash.meetings.length} reassigned; no one was free for the rest`, tone: 'success' }); }}>Reassign</Button>
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
