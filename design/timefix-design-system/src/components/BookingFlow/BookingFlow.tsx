import {
  Button as AriaButton, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell,
  Form,
} from 'react-aria-components';
import type { CalendarDate } from '@internationalized/date';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, CalendarCheck, CalendarClock, Plus, CalendarDays, LayoutList, MessageCircle, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, ArrowUpRight, Globe, MapPin, Phone, UserPlus, Video, X } from 'lucide-react';
import { Avatar, AvatarGroup } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { DayStrip } from '../DayStrip/DayStrip.tsx';
import { cx } from '../../lib/cx.ts';
import { formatClock, formatClockRange } from '../WeekCalendar/clock.ts';
import { MenuTrigger, Menu, MenuItem } from '../Menu/Menu.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { formatLongDay } from '../../lib/format.ts';
import './BookingFlow.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** A time zone the guest can view times in. */
export interface BookingTimeZone { readonly id: string; readonly label: string }
/** What the guest typed on the details page. */
export interface BookingGuest { readonly name: string; readonly email: string; readonly notes: string; /** Other people to invite, up to 10. */ readonly guests?: ReadonlyArray<string> }
/** The booking the flow hands to `onBook`. */
export interface BookingRequest extends BookingGuest { readonly date: CalendarDate; readonly minutes: number; readonly timeZone: string }

/** Props for BookingFlow. Times are minutes from midnight in the chosen time zone; nothing here fetches. */
export interface BookingFlowProps {
  readonly host: { readonly name: string; readonly avatarSrc?: string };
  readonly title: string;
  readonly durationMinutes: number;
  readonly location: { readonly kind: 'video' | 'phone' | 'place'; readonly label: string };
  readonly today: CalendarDate;
  /** Whether a day has any open time. Closed days stay quiet and cannot be picked. */
  readonly isDayOpen: (date: CalendarDate) => boolean;
  /** The open start times of a day, as minutes from midnight. */
  readonly slotsFor: (date: CalendarDate) => ReadonlyArray<number>;
  readonly timeZones: ReadonlyArray<BookingTimeZone>;
  readonly defaultTimeZone: string;
  /** Resolves when the booking is made; a rejection keeps the guest on the details page. */
  readonly onBook: (request: BookingRequest) => Promise<void>;
  /** Several lengths to choose from: the length line becomes a switch. */
  readonly durations?: ReadonlyArray<number>;
  readonly onDurationChange?: (minutes: number) => void;
  /** Several places to choose from: the place line becomes a switch. */
  readonly places?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly placeId?: string;
  readonly onPlaceChange?: (id: string) => void;
  /** A team page: every host's face in the header ("Priya, Sam or Jo"). */
  readonly team?: ReadonlyArray<string>;
  /** Known already (they came from a form): "Booking as …" replaces the name and email fields. */
  readonly prefill?: { readonly name: string; readonly email: string };
  /** The guest's own busy times once they connect a calendar, for "best times". Without it there is no Connect link. */
  readonly guestBusy?: (date: CalendarDate) => ReadonlyArray<{ readonly start: number; readonly end: number }>;
  /** Which view opens first: Month, List or Chat (the page's setting). */
  readonly defaultView?: 'month' | 'list' | 'chat';
  /** Book by chat, drawn in the same box when Chat is chosen. Without it there is no Chat view. */
  readonly chat?: ReactNode;
}

