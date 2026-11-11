// Meetings, the home: List / Week / Team day, whose meetings, Upcoming / Past / Cancelled, requests, New meeting, and drag to block, hold or book.
import { copyText } from '../../lib/copy.ts';
import { Link } from '../Link/Link.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DialogTrigger } from 'react-aria-components';
import { Popover } from '../Popover/Popover.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { AlertTriangle, ArrowDownUp, Ban, CalendarDays, CalendarOff, CalendarPlus, CalendarRange, CalendarSearch, ChevronLeft, ChevronRight, Hand, LayoutList, ListFilter, PanelRight, Plus, UserPlus, Users, X } from 'lucide-react';
import { MenuList, MenuItem, MenuTrigger, Menu, MenuSection } from '../Menu/Menu.tsx';
import { Checkbox, RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { ConfirmDialog } from '../Dialog/Dialog.tsx';
import { MeetingCard, MeetingList, type Meeting } from '../MeetingList/MeetingList.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { WeekCalendar, type WeekBusy, type WeekEvent, type WeekSelection } from '../WeekCalendar/WeekCalendar.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Calendar, DatePicker } from '../DatePicker/DatePicker.tsx';
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
  HOST, HOST_ZONE, PLACES, PLACE_ORDER, TEAM, ZONES, at, atLimit, blockOnDay, busyOn, conflicted, dayFrom, first, hoursOn, isOff, isoDay, lengthOf, mondayOf, nextId, parseDay, placeLabel, placeOf, plural,
  type BookedMeeting, type BookingsState, type PlaceKind, type TimeBlock,
  isWith,
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
  { id: 'r-deal-acme', name: 'Acme expansion', kind: 'record', object: 'Deal', sub: 'Proposal · ₹4,20,000' },
  { id: 'r-deal-globex', name: 'Globex renewal', kind: 'record', object: 'Deal', sub: 'Qualified' },
  { id: 'r-proj-rollout', name: 'Initech rollout', kind: 'record', object: 'Project', sub: 'In progress' },
];
/** Searches the made-up CRM, a little slowly, like the real one. */
export const searchPeople = (query: string) => new Promise<ReadonlyArray<RecordRef>>((resolve) => {
  window.setTimeout(() => resolve(PEOPLE.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))), 300);
});

/** What each teammate does, for Team day's order by job title. */
export const JOB_TITLES: Readonly<Record<string, string>> = { 'Priya Raman': 'Head of sales', 'Sam Kim': 'Account executive', 'Jo Mendes': 'Account executive', 'Ava Chen': 'Sales development' };

/** Searches People only (who a meeting is with). */
export const searchOnlyPeople = (query: string) => searchPeople(query).then((r) => r.filter((x) => x.kind === 'person'));

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
  /** Books straight from a picked time's popover (who, then Book); the full dialog stays a click away. */
  readonly onQuickMeeting?: (input: NewMeetingInput) => void;
  readonly onBlock: (block: TimeBlock) => void; readonly onHold: (picked: PickedTime, forPage?: string) => void; readonly onTimeOff: (picked: PickedTime) => void; readonly onMoveBlock: (block: TimeBlock) => void;
  /** Removes a block or releases reserved time (already asked): one day of a weekly block, or every week. */
  readonly onRemoveBlock: (block: TimeBlock, every: boolean, date: string) => void;
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

/** How many list rows show before "Show more". */
const PAGE_SIZE = 20;
/** What the views show: bookings and calendar events, or one of them. */
type Source = 'all' | 'bookings' | 'calendar';
/** Which way the list runs: soonest or latest first (Upcoming), most recent or oldest first (Past, Cancelled). */
type Order = 'forward' | 'back';

/** A connected calendar's event (busy time that came from it), as the list and the week show it. */
export interface CalendarEvent { readonly id: string; readonly member: string; readonly day: Date; readonly start: number; readonly end: number; readonly title: string; readonly calendar: string; readonly calendarId: string; readonly source: string }
/** Every event your connected calendars hold, with the calendar it sits in ("Work · Google Calendar"). Only yours: teammates' show as busy time. */
export function calendarEvents(state: BookingsState): ReadonlyArray<CalendarEvent> {
  return state.busy.filter((b) => b.member === HOST).map((b) => {
    const [title = 'Busy', provider = 'Calendar'] = b.source.split(' · ');
    const account = state.calendars.find((c) => provider.includes(c.provider));
    const sub = account ? state.subCalendars?.[account.id]?.find((c) => c.id === b.calendar) : undefined;
    return { id: `cal:${b.id}`, member: b.member, day: parseDay(b.day), start: b.start, end: b.end, title, calendar: sub ? `${sub.name} · ${provider}` : provider, calendarId: b.calendar ?? account?.id ?? 'calendar', source: b.source };
  });
}
/** A calendar event as a list row. */
const asRow = (e: CalendarEvent): Meeting => ({ id: e.id, start: at(e.day, e.start), end: at(e.day, e.end), title: e.title, invitee: { name: e.calendar, email: '' }, place: 'video', placeLabel: e.calendar, status: 'confirmed', kind: 'calendar' });
/** A request's grey note: when it declines on its own, a day after it was asked. */
export function declinesIn(m: BookedMeeting, now: Date): string | undefined {
  if (m.status !== 'pending') return undefined;
  const asked = m.activity[0]?.at ?? now;
  const left = Math.max(0, Math.round((asked.getTime() + 86_400_000 - now.getTime()) / 3_600_000));
  return left <= 1 ? 'Declines within the hour' : `Declines in ${left} hr`;
}

/** About this event: a connected calendar's own event, read only (the list row or the week's event opens it). */
export function AboutEventDialog({ event, onClose }: { readonly event: CalendarEvent | undefined; readonly onClose: () => void }) {
  return (
    <Dialog isOpen={event !== undefined} onOpenChange={(o) => { if (!o) onClose(); }} size="sm" title={event?.title ?? 'Event'}
      description={event ? `${formatLongDay(event.day)} · ${formatClockRange(event.start, event.end)}` : undefined}
      actions={<Button variant="secondary" slot="close">Close</Button>}>
      {event && <EventAbout event={event} />}
    </Dialog>
  );
}
/** The lines About this event shows: which calendar, and that Timefix only keeps the time blocked. */
function EventAbout({ event }: { readonly event: CalendarEvent }) {
  return (
    <div className="tf-bkf__stack tf-bkf__stack--8">
      <span className="tf-bkf__label">About this event</span>
      <p className="tf-bkf-about__row"><CalendarDays {...i14} aria-hidden="true" />{event.calendar}</p>
      <p className="tf-bkf__muted">From your calendar. Timefix keeps the time blocked but doesn’t manage this event.</p>
    </div>
  );
}

