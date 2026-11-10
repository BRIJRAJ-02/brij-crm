// Meetings, the home: List / Week / Team day, whose meetings, Upcoming / Past / Cancelled, requests, New meeting, and drag to block, hold or book.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Popover } from '../Popover/Popover.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { Ban, CalendarDays, CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, Hand, LayoutList, Plus, UserPlus, Users, X } from 'lucide-react';
import { MenuList, MenuItem } from '../Menu/Menu.tsx';
import { MeetingCard, MeetingList, type Meeting } from '../MeetingList/MeetingList.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { WeekCalendar, type WeekBusy, type WeekEvent, type WeekSelection } from '../WeekCalendar/WeekCalendar.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { ReferencePicker, type RecordRef } from '../ComboBox/ComboBox.tsx';
import { DayStrip } from '../DayStrip/DayStrip.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { formatClock, formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay, relativeDayLabel } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { TabToolbar, i14, i16 } from './parts.tsx';
import { Button as AriaButton, type Key } from 'react-aria-components';
import {
  HOST, HOST_ZONE, PLACES, PLACE_ORDER, TEAM, at, atLimit, busyOn, conflicted, dayFrom, first, isOff, isoDay, lengthOf, mondayOf, nextId, placeLabel, placeOf, plural,
  type BookedMeeting, type BookingsState, type PlaceKind, type TimeBlock,
} from './state.ts';

/** People in the CRM the host can book with or link a meeting to. */
export const PEOPLE: ReadonlyArray<RecordRef> = [
  { id: 'r-liam', name: 'Liam Ortiz', kind: 'person', sub: 'Acme Corp · liam@acme.com' },
  { id: 'r-noor', name: 'Noor Haddad', kind: 'person', sub: 'Globex · noor@globex.io' },
  { id: 'r-maria', name: 'Maria Bell', kind: 'person', sub: 'Acme Corp · maria@acme.com' },
  { id: 'r-ben', name: 'Ben Carter', kind: 'person', sub: 'Initech · ben@initech.co' },
  { id: 'r-acme', name: 'Acme Corp', kind: 'company', sub: 'acme.com' },
  { id: 'r-globex', name: 'Globex', kind: 'company', sub: 'globex.io' },
  { id: 'r-initech', name: 'Initech', kind: 'company', sub: 'initech.co' },
];
/** Searches the made-up CRM, a little slowly, like the real one. */
export const searchPeople = (query: string) => new Promise<ReadonlyArray<RecordRef>>((resolve) => {
  window.setTimeout(() => resolve(PEOPLE.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))), 300);
});

/** Whose meetings show. */
export type Whose = string;
type Range = 'upcoming' | 'past' | 'cancelled';

/** What to do with a picked span of empty time. */
export interface PickedTime { readonly member: string; readonly day: Date; readonly start: number; readonly end: number }

/** Props for MeetingsTab. */
export interface MeetingsTabProps {
  readonly state: BookingsState;
  readonly view: string; readonly onView: (v: string) => void;
  readonly whose: Whose; readonly onWhose: (w: Whose) => void;
  readonly week: number; readonly onWeek: (w: number) => void;
  /** The hour the week opens at (See conflict). */
  readonly focusHour: number | undefined;
  readonly fresh: string | undefined;
  readonly onOpen: (id: string) => void;
  readonly onCancel: (m: Meeting) => void; readonly onUndoCancel: (m: Meeting) => void;
  readonly onReschedule: (id: string) => void;
  readonly onNoShow: (id: string) => void;
  readonly onConfirm: (id: string) => void; readonly onDecline: (id: string) => void;
  readonly onCreatePage: () => void; readonly onCopyFirstLink: () => void;
  readonly onNewMeeting: (at?: PickedTime) => void;
  readonly onBlock: (block: TimeBlock) => void; readonly onHold: (picked: PickedTime) => void; readonly onTimeOff: (picked: PickedTime) => void; readonly onMoveBlock: (block: TimeBlock) => void;
  readonly onMove: (id: string, day: Date, start: number, end: number) => void;
  readonly onSeeConflict: (m: Meeting) => void;
  readonly onJoin: (id: string) => void;
  /** Hands meetings to whoever is free; returns how many moved. */
  readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>) => number;
}

