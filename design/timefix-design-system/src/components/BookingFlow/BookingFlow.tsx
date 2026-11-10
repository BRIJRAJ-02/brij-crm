import {
  Button as AriaButton, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell,
  Form,
} from 'react-aria-components';
import type { CalendarDate } from '@internationalized/date';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Clock, Globe, MapPin, Phone, UserPlus, Video } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
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

/** The public booking card: rail, month, times, details, then the booked moment, with a "Powered by Timefix" foot. */
export function BookingFlow({ host, title, durationMinutes, location, today, isDayOpen, slotsFor, timeZones, defaultTimeZone, onBook, durations, onDurationChange, places, placeId, onPlaceChange }: BookingFlowProps) {
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [guestText, setGuestText] = useState('');
  const [date, setDate] = useState<CalendarDate | undefined>(() => firstOpen(today, isDayOpen));
  const [focused, setFocused] = useState<CalendarDate>(() => date ?? today);
  const [dir, setDir] = useState<'forward' | 'back' | undefined>();
  const [time, setTime] = useState<number>();
  const [hour12, setHour12] = useState(true);
  const [tz, setTz] = useState(defaultTimeZone);
  const [step, setStep] = useState<'pick' | 'details' | 'done'>('pick');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [guest, setGuest] = useState<BookingGuest>({ name: '', email: '', notes: '' });

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
    const guests = guestText.split(/[,\s]+/).map((x) => x.trim()).filter((x) => x.includes('@')).slice(0, 10);
    try { await onBook({ ...guest, guests, date, minutes: time, timeZone: tz }); setStep('done'); }
    catch { setFailed(true); }
    finally { setPending(false); }
  };
  const restart = () => { setStep('pick'); setTime(undefined); setGuest({ name: '', email: '', notes: '' }); setGuestText(''); setGuestsOpen(false); };

  const rail = (
    <aside className="tf-booking__rail">
      <Avatar name={host.name} src={host.avatarSrc} size={44} />
      <p className="tf-booking__host">{host.name}</p>
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
    </aside>
  );

  const pick = (
    <div className="tf-booking__pick">
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
      <div className="tf-booking__slots">
        <div className="tf-booking__slots-head">
          <h3 className="tf-booking__slots-day" key={date?.toString()} tabIndex={-1} data-autofocus={time === undefined || undefined}>
            {date ? <>{dayLabel(date, { weekday: 'short' })} <span className="tf-booking__year tf-num">{date.day}</span></> : 'Pick a day'}
          </h3>
          <SegmentedControl aria-label="Clock" size="sm" items={CLOCKS} selectedKey={hour12 ? '12' : '24'} onSelectionChange={(k) => setHour12(k === '12')} />
        </div>
        <ul className="tf-booking__slot-list" key={date?.toString()} aria-label="Open times">
          {slots.map((m) => {
            const chosen = m === time;
            return (
              <li key={m} className="tf-booking__slot" data-chosen={chosen || undefined}>
                <AriaButton className="tf-booking__time" aria-pressed={chosen} data-autofocus={chosen || undefined} onPress={() => setTime(m)}>{formatClock(m, hour12)}</AriaButton>
                <span className="tf-booking__next-wrap" inert={!chosen}>
                  <AriaButton className="tf-booking__next" onPress={() => setStep('details')}>Next</AriaButton>
                </span>
              </li>
            );
          })}
          {date && slots.length === 0 && <li className="tf-booking__none">No times left on this day.</li>}
        </ul>
      </div>
    </div>
  );

  const details = (
    <Form className="tf-booking__form" onSubmit={submit}>
      <div className="tf-booking__form-head">
        <IconButton label="Back to times" size="sm" onPress={() => setStep('pick')}><ArrowLeft {...i16} /></IconButton>
        <h3 className="tf-booking__form-title" tabIndex={-1} data-autofocus>Your details</h3>
      </div>
      <TextField label="Name" size="lg" isRequired autoComplete="name" value={guest.name} onChange={(name) => setGuest((g) => ({ ...g, name }))} errorMessage="Add your name." />
      <TextField label="Email" size="lg" isRequired type="email" autoComplete="email" value={guest.email} onChange={(email) => setGuest((g) => ({ ...g, email }))} errorMessage="Add an email we can send the invite to." />
      {guestsOpen
        ? <TextField label="Guests" aside="Optional" size="lg" type="text" autoComplete="off" autoFocus value={guestText} onChange={setGuestText}
            placeholder="sam@acme.com, jo@acme.com" description="Up to 10 people. They get the invite too." />
        : <AriaButton className="tf-booking__addguests" onPress={() => setGuestsOpen(true)}><UserPlus {...i16} aria-hidden />Add guests</AriaButton>}
      <TextArea label="Anything to share before the call?" aside="Optional" size="lg" rows={3} value={guest.notes} onChange={(notes) => setGuest((g) => ({ ...g, notes }))} />
      {failed && <p className="tf-booking__error" role="alert">That time was just taken. Go back and pick another.</p>}
      <Button type="submit" variant="primary" size="lg" isPending={pending} className="tf-booking__book">Book</Button>
    </Form>
  );

  const done = (
    <div className="tf-booking__done">
      {step === 'done' && (
        <>
          <span className="tf-booking__check" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17.5 19 7" pathLength={1} /></svg>
          </span>
          <div className="tf-booking__reveal">
            <h2 className="tf-booking__reveal-line tf-booking__done-title" tabIndex={-1} data-autofocus>You're booked</h2>
            <p className="tf-booking__reveal-line tf-booking__done-sub">An invitation is on its way to {guest.email || 'your inbox'}.</p>
          </div>
          <dl className="tf-booking__summary tf-booking__reveal-line">
            <dt>What</dt><dd>{title} with {host.name}</dd>
            <dt>When</dt><dd className="tf-num">{when}</dd>
            <dt>Where</dt><dd>{location.label}</dd>
            <dt>Time zone</dt><dd>{tzLabel}</dd>
          </dl>
          <div className="tf-booking__add tf-booking__reveal-line">
            <span className="tf-booking__label">Add to calendar</span>
            <span className="tf-row">
              {['Google', 'Outlook', 'Apple'].map((p) => <Button key={p} size="sm" icon={<CalendarPlus size={14} strokeWidth={1.75} />}>{p}</Button>)}
            </span>
          </div>
          <Button variant="ghost" size="sm" onPress={restart}>Book another time</Button>
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
      <a className="tf-booking__foot" href="https://www.timefix.com" target="_blank" rel="noreferrer">
        <span>Powered by</span><Logo size={16} />
      </a>
    </div>
  );
}