/** The Meetings tab. */
export function MeetingsTab(props: MeetingsTabProps) {
  const { state, view, onView, whose, onWhose, fresh } = props;
  const { toast } = useToast();
  const now = new Date();
  const [range, setRange] = useState<Range>('upcoming');
  const [pageIds, setPageIds] = useState<ReadonlySet<string>>(new Set());
  const [source, setSource] = useState<Source>('all');
  const [order, setOrder] = useState<Order>('forward');
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const [calsOpen, setCalsOpen] = useState(false);
  // Calendars set not to show on the week start hidden; Bookings is Timefix's own.
  const [hiddenCals, setHiddenCals] = useState<ReadonlySet<string>>(() => new Set(Object.values(state.subCalendars ?? {}).flat().filter((c) => !c.week).map((c) => c.id)));
  const [dayAt, setDayAt] = useState(() => dayFrom(now, 0));
  const [about, setAbout] = useState<CalendarEvent>();
  useEffect(() => { setShownCount(PAGE_SIZE); }, [range, source, order, pageIds, whose]);
  const mine = (m: BookedMeeting) => whose === 'everyone' || isWith(m, whose === 'mine' ? HOST : whose);
  const showBookings = source !== 'calendar' && !hiddenCals.has('bookings');
  const byPage = (m: BookedMeeting) => pageIds.size === 0 || (m.pageId !== undefined && pageIds.has(m.pageId));
  const scoped = state.meetings.filter((m) => mine(m) && byPage(m) && showBookings);
  // Your own calendar's events show with your meetings (Mine or Everyone), never on a teammate's.
  const events = source !== 'bookings' && pageIds.size === 0 && (whose === 'mine' || whose === 'everyone') ? calendarEvents(state).filter((e) => !hiddenCals.has(e.calendarId)) : [];
  const upcomingAll = scoped.filter((m) => m.status !== 'cancelled' && m.end > now);
  const requests = upcomingAll.filter((m) => m.status === 'pending');
  const lists: Readonly<Record<Range, ReadonlyArray<BookedMeeting>>> = {
    upcoming: upcomingAll.filter((m) => m.status !== 'pending'),
    past: scoped.filter((m) => m.status !== 'cancelled' && m.end <= now).reverse(),
    cancelled: scoped.filter((m) => m.status === 'cancelled'),
  };
  const shown = (list: ReadonlyArray<BookedMeeting>): ReadonlyArray<Meeting> => list.map((m) => ({ ...m, host: whose === 'mine' ? undefined : m.hostLeft ? 'Needs a host' : first(m.host), note: declinesIn(m, now) }));
  const filtersOn = pageIds.size > 0 || source !== 'all';
  const nextRaw = order === 'forward' && !filtersOn ? lists.upcoming[0] : undefined;
  const nextUp = nextRaw ? shown([nextRaw])[0] : undefined;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const clashes = conflicted(state, now).filter(mine);
  const firstClash = clashes.find((m) => !dismissed.has(m.id));

  const clashCallout = firstClash && (
        <Callout key={firstClash.id} tone="warning" onDismiss={() => setDismissed((d) => new Set(d).add(firstClash.id))}>
          <span className="tf-bkf__banner">
            <span>{firstClash.title} on {formatDay(firstClash.start)} clashes with {firstClash.host === HOST ? 'your' : `${first(firstClash.host)}'s`} calendar{clashes.length > 1 ? `, and ${plural(clashes.length - 1, 'other meeting')} too` : ''}.</span>
            <Link onPress={() => props.onSeeConflict(firstClash)} weight="strong">See conflict</Link>
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
  // The list: bookings and calendar events in one run, in the order picked, a page at a time.
  const rowsOf = (r: Range): ReadonlyArray<Meeting> => {
    const base = shown(r === 'upcoming' ? lists.upcoming.slice(nextUp ? 1 : 0) : lists[r]);
    const cal = r === 'cancelled' ? [] : events.map(asRow).filter((e) => (r === 'upcoming' ? e.end > now : e.end <= now));
    const forward = (a: Meeting, b: Meeting) => a.start.getTime() - b.start.getTime();
    const natural = [...base, ...cal].sort(r === 'upcoming' ? forward : (a, b) => -forward(a, b));
    return order === 'forward' ? natural : [...natural].reverse();
  };
  const allRows = rowsOf(range);
  const listRows = allRows.slice(0, shownCount);
  const orderLabels: Readonly<Record<Order, string>> = range === 'upcoming' ? { forward: 'Soonest first', back: 'Latest first' } : { forward: 'Most recent first', back: 'Oldest first' };
  const activePages = state.pages.filter((p) => !p.linkKind && p.kind !== 'table');
  const filterCount = pageIds.size + (source !== 'all' ? 1 : 0);
  const openRow = (id: string) => { if (id.startsWith('cal:')) setAbout(calendarEvents(state).find((e) => e.id === id)); else props.onOpen(id); };

  return (
    <div className="tf-bkf__meetings" data-view={view}>
      <TabToolbar
        start={<>
          <SegmentedControl aria-label="View" selectedKey={view} onSelectionChange={onView}
            items={[{ id: 'list', label: 'List', icon: <LayoutList {...i14} /> }, { id: 'day', label: 'Day', icon: <CalendarDays {...i14} /> }, { id: 'week', label: 'Week', icon: <CalendarRange {...i14} /> }, { id: 'team', label: 'Team day', icon: <Users {...i14} /> }]} />
          {view !== 'team' && <Select label="Whose meetings" isLabelHidden className="tf-bkf__whose" items={whoseItems} value={whose} onChange={(v) => { if (v) onWhose(v); }} />}
          {view === 'list' && <Select label="Which meetings" isLabelHidden className="tf-bkf__whose" value={range} onChange={(k) => { if (k) setRange(k as Range); }}
            items={[{ id: 'upcoming', label: `Upcoming · ${lists.upcoming.length + requests.length}` }, { id: 'past', label: `Past · ${lists.past.length}` }, { id: 'cancelled', label: `Cancelled · ${lists.cancelled.length}` }]} />}
          {view !== 'team' && (
            <MenuTrigger>
              <Button size="md" variant={filterCount ? 'secondary' : 'ghost'} icon={<ListFilter {...i14} />}>{filterCount ? `Filter · ${filterCount}` : 'Filter'}</Button>
              <Menu aria-label="Filter meetings" placement="bottom start">
                <MenuSection title="Show" selectionMode="single" selectedKeys={[source]} onSelectionChange={(k) => { const v = [...(k as Set<Key>)][0]; if (v) setSource(v as Source); }}>
                  <MenuItem id="all">Everything</MenuItem>
                  <MenuItem id="bookings">Bookings only</MenuItem>
                  <MenuItem id="calendar">Calendar events only</MenuItem>
                </MenuSection>
                <MenuSection title="Booking page" selectionMode="multiple" selectedKeys={pageIds} onSelectionChange={(k) => setPageIds(new Set([...(k as Set<Key>)].map(String)))}>
                  {activePages.map((p) => <MenuItem key={p.id} id={p.id} icon={<PageDot hue={p.accent} />}>{p.name}</MenuItem>)}
                </MenuSection>
              </Menu>
            </MenuTrigger>
          )}
          {view === 'list' && (
            <MenuTrigger>
              <Button size="md" variant="ghost" icon={<ArrowDownUp {...i14} />} aria-label={`Sort: ${orderLabels[order]}. Change`}>{orderLabels[order]}</Button>
              <Menu aria-label="Sort" placement="bottom start">
                <MenuSection selectionMode="single" selectedKeys={[order]} onSelectionChange={(k) => { const v = [...(k as Set<Key>)][0]; if (v) setOrder(v as Order); }}>
                  <MenuItem id="forward">{orderLabels.forward}</MenuItem>
                  <MenuItem id="back">{orderLabels.back}</MenuItem>
                </MenuSection>
              </Menu>
            </MenuTrigger>
          )}
          {filterCount > 0 && view !== 'team' && <Button size="md" variant="ghost" onPress={() => { setPageIds(new Set()); setSource('all'); }}>Clear filters</Button>}
        </>}
        action={<span className="tf-row">
          {view !== 'team' && <Button variant={calsOpen ? 'secondary' : 'ghost'} icon={<PanelRight {...i14} />} aria-expanded={calsOpen} onPress={() => setCalsOpen((o) => !o)}>Calendars</Button>}
          <Button variant="primary" icon={<CalendarPlus {...i14} />} onPress={() => props.onNewMeeting()}>New meeting</Button>
        </span>} />
      <div className={cx('tf-bkf-meetbody', calsOpen && view !== 'team' && 'has-aside')}>
        <div className="tf-bkf-meetbody__main">
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
              {filtersOn && allRows.length === 0 && (range !== 'upcoming' || requests.length === 0) ? (
                <EmptyState size="sm" icon={<ListFilter size={20} strokeWidth={1.75} />} title="Nothing matches these filters" action={<Button size="sm" onPress={() => { setPageIds(new Set()); setSource('all'); }}>Clear filters</Button>} />
              ) : (
                <MeetingList isFullWidth meetings={listRows} requests={range === 'upcoming' ? shown(requests) : []} now={now} highlightId={fresh} conflictIds={new Set(clashes.map((m) => m.id))} onOpen={(m) => openRow(m.id)}
                  onCancel={props.onCancel} onUndoCancel={props.onUndoCancel} onReschedule={(m) => props.onReschedule(m.id)} onNoShow={(m) => props.onNoShow(m.id)}
                  onConfirm={(m) => props.onConfirm(m.id)} onDecline={(m) => props.onDecline(m.id)}
                  onNote={(m) => props.onOpen(m.id)} onCopyLink={(m) => { void copyText(`https://timefix.com/m/${m.id.slice(-6)}`).then((ok) => toast(ok ? { message: 'Meeting link copied', tone: 'success' } : { message: `Copy didn’t work. Select the link and copy it: ${`https://timefix.com/m/${m.id.slice(-6)}`}`, tone: 'danger' })); }}
                  emptyAction={range === 'upcoming' ? <Button size="sm" onPress={props.onCopyFirstLink}>Copy booking link</Button> : undefined} />
              )}
              {allRows.length > listRows.length && (
                <div className="tf-bkf-more"><Button variant="secondary" onPress={() => setShownCount((n) => n + PAGE_SIZE)}>Show more</Button><span className="tf-bkf__muted tf-num">{listRows.length} of {allRows.length}</span></div>
              )}
            </>
          )}
          {(view === 'week' || view === 'day') && <WeekView {...props} scoped={scoped.filter((m) => m.status !== 'cancelled')} events={events} mode={view} dayAt={dayAt} onDayAt={setDayAt} onAbout={setAbout} />}
          {view === 'team' && <TeamDay state={state} week={props.week} onWeek={props.onWeek} onOpen={props.onOpen} onReassignMany={props.onReassignMany}
            menu={(p, close) => <PickedMenu picked={p} close={close} state={state} onBook={() => props.onNewMeeting(p)} onQuick={props.onQuickMeeting ? (who) => props.onQuickMeeting?.(quickInput(state, p, who)) : undefined}
              onBlock={(weekly) => props.onBlock({ id: nextId('blk'), member: p.member, day: isoDay(p.day), start: p.start, end: p.end, kind: 'block', label: 'Blocked', weekly })}
              onHold={(forPage) => props.onHold(p, forPage)} onTimeOff={() => props.onTimeOff(p)} />} />}
        </div>
        {calsOpen && view !== 'team' && <CalendarsAside state={state} hidden={hiddenCals} onHidden={setHiddenCals} />}
      </div>
      <AboutEventDialog event={about} onClose={() => setAbout(undefined)} />
    </div>
  );
}

/** A page's colour as a small dot, before its name in a menu. */
function PageDot({ hue }: { readonly hue: string }) {
  return <span className="tf-bkf-pagedot" data-hue={hue} aria-hidden="true" />;
}

/** The calendars side panel: show or hide Bookings and each connected calendar on the list, the day and the week. */
function CalendarsAside({ state, hidden, onHidden }: { readonly state: BookingsState; readonly hidden: ReadonlySet<string>; readonly onHidden: (s: ReadonlySet<string>) => void }) {
  const flip = (id: string, on: boolean) => { const n = new Set(hidden); if (on) n.delete(id); else n.add(id); onHidden(n); };
  return (
    <aside className="tf-bkf-cals" aria-label="Calendars">
      <span className="tf-bkf__label">Calendars</span>
      <Checkbox isSelected={!hidden.has('bookings')} onChange={(on) => flip('bookings', on)}><span className="tf-bkf-cals__name"><LogoMark size={12} />Bookings</span></Checkbox>
      {state.calendars.map((a) => (
        <div key={a.id} className="tf-bkf-cals__account">
          <span className="tf-bkf-cals__email">{a.email}</span>
          {a.status === 'reconnect' ? <span className="tf-bkf__muted">Needs reconnect</span> : (state.subCalendars?.[a.id] ?? []).map((c) => (
            <Checkbox key={c.id} isSelected={!hidden.has(c.id)} onChange={(on) => flip(c.id, on)}><span className="tf-bkf-cals__name"><PageDot hue={c.colour} />{c.name}</span></Checkbox>
          ))}
        </div>
      ))}
      {state.calendars.length === 0 && <p className="tf-bkf__muted">No calendar connected.</p>}
    </aside>
  );
}


/** "1 hr 30 min", "45 min", "2 hr". */
function lengthLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** What a dragged span of the week can become: the time on top, then plain actions. Block and Reserve open a short step for how often and which page. Picking one closes it. */
function PickedMenu({ picked, close, state, onBook, onBlock, onHold, onTimeOff, onQuick }: { readonly picked: PickedTime; readonly close: () => void; readonly state: BookingsState; readonly onBook: () => void; readonly onBlock: (weekly: boolean) => void; readonly onHold: (forPage?: string) => void; readonly onTimeOff: () => void; readonly onQuick?: (who: RecordRef) => void }) {
  const run = (fn: () => void) => { close(); window.setTimeout(fn, 150); };
  const [who, setWho] = useState<RecordRef>();
  const [step, setStep] = useState<'menu' | 'block' | 'hold'>('menu');
  const [often, setOften] = useState<'once' | 'weekly'>('once');
  const linkOnly = state.pages.filter((p) => p.visibility === 'link' && p.isOn);
  const [forPage, setForPage] = useState('any');
  const weekday = picked.day.toLocaleDateString('en-GB', { weekday: 'long' });
  const head = (
    <div className="tf-bkf-pickmenu__head">
      <span className="tf-bkf-pickmenu__time tf-num">{formatClockRange(picked.start, picked.end)}</span>
      <span className="tf-bkf-pickmenu__sub tf-num">{picked.member !== HOST ? `${first(picked.member)} · ` : ''}{formatLongDay(picked.day)} · {lengthLabel(picked.end - picked.start)}</span>
    </div>
  );
  if (step === 'block') return (
    <div className="tf-bkf-pickmenu">
      {head}
      <div className="tf-bkf-pickmenu__quick">
        <RadioGroup label="How often" value={often} onChange={(v) => setOften(v === 'weekly' ? 'weekly' : 'once')}>
          <Radio value="once">Just this {weekday}</Radio>
          <Radio value="weekly">Every {weekday}</Radio>
        </RadioGroup>
        <p className="tf-bkf__muted">{picked.member === HOST ? 'Only you see this.' : `Only you, ${first(picked.member)} and whoever manages ${first(picked.member)}’s scheduling see this.`}</p>
        <div className="tf-bkf-pickmenu__acts"><Button size="sm" variant="ghost" onPress={() => setStep('menu')}>Back</Button><Button size="sm" variant="primary" onPress={() => run(() => onBlock(often === 'weekly'))}>Block it</Button></div>
      </div>
    </div>
  );
  if (step === 'hold') return (
    <div className="tf-bkf-pickmenu">
      {head}
      <div className="tf-bkf-pickmenu__quick">
        {linkOnly.length === 0 ? <p className="tf-bkf__muted">Time only your link only pages can book. You have none yet.</p> : (
          <Select label="For" value={forPage} onChange={(v) => setForPage(v ?? 'any')} items={[{ id: 'any', label: 'Any link only page' }, ...linkOnly.map((p) => ({ id: p.id, label: p.name }))]} />
        )}
        <p className="tf-bkf__muted">Only your link only pages can book it.</p>
        <div className="tf-bkf-pickmenu__acts"><Button size="sm" variant="ghost" onPress={() => setStep('menu')}>Back</Button><Button size="sm" variant="primary" isDisabled={linkOnly.length === 0} onPress={() => run(() => onHold(forPage === 'any' ? undefined : forPage))}>Reserve it</Button></div>
      </div>
    </div>
  );
  return (
    <div className="tf-bkf-pickmenu">
      {head}
      {/* Quick create (Totoro's week): who it's with, then Book; anything more opens the full dialog. */}
      {onQuick && <div className="tf-bkf-pickmenu__quick">
        {who ? <div className="tf-bkf__record"><span className="tf-bkf__muted">With</span><strong>{who.name}</strong><span className="tf-bkf__spacer" /><Button size="sm" variant="ghost" onPress={() => setWho(undefined)}>Change</Button></div>
          : <ReferencePicker label="With" placeholder="Search People…" recent={PEOPLE.filter((p) => p.kind === 'person').slice(0, 3)} search={searchOnlyPeople} onSelect={setWho} onCreate={(name) => setWho({ id: nextId('r'), name, kind: 'person' })} />}
        <div className="tf-bkf-pickmenu__acts"><Button size="sm" variant="ghost" onPress={() => run(onBook)}>More options</Button><Button size="sm" variant="primary" isDisabled={!who} onPress={() => { if (who) { const w = who; run(() => onQuick(w)); } }}>Book</Button></div>
      </div>}
      <MenuList aria-label="Use this time" onAction={(k: Key) => {
        if (k === 'book') run(onBook);
        else if (k === 'block') setStep('block');
        else if (k === 'hold') setStep('hold');
        else if (k === 'off') run(onTimeOff);
      }}>
        {!onQuick && <MenuItem id="book" icon={<UserPlus {...i16} />}>Book someone in</MenuItem>}
        <MenuItem id="block" icon={<Ban {...i16} />}>Block this time</MenuItem>
        <MenuItem id="hold" icon={<Hand {...i16} />} description="Only link only pages can book it">Reserve for link only pages</MenuItem>
        <MenuItem id="off" icon={<CalendarOff {...i16} />}>Time off</MenuItem>
      </MenuList>
    </div>
  );
}

/** A picked span booked as is: its own length, the first live page's place (or a video call), the host it was picked under. */
function quickInput(state: BookingsState, p: PickedTime, who: RecordRef): NewMeetingInput {
  const page = state.pages.find((x) => x.isOn && x.kind !== 'table');
  return { pageId: undefined, length: p.end - p.start, day: p.day, start: p.start, with: who, guests: [], place: page ? placeOf(page) : 'meet', host: p.member };
}

/** Week or Day view: bookings, your calendar's events (open to read), blocks and reserved time (open to remove); drag empty time to pick it. */
function WeekView(props: MeetingsTabProps & { readonly scoped: ReadonlyArray<BookedMeeting>; readonly events: ReadonlyArray<CalendarEvent>; readonly mode: 'week' | 'day'; readonly dayAt: Date; readonly onDayAt: (d: Date) => void; readonly onAbout: (e: CalendarEvent) => void }) {
  const { state, week, onWeek, focusHour, scoped, whose, mode, dayAt, onDayAt } = props;
  const now = new Date();
  const monday = mondayOf(now);
  monday.setDate(monday.getDate() + week * 7);
  // Weekends show when the week has something on them.
  const weekend = [5, 6].some((n) => scoped.some((m) => m.start.toDateString() === dayFrom(monday, n).toDateString()));
  const days = mode === 'day' ? [dayAt] : Array.from({ length: weekend ? 7 : 5 }, (_, n) => dayFrom(monday, n));
  const member = whose === 'mine' || whose === 'everyone' ? HOST : whose;
  const [removing, setRemoving] = useState<{ readonly block: TimeBlock; readonly every: boolean; readonly date: string }>();
  const blocks = state.blocks.filter((b) => whose === 'everyone' || b.member === member);
  const pageName = (id: string | undefined) => state.pages.find((p) => p.id === id)?.name;
  const evs: WeekEvent[] = [
    ...scoped.flatMap((m) => {
      const day = days.findIndex((d) => d.toDateString() === m.start.toDateString());
      return day === -1 ? [] : [{ id: m.id, title: whose === 'mine' ? m.title : `${m.title} · ${first(m.host)}`, day, start: minutesOf(m.start), end: minutesOf(m.end), kind: m.place === 'in-person' ? 'in-person' as const : 'meeting' as const, guests: [m.invitee.name], location: m.placeLabel, mark: <LogoMark size={12} /> }];
    }),
    ...days.flatMap((d, day) => blocks.filter((b) => blockOnDay(b, d)).map((b) => ({ id: `${b.id}@${isoDay(d)}`, title: b.kind === 'hold' ? (b.label === 'Held' ? 'Reserved time' : b.label) : b.label, day, start: b.start, end: b.end, kind: 'internal' as const }))),
    ...props.events.flatMap((e) => {
      const day = days.findIndex((d) => d.toDateString() === e.day.toDateString());
      return day === -1 || whose !== 'mine' && whose !== 'everyone' ? [] : [{ id: e.id, title: e.title, day, start: e.start, end: e.end, kind: 'calendar' as const, isLocked: true }];
    }),
  ];
  // Teammates' calendars show as busy time only.
  const busy: WeekBusy[] = member !== HOST ? days.flatMap((d, day) => busyOn(state, member, d).filter((b) => b.kind === 'calendar').map((b) => ({ id: `${b.id}-${day}`, day, start: b.start, end: b.end, source: b.source }))) : [];
  const todayIndex = days.findIndex((d) => d.toDateString() === now.toDateString());
  const startHour = focusHour === undefined ? HOUR_FROM : Math.max(0, Math.min(focusHour - 1, 12));
  const endHour = Math.min(24, Math.max(startHour + 12, HOUR_TO));
  const first0 = days[0] ?? now;
  const last = days[days.length - 1] ?? now;
  const blockOf = (evId: string) => state.blocks.find((b) => b.id === evId.split('@')[0]);
  const goTo = (d: Date) => { if (mode === 'day') onDayAt(d); else onWeek(Math.round((mondayOf(d).getTime() - mondayOf(now).getTime()) / (7 * 86_400_000))); };
  const isNow = mode === 'day' ? dayAt.toDateString() === now.toDateString() : week === 0;
  return (
    <div className="tf-bkf__stack tf-bkf__stack--12 tf-bkf__calfill">
      <div className="tf-bkf__bar">
        <span className="tf-bkf__weeknav">
          <IconButton size="sm" label={mode === 'day' ? 'Previous day' : 'Previous week'} onPress={() => (mode === 'day' ? onDayAt(dayFrom(dayAt, -1)) : onWeek(week - 1))}><ChevronLeft {...i16} /></IconButton>
          <span className="tf-num" aria-live="polite">{mode === 'day' ? formatLongDay(dayAt) : `${formatDay(first0)} – ${formatDay(last)}`}</span>
          <IconButton size="sm" label={mode === 'day' ? 'Next day' : 'Next week'} onPress={() => (mode === 'day' ? onDayAt(dayFrom(dayAt, 1)) : onWeek(week + 1))}><ChevronRight {...i16} /></IconButton>
          {!isNow && <Button size="sm" variant="ghost" onPress={() => goTo(now)}>{mode === 'day' ? 'Today' : 'This week'}</Button>}
        </span>
        <span className="tf-bkf__spacer" />
        <GoToDate value={mode === 'day' ? dayAt : first0} onPick={goTo} />
      </div>
      <WeekCalendar days={days.map((d, n) => ({ weekday: formatDay(d).split(' ')[0] ?? '', date: d.getDate(), label: formatLongDay(d), isToday: n === todayIndex }))}
        events={evs} busy={busy} startHour={startHour} endHour={endHour} now={todayIndex >= 0 ? { day: todayIndex, minutes: minutesOf(now) } : undefined}
        eventDetails={(ev, close) => {
          if (ev.kind === 'calendar') { const e = props.events.find((x) => x.id === ev.id); return e ? <EventAbout event={e} /> : undefined; }
          const b = blockOf(ev.id);
          if (!b) return undefined;
          const weekday = parseDay(b.day).toLocaleDateString('en-GB', { weekday: 'long' });
          return (
            <div className="tf-bkf__stack tf-bkf__stack--8">
              <dl className="tf-bkf-blockfacts">
                <dt>Why</dt><dd>{b.kind === 'hold' ? `Reserved time${b.forPage ? ` for ${pageName(b.forPage) ?? 'a page'}` : ''}` : 'Blocked'}</dd>
                <dt>Repeats</dt><dd>{b.weekly ? `Every ${weekday}` : 'Doesn’t repeat'}</dd>
              </dl>
              <p className="tf-bkf__muted">{b.kind === 'hold' ? 'Only your link only pages can book it.' : 'None of your pages offers this time.'}</p>
              <div className="tf-week__pop-actions">
                <Button size="sm" variant="secondary" onPress={() => { close(); window.setTimeout(() => setRemoving({ block: b, every: false, date: ev.id.split('@')[1] ?? b.day }), 150); }}>{b.kind === 'hold' ? 'Release' : 'Remove'}</Button>
                {b.weekly && <Button size="sm" variant="ghost" onPress={() => { close(); window.setTimeout(() => setRemoving({ block: b, every: true, date: b.day }), 150); }}>Remove every {weekday}</Button>}
              </div>
            </div>
          );
        }}
        selectionMenu={(sel: WeekSelection, close) => {
          const d = days[sel.day];
          if (!d) return null;
          const picked: PickedTime = { member, day: d, start: sel.start, end: sel.end };
          return <PickedMenu picked={picked} close={close} state={state} onBook={() => props.onNewMeeting(picked)} onQuick={props.onQuickMeeting ? (who) => props.onQuickMeeting?.(quickInput(state, picked, who)) : undefined}
            onBlock={(weekly) => props.onBlock({ id: nextId('blk'), member, day: isoDay(d), start: sel.start, end: sel.end, kind: 'block', label: 'Blocked', weekly })}
            onHold={(forPage) => props.onHold(picked, forPage)} onTimeOff={() => props.onTimeOff(picked)} />;
        }}
        onJoin={(ev) => props.onJoin(ev.id)} onReschedule={(ev) => props.onReschedule(ev.id)}
        onEventChange={(ev, next) => {
          const d = days[next.day];
          if (!d) return;
          const block = blockOf(ev.id);
          if (block) props.onMoveBlock({ ...block, day: isoDay(d), start: next.start, end: next.end });
          else props.onMove(ev.id, d, next.start, next.end);
        }} />
      {removing && (() => {
        const b = removing.block; const weekday = parseDay(b.day).toLocaleDateString('en-GB', { weekday: 'long' }); const label = b.label === 'Blocked' || b.label === 'Held' ? undefined : b.label;
        const hold = b.kind === 'hold';
        return <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) setRemoving(undefined); }}
          title={hold ? (label ? `Release “${label}”?` : 'Release this reserved time?') : b.weekly && removing.every ? (label ? `Remove the weekly “${label}” block?` : 'Remove this weekly block?') : (label ? `Remove the “${label}” block?` : 'Remove this block?')}
          consequence={hold ? `${formatDay(parseDay(removing.date))}, ${formatClockRange(b.start, b.end)}, opens to every booking page again. This can’t be undone.` : b.weekly && removing.every ? `Every ${weekday}, ${formatClockRange(b.start, b.end)}, opens for booking again. This can’t be undone.` : `${formatDay(parseDay(removing.date))}, ${formatClockRange(b.start, b.end)}, opens for booking again. This can’t be undone.`}
          confirmLabel={hold ? 'Release reserved time' : 'Remove block'} onConfirm={() => { props.onRemoveBlock(b, removing.every, removing.date); setRemoving(undefined); }} />;
      })()}
    </div>
  );
}

/** Go to date: a small month in a popover; picking a day moves the view there. */
function GoToDate({ value, onPick }: { readonly value: Date; readonly onPick: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" icon={<CalendarSearch {...i14} />}>Go to date</Button>
      <Popover label="Go to date" placement="bottom end" offset={6}>
        <div className="tf-bkf-goto">
          <Calendar aria-label="Go to date" value={parseDate(isoDay(value))} onChange={(d: CalendarDate) => { onPick(new Date(d.year, d.month - 1, d.day)); setOpen(false); }} />
        </div>
      </Popover>
    </DialogTrigger>
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
  const weekend = [5, 6].some((n) => state.meetings.some((m) => m.status !== 'cancelled' && m.start.toDateString() === dayFrom(monday, n).toDateString()));
  const days = Array.from({ length: weekend ? 7 : 5 }, (_, n) => dayFrom(monday, n));
  const [kb, setKb] = useState<{ readonly member: string; readonly at: number; readonly len: number }>();
  const [dayId, setDayId] = useState(() => isoDay(days.find((d) => d.toDateString() === now.toDateString()) ?? days[0] ?? now));
  const day = days.find((d) => isoDay(d) === dayId) ?? days[0] ?? now;
  const [drag, setDrag] = useState<{ readonly member: string; readonly a: number; readonly b: number }>();
  const dragging = useRef(false);
  useEffect(() => { if (!days.some((d) => isoDay(d) === dayId)) setDayId(isoDay(days[0] ?? now)); }, [week]); // eslint-disable-line react-hooks/exhaustive-deps
  // The grid reaches the day's earliest and latest meeting, never cutting one off (8:00 to 20:00 at least).
  const onDay = state.meetings.filter((m) => m.status !== 'cancelled' && m.start.toDateString() === day.toDateString());
  const from = Math.min(HOUR_FROM, ...onDay.map((m) => Math.floor(minutesOf(m.start) / 60)));
  const to = Math.max(HOUR_TO, ...onDay.map((m) => Math.min(24, Math.ceil((minutesOf(m.end) || 1440) / 60))));
  const total = (to - from) * 60;
  const pct = (m: number) => `${((m - from * 60) / total) * 100}%`;
  const len = (a: number, b: number) => `${((b - a) / total) * 100}%`;
  const minuteAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(to * 60 - 15, Math.max(from * 60, from * 60 + Math.floor(((e.clientY - r.top) / r.height) * total / 15) * 15));
  };
  const counts = (d: Date) => state.meetings.filter((m) => m.status !== 'cancelled' && m.start.toDateString() === d.toDateString()).length;
  // The people who take bookings here: a salon's or restaurant's staff, else the team.
  const allStaff: ReadonlyArray<string> = state.business ? [...new Set(state.pages.filter((p) => p.kind !== 'table').flatMap((p) => p.hosts))] : TEAM;
  // Filters: pick people, only those with bookings that day, ordered by name (you first) or by job title.
  const [people, setPeople] = useState<ReadonlySet<string>>(new Set());
  const [onlyBooked, setOnlyBooked] = useState(false);
  const [order, setOrder] = useState<'name' | 'title'>('name');
  const titleOf = (n: string) => state.business?.titles?.[n] ?? JOB_TITLES[n] ?? '';
  const staff: ReadonlyArray<string> = allStaff
    .filter((n) => (people.size === 0 || people.has(n)) && (!onlyBooked || state.meetings.some((m) => isWith(m, n) && m.status !== 'cancelled' && m.start.toDateString() === day.toDateString())))
    .slice().sort((a, b) => (order === 'title' ? titleOf(a).localeCompare(titleOf(b)) || a.localeCompare(b) : a === HOST ? -1 : b === HOST ? 1 : a.localeCompare(b)));
  const filterCount = people.size + (onlyBooked ? 1 : 0);
  // The day's issues: meetings outside their host's hours, clashes (with another meeting or busy time), and ones whose host left.
  const dayMeetings = state.meetings.filter((m) => m.status !== 'cancelled' && m.start.toDateString() === day.toDateString());
  const outside = dayMeetings.filter((m) => !m.hostLeft && !isOff(state, m.host, day) && (() => { const h = hoursOn(state, m.host, day).hours; return !h.on || !h.ranges.some((r) => r.start <= minutesOf(m.start) && minutesOf(m.end) <= r.end); })());
  const clashing = dayMeetings.filter((m) => !m.hostLeft && (dayMeetings.some((o) => o.id !== m.id && isWith(o, m.host) && o.start < m.end && m.start < o.end) || busyOn(state, m.host, day).some((b) => b.start < minutesOf(m.end) && minutesOf(m.start) < b.end)));
  const hostless = dayMeetings.filter((m) => m.hostLeft);
  const issueCount = outside.length + clashing.length + hostless.length;
  const isToday = day.toDateString() === now.toDateString();
  const nowAt = minutesOf(now);
  const doneToday = onDay.filter((m) => m.status === 'completed' || (m.status === 'confirmed' && m.end < now)).length;
  /** How a booking reads in its block: tint and chip by where it stands. */
  const standing = (m: BookedMeeting): { readonly key: string; readonly label: string } => m.status === 'pending' ? { key: 'pending', label: 'To confirm' } : m.status === 'no-show' ? { key: 'noshow', label: 'No-show' } : m.status === 'completed' ? { key: 'done', label: 'Done' } : m.startedAt ? { key: 'now', label: 'In progress' } : m.arrivedAt ? { key: 'now', label: 'Here' } : m.end < now ? { key: 'done', label: 'Done' } : m.start <= now && now < m.end ? { key: 'now', label: 'Now' } : { key: 'booked', label: 'Booked' };
  return (
    <div className="tf-bkf__stack tf-bkf__stack--12 tf-bkf__calfill">
      <div className="tf-bkf__bar">
        <p className="tf-bkf-team__total tf-num"><strong>{onDay.length}</strong> {onDay.length === 1 ? 'booking' : 'bookings'} {isToday ? 'today' : `on ${formatLongDay(day)}`}{doneToday ? ` · ${doneToday} done` : ''}</p>
        <span className="tf-bkf__spacer" />
        {issueCount > 0 && (
          <MenuTrigger>
            <Button size="sm" variant="secondary" icon={<AlertTriangle {...i14} />}>{plural(issueCount, 'issue')}</Button>
            <Menu aria-label="The day’s issues" placement="bottom end" onAction={(k: Key) => onOpen(String(k).split(':')[1] ?? '')}>
              {outside.length > 0 && <MenuSection title="Outside their hours">{outside.map((m) => <MenuItem key={`o:${m.id}`} id={`o:${m.id}`} description={`${formatClockRange(minutesOf(m.start), minutesOf(m.end))}`}>{m.title} · {first(m.host)}</MenuItem>)}</MenuSection>}
              {clashing.length > 0 && <MenuSection title="Clashes">{clashing.map((m) => <MenuItem key={`c:${m.id}`} id={`c:${m.id}`} description={`${formatClockRange(minutesOf(m.start), minutesOf(m.end))}`}>{m.title} · {first(m.host)}</MenuItem>)}</MenuSection>}
              {hostless.length > 0 && <MenuSection title="Needs a host">{hostless.map((m) => <MenuItem key={`h:${m.id}`} id={`h:${m.id}`} description={`${formatClockRange(minutesOf(m.start), minutesOf(m.end))} · ${m.host} left`}>{m.title} · {m.invitee.name}</MenuItem>)}</MenuSection>}
            </Menu>
          </MenuTrigger>
        )}
        <MenuTrigger>
          <Button size="sm" variant={filterCount ? 'secondary' : 'ghost'} icon={<Users {...i14} />}>{filterCount ? `People · ${filterCount}` : 'People'}</Button>
          <Menu aria-label="People" placement="bottom end">
            <MenuSection title="People" selectionMode="multiple" selectedKeys={people} onSelectionChange={(k) => setPeople(new Set([...(k as Set<Key>)].map(String)))}>
              {allStaff.map((n) => <MenuItem key={n} id={n} icon={<Avatar name={n} size={20} />} description={titleOf(n) || undefined}>{n === HOST ? `${n} (you)` : n}</MenuItem>)}
            </MenuSection>
            <MenuSection selectionMode="multiple" selectedKeys={onlyBooked ? ['booked'] : []} onSelectionChange={(k) => setOnlyBooked((k as Set<Key>).has('booked'))}>
              <MenuItem id="booked">Only people with bookings</MenuItem>
            </MenuSection>
            <MenuSection title="Order" selectionMode="single" selectedKeys={[order]} onSelectionChange={(k) => setOrder((k as Set<Key>).has('title') ? 'title' : 'name')}>
              <MenuItem id="name">Me first, then by name</MenuItem>
              <MenuItem id="title">By job title</MenuItem>
            </MenuSection>
          </Menu>
        </MenuTrigger>
      </div>
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
      {staff.length === 0 ? <EmptyState size="sm" icon={<Users size={20} strokeWidth={1.75} />} title="Nobody matches these filters" action={<Button size="sm" onPress={() => { setPeople(new Set()); setOnlyBooked(false); }}>Clear filters</Button>} /> :
      <div className="tf-bkf-team" style={{ '--tf-bkf-cols': staff.length, '--tf-bkf-hours': to - from } as React.CSSProperties}>
        <div className="tf-bkf-team__head">
          <span />
          {staff.map((name) => { const n = onDay.filter((m) => isWith(m, name)).length; return <span key={name} className="tf-bkf-team__who"><Avatar name={name} size={28} /><span className="tf-bkf-team__whotext"><strong>{name}</strong><span className="tf-bkf__muted tf-num">{isOff(state, name, day) ? 'Away' : `${plural(n, 'booking')}`}{order === 'title' && titleOf(name) ? ` · ${titleOf(name)}` : ''}</span></span></span>; })}
        </div>
        <div className="tf-bkf-team__scroll">
        <div className="tf-bkf-team__body">
          <div className="tf-bkf-team__gutter" aria-hidden="true">
            {Array.from({ length: to - from }, (_, n) => <span key={n} style={{ top: pct((from + n) * 60) }}>{formatClock((from + n) * 60).replace(":00", "")}</span>)}
          </div>
          {staff.map((name, colIndex) => {
            const off = isOff(state, name, day);
            // Their working hours: gaps between ranges are breaks; before and after is time they don't work.
            const h = hoursOn(state, name, day).hours;
            const ranges = h.on ? [...h.ranges].sort((a, b) => a.start - b.start) : [];
            const breaks = ranges.slice(1).map((r, n) => ({ start: ranges[n]?.end ?? r.start, end: r.start })).filter((b) => b.end > b.start);
            const closed = off ? [] : ranges.length === 0 ? [{ start: from * 60, end: to * 60 }] : [{ start: from * 60, end: Math.max(from * 60, ranges[0]?.start ?? from * 60) }, { start: Math.min(to * 60, ranges[ranges.length - 1]?.end ?? to * 60), end: to * 60 }].filter((c) => c.end > c.start);
            const meetings = state.meetings.filter((m) => isWith(m, name) && m.status !== 'cancelled' && m.start.toDateString() === day.toDateString());
            const busy = busyOn(state, name, day);
            const sel = drag?.member === name ? { start: Math.min(drag.a, drag.b), end: Math.max(drag.a, drag.b) + 15 } : undefined;
            return (
              <div key={name} className="tf-bkf-team__col" tabIndex={0} role="group"
                aria-label={`${name}, ${formatLongDay(day)}. ${plural(meetings.length, 'meeting')}. Up and Down move the time, Shift with Up and Down changes the length, Enter picks it.`}
                aria-description={kb?.member === name ? formatClockRange(kb.at, kb.at + kb.len) : undefined}
                onBlur={() => setKb(undefined)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const at0 = kb?.member === name ? kb.at : 9 * 60; const len0 = kb?.member === name ? kb.len : 30;
                  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.shiftKey) { e.preventDefault(); setKb({ member: name, at: at0, len: Math.min(to * 60 - at0, Math.max(15, len0 + (e.key === 'ArrowDown' ? 15 : -15))) }); }
                  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setKb({ member: name, len: len0, at: Math.min(to * 60 - len0, Math.max(from * 60, at0 + (e.key === 'ArrowDown' ? 30 : -30))) }); }
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick({ member: name, day, start: at0, end: at0 + len0 }); }
                }}
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
                {Array.from({ length: to - from }, (_, n) => <span key={n} className="tf-bkf-team__line" style={{ top: pct((from + n) * 60) }} aria-hidden="true" />)}
                {off && <span className="tf-bkf-team__off" style={{ top: 0, height: '100%' }}>{off.note || 'Time off'}</span>}
                {closed.map((c) => <span key={`c${c.start}`} className="tf-bkf-team__closed" style={{ top: pct(c.start), height: len(c.start, c.end) }} aria-hidden="true">{c.end - c.start >= 60 ? 'Not working' : ''}</span>)}
                {breaks.map((b) => <span key={`b${b.start}`} className="tf-bkf-team__break" style={{ top: pct(b.start), height: len(b.start, b.end) }} aria-hidden="true">Break</span>)}
                {isToday && nowAt >= from * 60 && nowAt <= to * 60 && <span className="tf-bkf-team__now" style={{ top: pct(nowAt) }} aria-hidden="true">{colIndex === 0 && <span className="tf-bkf-team__nowpill tf-num">{formatClock(nowAt)}</span>}</span>}
                {busy.map((b) => <span key={b.id} className={cx('tf-bkf-team__busy', b.kind !== 'calendar' && 'tf-bkf-team__busy--own')} style={{ top: pct(b.start), height: len(b.start, b.end) }}>{b.source.split(' · ')[0]}</span>)}
                {meetings.map((m) => { const st = standing(m); const mins = (m.end.getTime() - m.start.getTime()) / 60_000; return (
                  <button key={m.id} type="button" className={cx('tf-bkf-team__event', m.status === 'pending' && 'is-pending')} data-standing={st.key} style={{ top: pct(minutesOf(m.start)), height: len(minutesOf(m.start), minutesOf(m.end)) }}
                    onClick={() => onOpen(m.id)} aria-label={`${m.invitee.name}, ${m.title}, ${formatClockRange(minutesOf(m.start), minutesOf(m.end))}, ${st.label}`}>
                    <span className="tf-bkf-team__evtop"><span className="tf-bkf-team__event-title">{m.invitee.name}</span>{mins >= 45 && <span className="tf-bkf-team__chip">{st.label}</span>}</span>
                    <span className="tf-num tf-bkf-team__evtime">{formatClock(minutesOf(m.start))} › {formatClock(minutesOf(m.end))}</span>
                    {mins >= 60 && <span className="tf-bkf-team__svc">{m.title}</span>}
                  </button>
                ); })}
                {sel && <span className="tf-bkf-team__sel" style={{ top: pct(sel.start), height: len(sel.start, sel.end) }} aria-hidden="true" />}
                {!sel && kb?.member === name && <span className="tf-bkf-team__sel" style={{ top: pct(kb.at), height: len(kb.at, kb.at + kb.len) }} aria-hidden="true" />}
                {!sel && held?.member === name && held.day.toDateString() === day.toDateString() && <span ref={heldRef} className="tf-bkf-team__sel" style={{ top: pct(held.start), height: len(held.start, held.end) }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
        </div>
      </div>
      }
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
export interface NewMeetingInput { readonly pageId: string | undefined; readonly length: number; readonly day: Date; readonly start: number; readonly with: RecordRef; readonly guests: ReadonlyArray<string>; readonly place: PlaceKind; readonly host: string;
  /** Someone not in People: the email the invitation goes to. */ readonly email?: string;
  /** Their time zone, the calendar it goes on, and a note sent with the invitation. */ readonly zone?: string; readonly calendarId?: string; readonly message?: string }

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
  const [email, setEmail] = useState('');
  const [zone, setZone] = useState(HOST_ZONE);
  const [calendarId, setCalendarId] = useState(state.health.bookingCalendar);
  const [message, setMessage] = useState('');
  const calendars = state.calendars.filter((c) => c.status === 'connected').flatMap((c) => (state.subCalendars?.[c.id]?.filter((x) => x.conflicts) ?? [{ id: c.id, name: 'Calendar' }]).map((x) => ({ id: x.id, label: x.name, description: `${c.provider} · ${c.email}` })));
  useEffect(() => {
    if (!isOpen) return;
    setEmail(''); setZone(HOST_ZONE); setMessage(''); setCalendarId(state.health.bookingCalendar);
    const p = state.pages.find((x) => x.isOn);
    // A dragged span is its own length: the type starts as Custom length; picking a page type resets the length to the page's.
    setPageId(initial || !p ? 'custom' : p.id); setLength(initial ? initial.end - initial.start : p ? lengthOf(p) : 30); setWho(undefined); setGuests(''); setPlace(p ? placeOf(p) : 'meet');
    setDate(parseDate(isoDay(initial?.day ?? dayFrom(new Date(), 1))));
    const s = initial?.start ?? 600;
    setTime(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = state.pages.find((p) => p.id === pageId);
  // Someone typed in, not found in People, needs an email for the invitation.
  const isNew = who !== undefined && !PEOPLE.some((p) => p.id === who.id);
  const emailOk = !isNew || /^\S+@\S+\.\S+$/.test(email.trim());
  const book = () => {
    if (!who || !emailOk) return;
    const [h, m] = time.split(':').map(Number);
    onBook({ pageId: page?.id, length: page ? lengthOf(page) : length, day: new Date(date.year, date.month - 1, date.day), start: (h ?? 10) * 60 + (m ?? 0), with: who,
      guests: guests.split(/[,\s]+/).filter((x) => x.includes('@')), place, host: initial?.member ?? HOST,
      email: isNew ? email.trim() : undefined, zone, calendarId: calendars.length ? calendarId : undefined, message: message.trim() || undefined });
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); }} title="New meeting" description="Book a time yourself. They get an invitation at once." size="md"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!who || !emailOk} onPress={book}>Book meeting</Button></>}>
      <div className="tf-bkf__stack">
        <Select label="Type" value={pageId} onChange={(v) => { if (!v) return; setPageId(v); const p = state.pages.find((x) => x.id === v); if (p) { setLength(lengthOf(p)); setPlace(placeOf(p)); } }}
          items={[...state.pages.filter((p) => !p.linkKind).map((p) => ({ id: p.id, label: p.name, description: `${lengthOf(p)} min` })), { id: 'custom', label: 'Custom length' }]} />
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
        ) : <ReferencePicker label="With" placeholder="Search People…" recent={PEOPLE.filter((p) => p.kind === 'person').slice(0, 3)} search={searchOnlyPeople} onSelect={setWho} onCreate={(name) => setWho({ id: nextId('r'), name, kind: 'person' })} />}
        {isNew && <TextField label="Email" type="email" isRequired value={email} onChange={setEmail} placeholder="them@example.com" description={`${first(who?.name ?? '')} isn’t in People yet. They’re added when you book.`}
          isInvalid={email.trim() !== '' && !emailOk} errorMessage="Enter their email, so the invitation reaches them." />}
        <TextField label="Extra guests" aside="Optional" value={guests} onChange={setGuests} placeholder="sam@acme.com, jo@acme.com" />
        <Select label="Where" value={place} onChange={(v) => { if (v) setPlace(v as PlaceKind); }} items={PLACE_ORDER.map((k) => ({ id: k, label: page ? placeLabel(page, k) : PLACES[k].label }))} />
        <ShowMore showLabel="More options" hideLabel="Fewer options">
          <div className="tf-bkf__stack">
            <Select label="Their time zone" value={zone} onChange={(v) => { if (v) setZone(v); }} items={ZONES.map((z) => ({ id: z.id, label: z.label }))}
              description={zone !== HOST_ZONE ? (() => { const [h, m] = time.split(':').map(Number); const d = new Date(date.year, date.month - 1, date.day, h ?? 10, m ?? 0); return `${new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(d)} for them. Their invitation shows their time.`; })() : 'Their invitation shows their time.'} />
            {calendars.length > 0 ? <Select label="Calendar" value={calendars.some((c) => c.id === calendarId) ? calendarId : calendars[0]?.id ?? null} onChange={(v) => { if (v) setCalendarId(v); }} items={calendars} description="The event and its video link are made here." />
              : <p className="tf-bkf__muted">Emailed only, no calendar event or video link.</p>}
            <TextArea label="Message" aside="Optional" rows={2} value={message} onChange={setMessage} placeholder="Grabbing the hour we talked about." description="Sent with the invitation." />
          </div>
        </ShowMore>
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
    invitee: { name: input.with.name, email: input.email ?? input.with.sub?.split(' · ')[1] ?? `${first(input.with.name).toLowerCase()}@example.com` }, guests: input.guests,
    place: PLACES[input.place].meeting, placeLabel: page ? placeLabel(page, input.place) : PLACES[input.place].label, status: 'confirmed', notes: '', answers: [], guestZone: input.zone ?? HOST_ZONE,
    record: input.email ? { ...input.with, sub: input.email } : input.with, calendarId: input.calendarId, message: input.message,
    activity: [{ id: nextId('a'), text: `Booked by ${HOST}${input.message ? ` · told them “${input.message}”` : ''}${input.email ? ` · ${first(input.with.name)} added to People` : ''}`, at: new Date() }],
  };
}