/** "Starting now", "In 25 min", "In 3 hr", "Tomorrow at 10:00 AM". */
function startsIn(start: Date, now: Date): string {
  const min = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (min <= 0) return 'Starting now';
  if (min < 60) return `In ${min} min`;
  if (start.toDateString() === now.toDateString()) return `In ${Math.round(min / 60)} hr`;
  return `${relativeDayLabel(start, now)} at ${formatClock(minutesOf(start))}`;
}

/** The Meetings tab. */
export function MeetingsTab(props: MeetingsTabProps) {
  const { state, view, onView, whose, onWhose, fresh } = props;
  const now = new Date();
  const [range, setRange] = useState<Range>('upcoming');
  const mine = (m: BookedMeeting) => whose === 'everyone' || m.host === (whose === 'mine' ? HOST : whose);
  const scoped = state.meetings.filter(mine);
  const upcomingAll = scoped.filter((m) => m.status !== 'cancelled' && m.end > now);
  const requests = upcomingAll.filter((m) => m.status === 'pending');
  const lists: Readonly<Record<Range, ReadonlyArray<BookedMeeting>>> = {
    upcoming: upcomingAll.filter((m) => m.status !== 'pending'),
    past: scoped.filter((m) => m.status !== 'cancelled' && m.end <= now).reverse(),
    cancelled: scoped.filter((m) => m.status === 'cancelled'),
  };
  const shown = (list: ReadonlyArray<BookedMeeting>): ReadonlyArray<Meeting> => list.map((m) => ({ ...m, host: whose === 'mine' ? undefined : first(m.host) }));
  const nextRaw = lists.upcoming[0];
  const nextUp = nextRaw ? shown([nextRaw])[0] : undefined;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const clashes = conflicted(state, now).filter(mine);
  const firstClash = clashes.find((m) => !dismissed.has(m.id));

  const clashCallout = firstClash && (
        <Callout key={firstClash.id} tone="warning" onDismiss={() => setDismissed((d) => new Set(d).add(firstClash.id))}>
          <span className="tf-bkf__banner">
            <span>{firstClash.title} on {formatDay(firstClash.start)} clashes with {firstClash.host === HOST ? 'your' : `${first(firstClash.host)}'s`} calendar{clashes.length > 1 ? `, and ${plural(clashes.length - 1, 'other meeting')} too` : ''}.</span>
            <AriaButton className="tf-bkf__textbtn" onPress={() => props.onSeeConflict(firstClash)}>See conflict</AriaButton>
          </span>
        </Callout>
  );

  if (state.meetings.length === 0) {
    return (
      <EmptyState icon={<CalendarDays size={20} strokeWidth={1.75} />} title="No meetings yet"
        description="Create a booking page and share it; meetings show up here as people book."
        action={state.pages.length === 0 ? <Button variant="primary" icon={<Plus {...i14} />} onPress={props.onCreatePage}>Create booking page</Button>
          : <Button variant="secondary" onPress={props.onCopyFirstLink}>Copy booking link</Button>} />
    );
  }

  const whoseItems = [{ id: 'mine', label: 'Mine' }, { id: 'everyone', label: 'Everyone' }, ...TEAM.filter((n) => n !== HOST).map((n) => ({ id: n, label: n, icon: <Avatar name={n} size={20} /> }))];

  return (
    <div className="tf-bkf__meetings">
      <TabToolbar
        start={<>
          <SegmentedControl aria-label="View" selectedKey={view} onSelectionChange={onView}
            items={[{ id: 'list', label: 'List', icon: <LayoutList {...i14} /> }, { id: 'week', label: 'Week', icon: <CalendarDays {...i14} /> }, { id: 'team', label: 'Team day', icon: <Users {...i14} /> }]} />
          {view !== 'team' && <Select label="Whose meetings" isLabelHidden className="tf-bkf__whose" items={whoseItems} value={whose} onChange={(v) => { if (v) onWhose(v); }} />}
          {view === 'list' && <Select label="Which meetings" isLabelHidden className="tf-bkf__whose" value={range} onChange={(k) => { if (k) setRange(k as Range); }}
            items={[{ id: 'upcoming', label: `Upcoming · ${lists.upcoming.length + requests.length}` }, { id: 'past', label: `Past · ${lists.past.length}` }, { id: 'cancelled', label: `Cancelled · ${lists.cancelled.length}` }]} />}
        </>}
        action={<Button variant="primary" icon={<CalendarPlus {...i14} />} onPress={() => props.onNewMeeting()}>New meeting</Button>} />
      {view !== 'list' && clashCallout}
      {view === 'list' && (
        <>
          {range === 'upcoming' && nextUp && (
            <section className="tf-bkf-next" aria-label="Next up">
              <span className="tf-bkf__label">Next up</span>
              <MeetingCard meeting={nextUp} strip={{ tone: 'success', text: startsIn(nextUp.start, now), action: nextUp.place === 'in-person' ? 'Open' : 'Join', onAction: () => (nextUp.place === 'in-person' ? props.onOpen(nextUp.id) : props.onJoin(nextUp.id)) }} />
            </section>
          )}
          {clashCallout}
          <MeetingList isFullWidth meetings={shown(range === 'upcoming' ? lists.upcoming.slice(1) : lists[range])} requests={range === 'upcoming' ? shown(requests) : []} now={now} highlightId={fresh} conflictIds={new Set(clashes.map((m) => m.id))} onOpen={(m) => props.onOpen(m.id)}
            onCancel={props.onCancel} onUndoCancel={props.onUndoCancel} onReschedule={(m) => props.onReschedule(m.id)} onNoShow={(m) => props.onNoShow(m.id)}
            onConfirm={(m) => props.onConfirm(m.id)} onDecline={(m) => props.onDecline(m.id)}
            onNote={(m) => props.onOpen(m.id)} onCopyLink={() => undefined}
            emptyAction={range === 'upcoming' ? <Button size="sm" onPress={props.onCopyFirstLink}>Copy booking link</Button> : undefined} />
        </>
      )}
      {view === 'week' && <WeekView {...props} scoped={scoped} />}
      {view === 'team' && <TeamDay state={state} week={props.week} onWeek={props.onWeek} onOpen={props.onOpen} onReassignMany={props.onReassignMany}
        menu={(p, close) => <PickedMenu picked={p} close={close} onBook={() => props.onNewMeeting(p)}
          onBlock={() => props.onBlock({ id: nextId('blk'), member: p.member, day: isoDay(p.day), start: p.start, end: p.end, kind: 'block', label: 'Blocked' })}
          onHold={() => props.onHold(p)} onTimeOff={() => props.onTimeOff(p)} />} />}
    </div>
  );
}