const asDate = (d: CalendarDate) => new Date(d.year, d.month - 1, d.day);
const dayLabel = (d: CalendarDate, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', o).format(asDate(d));
const firstOpen = (from: CalendarDate, open: (d: CalendarDate) => boolean) => {
  for (let n = 0; n < 60; n += 1) { const d = from.add({ days: n }); if (open(d)) return d; }
  return undefined;
};

/** transitions.dev page side-by-side inside a card that resizes to the page showing (01 card resize). */
function Pages({ page, pages, label }: { readonly page: number; readonly pages: ReadonlyArray<ReactNode>; readonly label: string }) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const mounted = useRef(false);
  const shownPage = useRef(page);
  const last = useRef(0);
  const [size, setSize] = useState<{ readonly height: number; readonly animate: boolean }>();
  useLayoutEffect(() => {
    const el = refs.current[page];
    if (!el) return undefined;
    // The first render takes its height at once; only a step change eases (01 card resize). After that the box follows
    // its page's own size changes directly (fonts arriving, a nested step easing, an error line), never easing twice.
    last.current = el.offsetHeight;
    setSize({ height: last.current, animate: mounted.current });
    mounted.current = true;
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight === last.current) return;
      last.current = el.offsetHeight;
      setSize({ height: last.current, animate: false });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);
  // Focus moves only when the guest changes step, never on mount.
  useEffect(() => {
    if (shownPage.current === page) return;
    shownPage.current = page;
    refs.current[page]?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [page]);
  return (
    <div className={cx('tf-booking__pages', !size?.animate && 'is-following')} style={{ height: size?.height }} aria-label={label} role="group">
      {pages.map((child, n) => (
        <section key={n} ref={(el) => { refs.current[n] = el; }} className="tf-booking__page" data-pos={n < page ? 'before' : n > page ? 'after' : 'current'} inert={n !== page}>
          {child}
        </section>
      ))}
    </div>
  );
}

function LocationIcon({ kind }: { readonly kind: BookingFlowProps['location']['kind'] }) {
  return kind === 'video' ? <Video {...i16} aria-hidden /> : kind === 'phone' ? <Phone {...i16} aria-hidden /> : <MapPin {...i16} aria-hidden />;
}

/** The time zone picker in the rail: a quiet row that opens the shared Menu (05 menu dropdown); the pick ticks, then it closes. */
function TimeZoneSelect({ zones, value, onChange }: { readonly zones: ReadonlyArray<BookingTimeZone>; readonly value: string; readonly onChange: (id: string) => void }) {
  const label = zones.find((z) => z.id === value)?.label ?? value;
  return (
    <MenuTrigger>
      <AriaButton className="tf-booking__tz-trigger" aria-label={`Time zone, ${label}`}>
        <Globe {...i16} aria-hidden />
        <span className="tf-booking__tz-value">{label}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
      </AriaButton>
      <Menu aria-label="Time zone" placement="bottom start" selectionMode="single" selectedKeys={[value]}
        filterPlaceholder={zones.length > 8 ? 'Search time zones…' : undefined}
        onSelectionChange={(keys) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) onChange(String(k)); }}>
        {zones.map((z) => <MenuItem key={z.id} id={z.id}>{z.label}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  );
}

const CLOCKS = [{ id: '12', label: '12h' }, { id: '24', label: '24h' }] as const;

/** The Timefix card at the foot of the rail: who made the page, and an invitation to make one. One link, so one tab stop. */
export function BrandCard({ className }: { readonly className?: string }) {
  return (
    <a className={cx('tf-booking__brand', className)} href="https://www.timefix.com/signup" target="_blank" rel="noreferrer">
      <span className="tf-booking__brand-mark"><LogoMark size={28} /></span>
      <span className="tf-booking__brand-text">
        <span className="tf-booking__brand-by">Powered by <strong>Timefix</strong></span>
        <span className="tf-booking__brand-cta">Get a free booking page</span>
      </span>
      <ArrowUpRight className="tf-booking__brand-go" size={16} strokeWidth={1.75} aria-hidden />
    </a>
  );
}

/** The public booking card: rail, month, times, details, then the booked moment, with a "Powered by Timefix" foot. */
export function BookingFlow({ host, title, durationMinutes, location, today, isDayOpen, slotsFor, timeZones, defaultTimeZone, onBook, durations, onDurationChange, places, placeId, onPlaceChange, team, prefill, guestBusy, defaultView, chat }: BookingFlowProps) {
  const [known, setKnown] = useState(prefill !== undefined);
  const [layout, setLayout] = useState<'month' | 'list' | 'chat'>(defaultView === 'chat' && !chat ? 'month' : defaultView ?? 'month');
  const [listWeek, setListWeek] = useState(0);
  const [calendar, setCalendar] = useState<'off' | 'connecting' | 'on'>('off');
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [lastGuests, setLastGuests] = useState<ReadonlyArray<string>>([]);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [guestText, setGuestText] = useState('');
  const [guestList, setGuestList] = useState<ReadonlyArray<string>>([]);
  const [guestError, setGuestError] = useState<string>();
  const [leavingGuest, setLeavingGuest] = useState<string>();
  const [shake, setShake] = useState(0);
  /** Adds what was typed as guests: one address or several pasted at once (commas, spaces or new lines). Each must look real, not be the guest's own, not twice, ten at most. */
  const addGuest = (raw: string = guestText) => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) return;
    const own = guest.email.trim().toLowerCase();
    let list = guestList;
    let error: string | undefined;
    const rest: string[] = [];
    for (const v of parts) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { error = 'That doesn’t look like an email address.'; rest.push(v); continue; }
      if (v === own) { error = 'That’s you. Add someone else.'; continue; }
      if (list.includes(v)) { error = 'Already added.'; continue; }
      if (list.length >= 10) { error = 'Ten guests at most.'; rest.push(v); continue; }
      list = [...list, v];
    }
    setGuestList(list); setGuestText(rest.join(', ')); setGuestError(error);
    if (error) setShake((n) => n + 1);
  };
  /** A removed guest folds away first (150ms), then leaves the list. */
  const removeGuest = (g: string) => {
    setLeavingGuest(g);
    window.setTimeout(() => { setGuestList((l) => l.filter((x) => x !== g)); setLeavingGuest(undefined); }, 150);
  };
  const [date, setDate] = useState<CalendarDate | undefined>(() => firstOpen(today, isDayOpen));
  const [focused, setFocused] = useState<CalendarDate>(() => date ?? today);
  const [dir, setDir] = useState<'forward' | 'back' | undefined>();
  const [time, setTime] = useState<number>();
  const [hour12, setHour12] = useState(true);
  const [tz, setTz] = useState(defaultTimeZone);
  const [step, setStep] = useState<'pick' | 'details' | 'done'>('pick');
  // After booking: manage it here (add guests, move it, cancel it), the same card, no new page.
  const [after, setAfter] = useState<'idle' | 'guests' | 'cancel' | 'cancelled' | 'moving' | 'moved'>('idle');
  const [extra, setExtra] = useState('');
  /** The booked time as written on the done screen; kept while the guest looks for a new time, so going back never blanks it. */
  const [bookedWhen, setBookedWhen] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [guest, setGuest] = useState<BookingGuest>({ name: prefill?.name ?? '', email: prefill?.email ?? '', notes: '' });

  const monthKey = `${focused.year}-${focused.month}`;
  const gridWrap = useRef<HTMLDivElement>(null);
  // The month slides in the way the arrows went. The grid is not remounted (keyboard focus lives in it), so the
  // animation is replayed on the same element.
  useLayoutEffect(() => {
    const el = gridWrap.current;
    if (!el || !dir) return;
    el.removeAttribute('data-dir');
    void el.offsetWidth;
    el.setAttribute('data-dir', dir);
  }, [monthKey, dir]);
  const onFocus = (d: CalendarDate) => {
    const delta = (d.year - focused.year) * 12 + (d.month - focused.month);
    if (delta !== 0) setDir(delta > 0 ? 'forward' : 'back');
    setFocused(d);
  };
  const pickDay = (d: CalendarDate) => { setDate(d); setTime(undefined); };
  const slots = date ? slotsFor(date) : [];
  const range = time === undefined ? '' : formatClockRange(time, time + durationMinutes, hour12);
  const when = date && time !== undefined ? `${formatLongDay(asDate(date))}, ${range}` : '';
  const tzLabel = timeZones.find((z) => z.id === tz)?.label ?? tz;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!date || time === undefined) return;
    setPending(true); setFailed(false);
    const guests = guestList;
    try { await onBook({ ...guest, guests, date, minutes: time, timeZone: tz }); setLastGuests(guests); setBookedWhen(when); setStep('done'); }
    catch { setFailed(true); }
    finally { setPending(false); }
  };
  const restart = () => { setStep('pick'); setTime(undefined); setAdded(new Set()); setGuest({ name: known && prefill ? prefill.name : '', email: known && prefill ? prefill.email : '', notes: '' }); setGuestText(''); setGuestList([]); setGuestsOpen(false); };

  const rail = (
    <aside className="tf-booking__rail">
      {team && team.length > 1 ? <AvatarGroup names={team} size={36} max={4} /> : <Avatar name={host.name} src={host.avatarSrc} size={44} />}
      <p className="tf-booking__host">{team && team.length > 1 ? `${team.slice(0, -1).map((n) => n.split(' ')[0]).join(', ')} or ${(team[team.length - 1] ?? '').split(' ')[0]}` : host.name}</p>
      <h2 className="tf-booking__title">{title}</h2>
      {/* The chosen time opens in flow above the facts and pushes them down (21 accordion: 0fr to 1fr). */}
      <div className="tf-booking__when" data-open={step === 'details' && when !== '' ? 'true' : 'false'}>
        <div className="tf-booking__when-clip">
          <p className="tf-booking__when-row"><CalendarDays {...i16} aria-hidden /><span className="tf-num">{when}</span></p>
        </div>
      </div>
      <ul className="tf-booking__facts">
        <li><Clock {...i16} aria-hidden />{durations && durations.length > 1 && onDurationChange
          ? <SegmentedControl aria-label="How long" size="sm" items={durations.map((d) => ({ id: String(d), label: `${d} min` }))} selectedKey={String(durationMinutes)} onSelectionChange={(k) => onDurationChange(Number(k))} />
          : <span className="tf-num">{durationMinutes} min</span>}</li>
        <li><LocationIcon kind={location.kind} />{places && places.length > 1 && onPlaceChange && placeId !== undefined
          ? <SegmentedControl aria-label="Where" size="sm" items={places.map((p) => ({ id: p.id, label: p.label }))} selectedKey={placeId} onSelectionChange={onPlaceChange} />
          : <span>{location.label}</span>}</li>
        <li className="tf-booking__tz-row"><TimeZoneSelect zones={timeZones} value={tz} onChange={setTz} /></li>
      </ul>
      <BrandCard />
    </aside>
  );

  // The views: Month (a calendar beside the day's times), List (a week of days over the day's times) and Chat. All three
  // draw in the same box, so switching moves nothing.
  const views = [{ id: 'month', label: 'Month', icon: <CalendarDays size={14} strokeWidth={1.75} /> }, { id: 'list', label: 'List', icon: <LayoutList size={14} strokeWidth={1.75} /> },
    ...(chat ? [{ id: 'chat', label: 'Chat', icon: <MessageCircle size={14} strokeWidth={1.75} /> }] : [])];
  const layoutSwitch = <SegmentedControl aria-label="How to pick a time" size="sm" items={views} selectedKey={layout} onSelectionChange={(k) => setLayout(k === 'list' ? 'list' : k === 'chat' ? 'chat' : 'month')} />;
  const slotsCol = (
      <div className="tf-booking__slots">
        <div className="tf-booking__slots-head">
          <h3 className="tf-booking__slots-day" key={date?.toString()} tabIndex={-1} data-autofocus={time === undefined || undefined}>
            {date ? <>{dayLabel(date, { weekday: 'short' })} <span className="tf-booking__year tf-num">{date.day}</span></> : 'Pick a day'}
          </h3>
          <SegmentedControl aria-label="Clock" size="sm" items={CLOCKS} selectedKey={hour12 ? '12' : '24'} onSelectionChange={(k) => setHour12(k === '12')} />
        </div>
        <ul className="tf-booking__slot-list" key={date?.toString()} aria-label="Open times">
          {slots.map((m, i) => {
            const chosen = m === time;
            const theirs = calendar === 'on' && date && guestBusy ? guestBusy(date) : [];
            const busy = theirs.some((b) => m < b.end && b.start < m + durationMinutes);
            const best = calendar === 'on' && !busy && m === slots.find((x) => !theirs.some((b) => x < b.end && b.start < x + durationMinutes));
            return (
              <li key={m} className="tf-booking__slot" data-chosen={chosen || undefined} style={{ '--tf-i': Math.min(i, 8) } as CSSProperties}>
                <AriaButton className="tf-booking__time" data-busy={busy || undefined} aria-pressed={chosen} data-autofocus={chosen || undefined} onPress={() => setTime(m)}
                  aria-label={`${formatClock(m, hour12)}${busy ? ', busy on your calendar' : best ? ', best time for you' : ''}`}>
                  {formatClock(m, hour12)}{!chosen && busy && <span className="tf-booking__mark">You’re busy</span>}{!chosen && best && <span className="tf-booking__mark tf-booking__mark--best">Best</span>}
                </AriaButton>
                <span className="tf-booking__next-wrap" inert={!chosen}>
                  <AriaButton className="tf-booking__next" onPress={() => { if (after === 'moving') { setAfter('moved'); setBookedWhen(when); setStep('done'); } else setStep('details'); }}>{after === 'moving' ? 'Move here' : 'Next'}</AriaButton>
                </span>
              </li>
            );
          })}
          {date && slots.length === 0 && <li className="tf-booking__none">No times left on this day.</li>}
        </ul>
      </div>
  );
  const monday = today.subtract({ days: (asDate(today).getDay() + 6) % 7 }).add({ weeks: listWeek });
  const week = Array.from({ length: 7 }, (_, n) => monday.add({ days: n })).filter((d) => d.compare(today) >= 0 || listWeek > 0);
  const list = (
    <div className="tf-booking__listview" key="list">
      <DayStrip label="Day" unit={['open time', 'open times']} value={date?.toString() ?? ''}
        days={week.map((d) => ({ id: d.toString(), weekday: dayLabel(d, { weekday: 'short' }), date: d.day, label: dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' }), count: isDayOpen(d) ? slotsFor(d).length : 0, isToday: d.compare(today) === 0 }))}
        onChange={(id) => { const d = week.find((x) => x.toString() === id); if (d) pickDay(d); }}
        onPrevious={listWeek > 0 ? () => setListWeek((w) => w - 1) : undefined} onNext={() => setListWeek((w) => w + 1)} />
      {slotsCol}
    </div>
  );
  const month = (
    <div className="tf-booking__pick" key="month">
      <Calendar aria-label="Date" value={date ?? null} onChange={pickDay} focusedValue={focused} onFocusChange={onFocus}
        minValue={today} isDateUnavailable={(d) => !isDayOpen(d as CalendarDate)} className="tf-booking__cal">
        <header className="tf-booking__cal-head">
          <h3 className="tf-booking__month" key={monthKey} data-dir={dir}>
            {dayLabel(focused, { month: 'long' })} <span className="tf-booking__year">{focused.year}</span>
          </h3>
          <span className="tf-booking__arrows">
            <IconButton slot="previous" label="Previous month" size="sm"><ChevronLeft {...i16} /></IconButton>
            <IconButton slot="next" label="Next month" size="sm"><ChevronRight {...i16} /></IconButton>
          </span>
        </header>
        <div ref={gridWrap} className="tf-booking__grid-wrap">
          <CalendarGrid className="tf-booking__grid" weekdayStyle="short">
            <CalendarGridHeader>{(d) => <CalendarHeaderCell className="tf-booking__weekday">{d}</CalendarHeaderCell>}</CalendarGridHeader>
            <CalendarGridBody>{(d) => <CalendarCell date={d} className="tf-booking__day" />}</CalendarGridBody>
          </CalendarGrid>
        </div>
      </Calendar>
      {slotsCol}
    </div>
  );
  const pick = (
    <div className="tf-booking__pane">
      {after === 'moving' && (
        <div className="tf-booking__moving" role="status">
          <CalendarClock size={16} strokeWidth={1.75} aria-hidden /><span>Pick a new time. Your booking moves when you press <strong>Move here</strong>.</span>
          <AriaButton className="tf-booking__textbtn" onPress={() => { setAfter('idle'); setStep('done'); }}>Keep the old time</AriaButton>
        </div>
      )}
      <div className="tf-booking__viewbar">
        <h2 className="tf-booking__pick-title">{after === 'moving' ? 'Pick a new time' : layout === 'chat' ? 'Tell us when suits you' : 'Pick a date and time'}</h2>
        <span className="tf-booking__viewbar-end">
          {guestBusy && layout !== 'chat' && (calendar === 'on'
            ? <span className="tf-booking__compare-on" role="status"><span className="tf-booking__overlay-dot" aria-hidden="true" />Your calendar<AriaButton className="tf-booking__compare-x" aria-label="Stop comparing with your calendar" onPress={() => setCalendar('off')}><X size={12} strokeWidth={2} /></AriaButton></span>
            : <span className="tf-booking__compare"><Button size="sm" variant="secondary" isPending={calendar === 'connecting'} icon={<CalendarCheck size={14} strokeWidth={1.75} />} onPress={() => { setCalendar('connecting'); window.setTimeout(() => setCalendar('on'), 800); }}>Compare my calendar</Button></span>)}
          <span className="tf-booking__switch">{layoutSwitch}</span>
        </span>
      </div>
      {layout === 'chat' && chat ? <div className="tf-booking__chatview" key="chat">{chat}</div> : layout === 'list' ? list : month}
    </div>
  );

  const details = (
    <Form className="tf-booking__form" onSubmit={submit}>
      <div className="tf-booking__form-head">
        <IconButton label="Back to times" size="sm" onPress={() => setStep('pick')}><ArrowLeft {...i16} /></IconButton>
        <h3 className="tf-booking__form-title" tabIndex={-1} data-autofocus>Your details</h3>
      </div>
      {known && prefill ? (
        <div className="tf-booking__as">
          <Avatar name={prefill.name} size={32} />
          <span className="tf-booking__as-text"><span className="tf-booking__as-label">Booking as</span><strong>{prefill.name}</strong><span className="tf-booking__as-email">{prefill.email}</span></span>
          <AriaButton className="tf-booking__textbtn" onPress={() => { setKnown(false); setGuest((g) => ({ ...g, name: '', email: '' })); }}>Not you?</AriaButton>
        </div>
      ) : <>
        <TextField label="Name" size="lg" isRequired autoComplete="name" value={guest.name} onChange={(name) => setGuest((g) => ({ ...g, name }))} errorMessage="Add your name." />
        <TextField label="Email" size="lg" isRequired type="email" autoComplete="email" value={guest.email} onChange={(email) => setGuest((g) => ({ ...g, email }))} errorMessage="Add an email we can send the invite to." />
      </>}
      {/* Add guests opens in place: the button folds as the field grows (accordion, 0fr to 1fr); chips pop in and fold away. */}
      <div className="tf-booking__guestbox" data-open={guestsOpen || undefined}>
        <AriaButton className="tf-booking__addguests" aria-expanded={guestsOpen} isDisabled={guestsOpen} onPress={() => setGuestsOpen(true)}>
          <UserPlus {...i16} aria-hidden />Add guests<span className="tf-booking__addguests-hint">They get the invite too</span>
        </AriaButton>
        <div className="tf-booking__guests-clip">
          {guestsOpen && (
            <div className="tf-booking__guests">
              <div key={shake} className={shake ? 'tf-booking__guests-field is-shaking' : 'tf-booking__guests-field'}>
                <TextField label="Guests" aside={guestList.length ? `${guestList.length} of 10` : 'Up to 10'} size="lg" type="email" autoComplete="off" autoFocus value={guestText}
                  onChange={(v) => { if (/[\s,;]/.test(v) && v.includes('@')) { addGuest(v); } else { setGuestText(v); setGuestError(undefined); } }}
                  placeholder="name@company.com" description="Press Enter to add. Paste several at once." isInvalid={guestError !== undefined} errorMessage={guestError}
                  suffix={<IconButton size="sm" variant={guestText.trim() ? 'primary' : 'ghost'} label="Add this guest" isDisabled={!guestText.trim() || guestList.length >= 10} onPress={() => addGuest()}><Plus size={16} strokeWidth={2} /></IconButton>}
                  isDisabled={guestList.length >= 10}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addGuest(); }
                    if (e.key === 'Backspace' && guestText === '' && guestList.length > 0) { const last = guestList[guestList.length - 1]; if (last) removeGuest(last); }
                    if (e.key === 'Escape' && guestText === '' && guestList.length === 0) setGuestsOpen(false);
                  }}
                  onBlur={() => { if (guestText.trim()) addGuest(); else if (guestList.length === 0) setGuestsOpen(false); }} />
              </div>
              {guestList.length > 0 && (
                <ul className="tf-booking__guest-list" aria-label="Guests added">
                  {guestList.map((g) => (
                    <li key={g} className="tf-booking__guest-chip" data-leaving={leavingGuest === g || undefined}>
                      <Avatar name={g} size={20} /><span>{g}</span>
                      <AriaButton className="tf-booking__guest-x" aria-label={`Remove ${g}`} onPress={() => removeGuest(g)}><X size={12} strokeWidth={2} /></AriaButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <TextArea label="Anything to share before the call?" aside="Optional" size="lg" rows={3} value={guest.notes} onChange={(notes) => setGuest((g) => ({ ...g, notes }))} />
      {failed && (
        <div className="tf-booking__failed" role="alert">
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
          <span className="tf-booking__failed-text"><strong>Someone just booked that time</strong><span>Your details are kept. Pick another time and book again.</span></span>
          <Button size="sm" variant="secondary" onPress={() => { setStep('pick'); setTime(undefined); }}>Pick another time</Button>
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" isPending={pending} className="tf-booking__book">Book</Button>
    </Form>
  );

  const firstName = team && team.length > 1 ? 'the team' : host.name.split(' ')[0];
  const done = (
    <div className={cx('tf-booking__done', after === 'cancelled' && 'tf-booking__done--cancelled')}>
      {step === 'done' && (
        <>
          <span className="tf-booking__celebrate" aria-hidden="true">
            <span className="tf-booking__ring" />
            <span className="tf-booking__check">
              {after === 'cancelled'
                ? <X size={28} strokeWidth={2.25} />
                : <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17.5 19 7" pathLength={1} /></svg>}
            </span>
          </span>
          <div className="tf-booking__reveal" key={after}>
            <h2 className="tf-booking__reveal-line tf-booking__done-title" tabIndex={-1} data-autofocus>
              {after === 'cancelled' ? 'Booking cancelled' : after === 'moved' ? `Moved. See you then` : `You’re booked with ${firstName}`}
            </h2>
            <p className="tf-booking__reveal-line tf-booking__done-sub">
              {after === 'cancelled' ? `${firstName === 'the team' ? 'The team has' : `${firstName} has`} been told. Nothing else to do.` : after === 'moved' ? `${firstName} and you both get the new time by email.` : `An invitation is on its way to ${guest.email || 'your inbox'}.`}
            </p>
          </div>
          {after !== 'cancelled' && (
            <dl className="tf-booking__summary tf-booking__reveal-line">
              <dt>What</dt><dd>{title} with {host.name}</dd>
              <dt>When</dt><dd className="tf-num">{bookedWhen || when}</dd>
              <dt>Where</dt><dd>{location.label}</dd>
              <dt>Time zone</dt><dd>{tzLabel}</dd>
              {lastGuests.length > 0 && after !== 'guests' && <><dt>Guests</dt><dd>{lastGuests.join(', ')}</dd></>}
            </dl>
          )}
          {after === 'guests' && (
            <div className="tf-booking__more tf-booking__reveal-line">
              <TextField label="Add guests" aside={`${lastGuests.length} of 10`} size="lg" type="email" autoFocus value={extra} placeholder="name@company.com"
                onChange={(v) => { if (/[\s,;]/.test(v) && v.includes('@')) { const ok = v.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); setLastGuests((g) => [...new Set([...g, ...ok])].slice(0, 10)); setExtra(''); } else setExtra(v); }}
                suffix={<IconButton size="sm" variant={extra.trim() ? 'primary' : 'ghost'} label="Add this guest" isDisabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra.trim())} onPress={() => { setLastGuests((g) => [...new Set([...g, extra.trim().toLowerCase()])].slice(0, 10)); setExtra(''); }}><Plus size={16} strokeWidth={2} /></IconButton>}
                onKeyDown={(e) => { if (e.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra.trim())) { e.preventDefault(); setLastGuests((g) => [...new Set([...g, extra.trim().toLowerCase()])].slice(0, 10)); setExtra(''); } if (e.key === 'Escape') setAfter('idle'); }}
                description="Each one gets the invite at once." />
              {lastGuests.length > 0 && (
                <ul className="tf-booking__guest-list" aria-label="Guests on this booking">
                  {lastGuests.map((g) => (
                    <li key={g} className="tf-booking__guest-chip">
                      <Avatar name={g} size={20} /><span>{g}</span>
                      <AriaButton className="tf-booking__guest-x" aria-label={`Remove ${g}`} onPress={() => setLastGuests((l) => l.filter((x) => x !== g))}><X size={12} strokeWidth={2} /></AriaButton>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="primary" className="tf-booking__more-done" onPress={() => { setExtra(''); setAfter('idle'); }}>Done</Button>
            </div>
          )}
          {after === 'cancel' && (
            <div className="tf-booking__confirm tf-booking__reveal-line" role="alertdialog" aria-label="Cancel this booking?">
              <span className="tf-booking__confirm-text"><strong>Cancel this booking?</strong><span>{firstName === 'the team' ? 'The team is' : `${firstName} is`} told at once. This can’t be undone.</span></span>
              <span className="tf-row">
                <Button size="sm" variant="ghost" onPress={() => setAfter('idle')}>Keep it</Button>
                <Button size="sm" variant="danger" onPress={() => setAfter('cancelled')}>Cancel booking</Button>
              </span>
            </div>
          )}
          {after !== 'cancelled' && after !== 'cancel' && after !== 'guests' && (
            <>
              <div className="tf-booking__add tf-booking__reveal-line">
                <span className="tf-booking__label">Add to calendar</span>
                <span className="tf-row">
                  {['Google', 'Outlook', 'Apple'].map((p) => (
                    <Button key={p} size="sm" variant={added.has(p) ? 'ghost' : 'secondary'} onPress={() => setAdded((a) => new Set(a).add(p))}
                      icon={added.has(p) ? <Check size={14} strokeWidth={2} /> : <CalendarPlus size={14} strokeWidth={1.75} />}>{added.has(p) ? `In ${p}` : p}</Button>
                  ))}
                </span>
              </div>
              <div className="tf-booking__manage tf-booking__reveal-line" aria-label="Change this booking">
                <Button size="sm" variant="ghost" icon={<UserPlus size={14} strokeWidth={1.75} />} onPress={() => setAfter('guests')}>Add guests</Button>
                <Button size="sm" variant="ghost" icon={<CalendarClock size={14} strokeWidth={1.75} />} onPress={() => { setAfter('moving'); setTime(undefined); setStep('pick'); }}>Reschedule</Button>
                <Button size="sm" variant="ghost" icon={<X size={14} strokeWidth={1.75} />} onPress={() => setAfter('cancel')}>Cancel</Button>
              </div>
            </>
          )}
          {after === 'cancelled' && <Button variant="secondary" onPress={() => { setAfter('idle'); restart(); }}>Book another time</Button>}
        </>
      )}
    </div>
  );

  return (
    <div className="tf-booking">
      <div className={cx('tf-booking__card', step === 'done' && 'tf-booking__card--done')}>
        <Pages page={step === 'done' ? 1 : 0} label="Booking" pages={[
          <div className="tf-booking__flow">
            {rail}
            <Pages page={step === 'pick' ? 0 : 1} label="Steps" pages={[pick, details]} />
          </div>,
          done,
        ]} />
      </div>
      <div className={cx('tf-booking__foot', step !== 'done' && 'tf-booking__foot--railed')}><BrandCard className="tf-booking__brand--solo" /></div>
    </div>
  );
}