/** "1 hr 30 min", "45 min", "2 hr". */
function lengthLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** What a dragged span of the week can become: the time on top, then four plain actions. Picking one closes it. */
function PickedMenu({ picked, close, onBook, onBlock, onHold, onTimeOff }: { readonly picked: PickedTime; readonly close: () => void; readonly onBook: () => void; readonly onBlock: () => void; readonly onHold: () => void; readonly onTimeOff: () => void }) {
  const run = (fn: () => void) => { close(); window.setTimeout(fn, 150); };
  return (
    <div className="tf-bkf-pickmenu">
      <div className="tf-bkf-pickmenu__head">
        <span className="tf-bkf-pickmenu__time tf-num">{formatClockRange(picked.start, picked.end)}</span>
        <span className="tf-bkf-pickmenu__sub tf-num">{picked.member !== HOST ? `${first(picked.member)} · ` : ''}{formatLongDay(picked.day)} · {lengthLabel(picked.end - picked.start)}</span>
      </div>
      <MenuList aria-label="Use this time" onAction={(k: Key) => {
        if (k === 'book') run(onBook);
        else if (k === 'block') run(onBlock);
        else if (k === 'hold') run(onHold);
        else if (k === 'off') run(onTimeOff);
      }}>
        <MenuItem id="book" icon={<UserPlus {...i16} />}>Book someone in</MenuItem>
        <MenuItem id="block" icon={<Ban {...i16} />}>Block this time</MenuItem>
        <MenuItem id="hold" icon={<Hand {...i16} />}>Hold for someone</MenuItem>
        <MenuItem id="off" icon={<CalendarOff {...i16} />}>Time off</MenuItem>
      </MenuList>
    </div>
  );
}

/** Week view: bookings only, or every calendar with busy time hatched; drag empty time to pick it. */
function WeekView(props: MeetingsTabProps & { readonly scoped: ReadonlyArray<BookedMeeting> }) {
  const { state, week, onWeek, focusHour, scoped, whose } = props;
  const [all, setAll] = useState(true);
  const now = new Date();
  const monday = mondayOf(now);
  monday.setDate(monday.getDate() + week * 7);
  const days = Array.from({ length: 5 }, (_, n) => dayFrom(monday, n));
  const member = whose === 'mine' || whose === 'everyone' ? HOST : whose;
  const blocks = state.blocks.filter((b) => whose === 'everyone' || b.member === member);
  const events: WeekEvent[] = [
    ...scoped.filter((m) => m.status !== 'cancelled').flatMap((m) => {
      const day = days.findIndex((d) => d.toDateString() === m.start.toDateString());
      return day === -1 ? [] : [{ id: m.id, title: whose === 'mine' ? m.title : `${m.title} · ${first(m.host)}`, day, start: minutesOf(m.start), end: minutesOf(m.end), kind: m.place === 'in-person' ? 'in-person' as const : 'meeting' as const, guests: [m.invitee.name], location: m.placeLabel, mark: <LogoMark size={12} /> }];
    }),
    ...blocks.flatMap((b) => {
      const day = days.findIndex((d) => isoDay(d) === b.day);
      return day === -1 ? [] : [{ id: b.id, title: b.label, day, start: b.start, end: b.end, kind: 'internal' as const }];
    }),
  ];
  const busy: WeekBusy[] = all ? days.flatMap((d, day) => busyOn(state, member, d).filter((b) => b.kind === 'calendar').map((b) => ({ id: `${b.id}-${day}`, day, start: b.start, end: b.end, source: b.source }))) : [];
  const todayIndex = days.findIndex((d) => d.toDateString() === now.toDateString());
  const startHour = focusHour === undefined ? HOUR_FROM : Math.max(0, Math.min(focusHour - 1, 12));
  const endHour = Math.min(24, Math.max(startHour + 12, HOUR_TO));
  const first0 = days[0] ?? now;
  const last = days[days.length - 1] ?? now;
  return (
    <div className="tf-bkf__stack tf-bkf__stack--12">
      <div className="tf-bkf__bar">
        <span className="tf-bkf__weeknav">
          <IconButton size="sm" label="Previous week" onPress={() => onWeek(week - 1)}><ChevronLeft {...i16} /></IconButton>
          <span className="tf-num" aria-live="polite">{formatDay(first0)} – {formatDay(last)}</span>
          <IconButton size="sm" label="Next week" onPress={() => onWeek(week + 1)}><ChevronRight {...i16} /></IconButton>
          {week !== 0 && <Button size="sm" variant="ghost" onPress={() => onWeek(0)}>This week</Button>}
        </span>
        <span className="tf-bkf__spacer" />
        <SegmentedControl aria-label="What the week shows" size="sm" selectedKey={all ? 'all' : 'bookings'} onSelectionChange={(k) => setAll(k === 'all')}
          items={[{ id: 'bookings', label: 'Bookings only' }, { id: 'all', label: 'All calendars' }]} />
      </div>
      <WeekCalendar scrollHeight="max(calc(var(--tf-week-hour) * 6), calc(100dvh - 300px))" days={days.map((d, n) => ({ weekday: formatDay(d).split(' ')[0] ?? '', date: d.getDate(), label: formatLongDay(d), isToday: n === todayIndex }))}
        events={events} busy={busy} startHour={startHour} endHour={endHour} now={todayIndex >= 0 ? { day: todayIndex, minutes: minutesOf(now) } : undefined}
        selectionMenu={(sel: WeekSelection, close) => {
          const d = days[sel.day];
          if (!d) return null;
          const picked: PickedTime = { member, day: d, start: sel.start, end: sel.end };
          return <PickedMenu picked={picked} close={close} onBook={() => props.onNewMeeting(picked)}
            onBlock={() => props.onBlock({ id: nextId('blk'), member, day: isoDay(d), start: sel.start, end: sel.end, kind: 'block', label: 'Blocked' })}
            onHold={() => props.onHold(picked)} onTimeOff={() => props.onTimeOff(picked)} />;
        }}
        onJoin={(ev) => props.onJoin(ev.id)} onReschedule={(ev) => props.onReschedule(ev.id)}
        onEventChange={(ev, next) => {
          const d = days[next.day];
          if (!d) return;
          const block = state.blocks.find((b) => b.id === ev.id);
          if (block) props.onMoveBlock({ ...block, day: isoDay(d), start: next.start, end: next.end });
          else props.onMove(ev.id, d, next.start, next.end);
        }} />
    </div>
  );
}

const HOUR_FROM = 8;
const HOUR_TO = 20;

/** Team day: members side by side for one day, with their hours, time off, busy time and meetings. Drag (or Enter) on empty time picks it. */
function TeamDay({ state, week, onWeek, menu, onOpen, onReassignMany }: { readonly state: BookingsState; readonly week: number; readonly onWeek: (w: number) => void; readonly menu: (p: PickedTime, close: () => void) => ReactNode; readonly onOpen: (id: string) => void; readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>) => number }) {
  const [held, setHeld] = useState<PickedTime>();
  const heldRef = useRef<HTMLSpanElement>(null);
  const onPick = (p: PickedTime) => setHeld(p);
  const close = () => setHeld(undefined);
  const now = new Date();
  const monday = dayFrom(mondayOf(now), week * 7);
  const days = Array.from({ length: 5 }, (_, n) => dayFrom(monday, n));
  const [dayId, setDayId] = useState(() => isoDay(days.find((d) => d.toDateString() === now.toDateString()) ?? days[0] ?? now));
  const day = days.find((d) => isoDay(d) === dayId) ?? days[0] ?? now;
  const [drag, setDrag] = useState<{ readonly member: string; readonly a: number; readonly b: number }>();
  const dragging = useRef(false);
  useEffect(() => { if (!days.some((d) => isoDay(d) === dayId)) setDayId(isoDay(days[0] ?? now)); }, [week]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = (HOUR_TO - HOUR_FROM) * 60;
  const pct = (m: number) => `${((m - HOUR_FROM * 60) / total) * 100}%`;
  const len = (a: number, b: number) => `${((b - a) / total) * 100}%`;
  const minuteAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(HOUR_TO * 60 - 15, Math.max(HOUR_FROM * 60, HOUR_FROM * 60 + Math.floor(((e.clientY - r.top) / r.height) * total / 15) * 15));
  };
  const counts = (d: Date) => state.meetings.filter((m) => m.status !== 'cancelled' && m.start.toDateString() === d.toDateString()).length;
  return (
    <div className="tf-bkf__stack tf-bkf__stack--12">
      <DayStrip label="Day" days={days.map((d) => ({ id: isoDay(d), weekday: formatDay(d).split(' ')[0] ?? '', date: d.getDate(), label: formatLongDay(d), count: counts(d), isToday: d.toDateString() === now.toDateString() }))}
        value={dayId} onChange={setDayId} onPrevious={() => onWeek(week - 1)} onNext={() => onWeek(week + 1)} />
      {(() => {
        // Meetings this day whose host is away: they need someone else.
        const orphans = state.meetings.filter((m) => m.status !== 'cancelled' && m.start.toDateString() === day.toDateString() && isOff(state, m.host, day, minutesOf(m.start), minutesOf(m.end)));
        if (!orphans.length) return null;
        const away = [...new Set(orphans.map((m) => first(m.host)))].join(' and ');
        return (
          <Callout tone="warning" action={{ label: 'Find hosts', onPress: () => onReassignMany(orphans) }}>
            {plural(orphans.length, 'meeting needs', 'meetings need')} a host: {away} {orphans.length === 1 && !away.includes(' and ') ? 'is' : 'are'} away.
          </Callout>
        );
      })()}
      <div className="tf-bkf-team" style={{ '--tf-bkf-cols': TEAM.length, '--tf-bkf-hours': HOUR_TO - HOUR_FROM } as React.CSSProperties}>
        <div className="tf-bkf-team__head">
          <span />
          {TEAM.map((name) => <span key={name} className="tf-bkf-team__who"><Avatar name={name} size={20} />{first(name)}{isOff(state, name, day) && <span className="tf-bkf__muted"> · off</span>}</span>)}
        </div>
        <div className="tf-bkf-team__scroll">
        <div className="tf-bkf-team__body">
          <div className="tf-bkf-team__gutter" aria-hidden="true">
            {Array.from({ length: HOUR_TO - HOUR_FROM }, (_, n) => <span key={n} style={{ top: pct((HOUR_FROM + n) * 60) }}>{formatClock((HOUR_FROM + n) * 60).replace(":00", "")}</span>)}
          </div>
          {TEAM.map((name) => {
            const off = isOff(state, name, day);
            const meetings = state.meetings.filter((m) => m.host === name && m.status !== 'cancelled' && m.start.toDateString() === day.toDateString());
            const busy = busyOn(state, name, day);
            const sel = drag?.member === name ? { start: Math.min(drag.a, drag.b), end: Math.max(drag.a, drag.b) + 15 } : undefined;
            return (
              <div key={name} className="tf-bkf-team__col" tabIndex={0} role="group"
                aria-label={`${name}, ${formatLongDay(day)}. ${plural(meetings.length, 'meeting')}. Enter picks 9:00 for half an hour.`}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick({ member: name, day, start: 9 * 60, end: 9 * 60 + 30 }); } }}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  dragging.current = true;
                  const m = minuteAt(e);
                  setDrag({ member: name, a: m, b: m });
                }}
                onPointerMove={(e) => { if (dragging.current && drag?.member === name) setDrag({ ...drag, b: minuteAt(e) }); }}
                onPointerUp={() => {
                  if (!dragging.current || !sel) return;
                  dragging.current = false;
                  setDrag(undefined);
                  onPick({ member: name, day, start: sel.start, end: Math.max(sel.end, sel.start + 30) });
                }}>
                {Array.from({ length: HOUR_TO - HOUR_FROM }, (_, n) => <span key={n} className="tf-bkf-team__line" style={{ top: pct((HOUR_FROM + n) * 60) }} aria-hidden="true" />)}
                {off && <span className="tf-bkf-team__off" style={{ top: 0, height: '100%' }}>{off.note || 'Time off'}</span>}
                {busy.map((b) => <span key={b.id} className={cx('tf-bkf-team__busy', b.kind !== 'calendar' && 'tf-bkf-team__busy--own')} style={{ top: pct(b.start), height: len(b.start, b.end) }}>{b.source.split(' · ')[0]}</span>)}
                {meetings.map((m) => (
                  <button key={m.id} type="button" className={cx('tf-bkf-team__event', m.status === 'pending' && 'is-pending')} style={{ top: pct(minutesOf(m.start)), height: len(minutesOf(m.start), minutesOf(m.end)) }}
                    onClick={() => onOpen(m.id)} aria-label={`${m.title} with ${m.invitee.name}, ${formatClockRange(minutesOf(m.start), minutesOf(m.end))}`}>
                    {m.end.getTime() - m.start.getTime() < 60 * 60_000
                      ? <span className="tf-bkf-team__event-one"><LogoMark size={12} className="tf-bkf-team__mark" /><span className="tf-bkf-team__event-title">{m.title}</span> · <span className="tf-num">{formatClock(minutesOf(m.start))}</span></span>
                      : <><span className="tf-bkf-team__event-title"><LogoMark size={12} className="tf-bkf-team__mark" />{m.title}</span><span className="tf-num">{formatClockRange(minutesOf(m.start), minutesOf(m.end))}</span></>}
                  </button>
                ))}
                {sel && <span className="tf-bkf-team__sel" style={{ top: pct(sel.start), height: len(sel.start, sel.end) }} aria-hidden="true" />}
                {!sel && held?.member === name && held.day.toDateString() === day.toDateString() && <span ref={heldRef} className="tf-bkf-team__sel" style={{ top: pct(held.start), height: len(held.start, held.end) }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
        </div>
      </div>
      {held && (
        <Popover triggerRef={heldRef} isOpen onOpenChange={(o) => { if (!o) close(); }} placement="end top" offset={8} label={`${held.member}, ${formatLongDay(held.day)}, ${formatClockRange(held.start, held.end)}`}>
          {menu(held, close)}
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ New meeting, Decline, Hold */

/** What New meeting books. */
export interface NewMeetingInput { readonly pageId: string | undefined; readonly length: number; readonly day: Date; readonly start: number; readonly with: RecordRef; readonly guests: ReadonlyArray<string>; readonly place: PlaceKind; readonly host: string }

/** New meeting: a page or a custom length, a time, who it's with (from People), extra guests and where. */
export function NewMeetingDialog({ isOpen, state, initial, onClose, onBook }: { readonly isOpen: boolean; readonly state: BookingsState; readonly initial?: PickedTime; readonly onClose: () => void; readonly onBook: (input: NewMeetingInput) => void }) {
  const firstPage = state.pages.find((p) => p.isOn);
  const [pageId, setPageId] = useState<string>(firstPage?.id ?? 'custom');
  const [length, setLength] = useState(30);
  const [date, setDate] = useState<CalendarDate>(() => parseDate(isoDay(dayFrom(new Date(), 1))));
  const [time, setTime] = useState('10:00');
  const [who, setWho] = useState<RecordRef>();
  const [guests, setGuests] = useState('');
  const [place, setPlace] = useState<PlaceKind>('meet');
  useEffect(() => {
    if (!isOpen) return;
    const p = state.pages.find((x) => x.isOn);
    // A dragged span is its own length: the type starts as Custom length; picking a page type resets the length to the page's.
    setPageId(initial || !p ? 'custom' : p.id); setLength(initial ? initial.end - initial.start : p ? lengthOf(p) : 30); setWho(undefined); setGuests(''); setPlace(p ? placeOf(p) : 'meet');
    setDate(parseDate(isoDay(initial?.day ?? dayFrom(new Date(), 1))));
    const s = initial?.start ?? 600;
    setTime(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = state.pages.find((p) => p.id === pageId);
  const book = () => {
    if (!who) return;
    const [h, m] = time.split(':').map(Number);
    onBook({ pageId: page?.id, length: page ? lengthOf(page) : length, day: new Date(date.year, date.month - 1, date.day), start: (h ?? 10) * 60 + (m ?? 0), with: who,
      guests: guests.split(/[,\s]+/).filter((x) => x.includes('@')), place, host: initial?.member ?? HOST });
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); }} title="New meeting" description="Book a time yourself. They get an invitation at once." size="md"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!who} onPress={book}>Book meeting</Button></>}>
      <div className="tf-bkf__stack">
        <Select label="Type" value={pageId} onChange={(v) => { if (!v) return; setPageId(v); const p = state.pages.find((x) => x.id === v); if (p) { setLength(lengthOf(p)); setPlace(placeOf(p)); } }}
          items={[...state.pages.map((p) => ({ id: p.id, label: p.name, description: `${lengthOf(p)} min` })), { id: 'custom', label: 'Custom length' }]} />
        {pageId === 'custom' && <NumberField label="Length" unit="min" value={length} minValue={5} maxValue={480} step={5} onChange={(n) => { if (Number.isFinite(n)) setLength(n); }} />}
        <div className="tf-bkf__pair">
          <DatePicker label="Day" value={date} onChange={(d) => { if (d) setDate(d); }} />
          <TimeSelect label="Start" value={time} hourCycle={12} onChange={(v) => { if (v) setTime(v); }} />
        </div>
        {(() => {
          // Booking by hand can go past a limit, but say so first.
          const hostName = initial?.member ?? HOST;
          const hit = atLimit(state, hostName, new Date(date.year, date.month - 1, date.day));
          const l = state.limits?.[hostName];
          return hit && l ? <Callout tone="warning">{hostName === HOST ? 'You have' : `${first(hostName)} has`} reached the limit of {hit === 'day' ? `${l.perDay} meetings that day` : `${l.perWeek} meetings that week`}. You can still book it.</Callout> : null;
        })()}
        {who ? (
          <div className="tf-bkf__record"><span className="tf-bkf__muted">With</span><strong>{who.name}</strong><span className="tf-bkf__spacer" /><Button size="sm" variant="ghost" onPress={() => setWho(undefined)}>Change</Button></div>
        ) : <ReferencePicker label="With" placeholder="Search People…" recent={PEOPLE.filter((p) => p.kind === 'person').slice(0, 3)} search={searchPeople} onSelect={setWho} onCreate={(name) => setWho({ id: nextId('r'), name, kind: 'person' })} />}
        <TextField label="Extra guests" aside="Optional" value={guests} onChange={setGuests} placeholder="sam@acme.com, jo@acme.com" />
        <Select label="Where" value={place} onChange={(v) => { if (v) setPlace(v as PlaceKind); }} items={PLACE_ORDER.map((k) => ({ id: k, label: page ? placeLabel(page, k) : PLACES[k].label }))} />
      </div>
    </Dialog>
  );
}

/** Decline a request: one question, an optional reason. */
export function DeclineDialog({ meeting, onClose, onDecline }: { readonly meeting: BookedMeeting | undefined; readonly onClose: () => void; readonly onDecline: (m: BookedMeeting, reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => { setReason(''); }, [meeting?.id]);
  return (
    <Dialog isOpen={meeting !== undefined} onOpenChange={(o) => { if (!o) onClose(); }} size="md" showClose={false}
      title={`Decline ${meeting?.title ?? ''} with ${meeting?.invitee.name ?? ''}?`} description="They get an email saying this time doesn't work, with a link to pick another."
      actions={<><Button variant="ghost" slot="close" autoFocus>Keep request</Button><Button variant="danger" onPress={() => { if (meeting) onDecline(meeting, reason.trim()); }}>Decline</Button></>}>
      <TextArea label="Reason" aside="Optional" rows={2} value={reason} onChange={setReason} placeholder="We're fully booked that week." />
    </Dialog>
  );
}

/** Hold for someone: who the held time is for. */
export function HoldDialog({ picked, onClose, onHold }: { readonly picked: PickedTime | undefined; readonly onClose: () => void; readonly onHold: (label: string) => void }) {
  const [who, setWho] = useState('');
  useEffect(() => { setWho(''); }, [picked]);
  return (
    <Dialog isOpen={picked !== undefined} onOpenChange={(o) => { if (!o) onClose(); }} size="md" title="Hold this time"
      description={picked ? `${formatDay(picked.day)}, ${formatClockRange(picked.start, picked.end)}. No one else can book it.` : undefined}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => onHold(who.trim())}>Hold time</Button></>}>
      <TextField label="Who it's for" aside="Optional" value={who} onChange={setWho} placeholder="Liam from Acme" autoFocus />
    </Dialog>
  );
}

/** A meeting made by New meeting. */
export function meetingFrom(input: NewMeetingInput, state: BookingsState): BookedMeeting {
  const page = state.pages.find((p) => p.id === input.pageId);
  const start = at(input.day, input.start);
  return {
    id: nextId('m'), pageId: page?.id, host: input.host, start, end: new Date(start.getTime() + input.length * 60_000), title: page?.name ?? `Meeting with ${first(input.with.name)}`,
    invitee: { name: input.with.name, email: input.with.sub?.split(' · ')[1] ?? `${first(input.with.name).toLowerCase()}@example.com` }, guests: input.guests,
    place: PLACES[input.place].meeting, placeLabel: page ? placeLabel(page, input.place) : PLACES[input.place].label, status: 'confirmed', notes: '', answers: [], guestZone: HOST_ZONE,
    record: input.with, activity: [{ id: nextId('a'), text: `Booked by ${HOST}`, at: new Date() }],
  };
}
