// Step 6, the guest's side, full screen (Desktop or Phone): the booking page, a request waiting, Manage booking, an expired one-time link,
// a hidden page, a page offering only picked times, and the booking chat.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDate } from '@internationalized/date';
import { ArrowLeft, CalendarClock, CalendarX2, Clock, Eye, EyeOff, Link2Off, Mail, Monitor, Smartphone } from 'lucide-react';
import type { BookingRequest } from '../BookingFlow/BookingFlow.tsx';
import { BookingChat, type BookingChatLine, type BookingChatBooked } from '../BookingChat/BookingChat.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { Button as AriaButton } from 'react-aria-components';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import { formatClockRange } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { GuestView, i14 } from './parts.tsx';
import { PLACES, at, dayFrom, first, isoDay, lengthOf, meetingWhen, openTimes, pageUrl, parseDay, placeLabel, placeOf, type BookedMeeting, type BookingPage, type BookingsState, type PlaceKind } from './state.ts';

/** What the guest view plays. */
export type GuestScenario = 'book' | 'pending' | 'manage' | 'expired' | 'hidden' | 'offered' | 'chat';
/** Each scenario's name in the Demo menu. */
export const GUEST_SCENARIOS: ReadonlyArray<{ readonly id: GuestScenario; readonly label: string }> = [
  { id: 'book', label: 'Book a time' }, { id: 'pending', label: 'A request waiting' }, { id: 'manage', label: 'Manage a booking' },
  { id: 'offered', label: 'Picked times only' }, { id: 'chat', label: 'Book by chat' }, { id: 'expired', label: 'An expired one-time link' }, { id: 'hidden', label: 'A hidden page' },
];

/** Props for GuestMode. */
export interface GuestPlayerProps {
  readonly play: { readonly scenario: GuestScenario; readonly pageId: string; readonly meetingId?: string } | undefined;
  readonly state: BookingsState;
  readonly onClose: () => void;
  /** A booking made as the guest; the host side plays it when the view closes. */
  readonly onBooked: (page: BookingPage, r: BookingRequest & { readonly length: number; readonly place: PlaceKind }) => void;
  readonly onGuestCancel: (m: BookedMeeting, reason: string) => void;
  readonly onGuestMove: (m: BookedMeeting, start: Date) => void;
}

/** Guest mode: the admin app steps aside for the public page exactly as a guest sees it, on the canvas, with a slim bar to switch
 *  Desktop / Phone and get Back to Bookings. Esc goes back too (unless a picker inside the page is open). */
export function GuestMode({ play, state, onClose, onBooked, onGuestCancel, onGuestMove }: GuestPlayerProps) {
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('[role="dialog"], [role="listbox"], [role="menu"], input, textarea')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { back.current?.focus(); }, []);
  const page = state.pages.find((p) => p.id === play?.pageId);
  if (!play || !page) return null;
  const scenario = play.scenario;
  return (
    <div className="tf-bkf-guestmode">
      <header className="tf-bkf-guestmode__bar" aria-label="Guest mode">
        <span className="tf-bkf-guestmode__label"><Eye {...i14} aria-hidden="true" />Viewing as a guest</span>
        <SegmentedControl aria-label="Device" size="sm" selectedKey={device} onSelectionChange={(k) => setDevice(k === 'phone' ? 'phone' : 'desktop')}
          items={[{ id: 'desktop', label: 'Desktop', icon: <Monitor {...i14} /> }, { id: 'phone', label: 'Phone', icon: <Smartphone {...i14} /> }]} />
        <span className="tf-bkf-guestmode__url">{pageUrl(page.slug)}</span>
        <span className="tf-bkf__spacer" />
        <AriaButton ref={back} className="tf-bkf-guestmode__back" onPress={onClose}><ArrowLeft {...i14} aria-hidden="true" />Back to Bookings</AriaButton>
      </header>
      <main className="tf-bkf-guestmode__page" data-device={device}>
        <div className="tf-bkf-guestmode__frame" data-device={device}>
          <Screen key={`${scenario}-${page.id}`} scenario={scenario} page={page} state={state} meetingId={play.meetingId} onBooked={onBooked} onGuestCancel={onGuestCancel} onGuestMove={onGuestMove} />
        </div>
      </main>
    </div>
  );
}

/** "Powered by Timefix" under the guest pages Timefix draws itself (BookingFlow and the chat carry their own). */
function PoweredBy() {
  return <a className="tf-bkf__powered" href="https://www.timefix.com" target="_blank" rel="noreferrer"><span>Powered by</span><Logo size={16} /></a>;
}
/** A guest card centred on the page, with the foot. */
function GuestCard({ children, align = 'center' }: { readonly children: ReactNode; readonly align?: 'center' | 'start' }) {
  return (
    <div className="tf-bkf__guest-page">
      <div className={align === 'start' ? 'tf-bkf__guest-card tf-bkf__guest-card--start' : 'tf-bkf__guest-card'}>{children}</div>
      <PoweredBy />
    </div>
  );
}

function Screen({ scenario, page, state, meetingId, onBooked, onGuestCancel, onGuestMove }: { readonly scenario: GuestScenario; readonly page: BookingPage; readonly state: BookingsState; readonly meetingId?: string } & Pick<GuestPlayerProps, 'onBooked' | 'onGuestCancel' | 'onGuestMove'>) {
  if (scenario === 'hidden' || (!page.isOn && scenario === 'book')) {
    return <GuestCard><EmptyState size="sm" icon={<EyeOff size={20} strokeWidth={1.75} />} title="This page isn't taking bookings right now" description={`${first(page.owner)} has paused ${page.name}. Try again later, or email them.`}
      action={<Button size="sm" icon={<Mail {...i14} />}>Email {first(page.owner)}</Button>} /></GuestCard>;
  }
  if (scenario === 'expired') {
    return <GuestCard><EmptyState size="sm" icon={<Link2Off size={20} strokeWidth={1.75} />} title="This link has been used" description={`It was for one booking with ${first(page.owner)}. Ask them for a new one.`}
      action={<Button size="sm" icon={<Mail {...i14} />}>Email {first(page.owner)}</Button>} /></GuestCard>;
  }
  if (scenario === 'pending') return <Pending page={page} when={undefined} />;
  if (scenario === 'manage') return <Manage page={page} state={state} meeting={state.meetings.find((m) => m.id === meetingId) ?? state.meetings.find((m) => m.pageId === page.id && m.status === 'confirmed' && m.start > new Date())} onGuestCancel={onGuestCancel} onGuestMove={onGuestMove} />;
  if (scenario === 'offered') return <Offered page={page} onBooked={onBooked} />;
  if (scenario === 'chat') return <Chat page={page} state={state} onBooked={onBooked} />;
  return <Book page={page} state={state} onBooked={onBooked} />;
}

/** The booking page, with a length or place choice first when the page offers several. */
function Book({ page, state, onBooked }: { readonly page: BookingPage; readonly state: BookingsState } & Pick<GuestPlayerProps, 'onBooked'>) {
  const [length, setLength] = useState(lengthOf(page));
  const [place, setPlace] = useState<PlaceKind>(placeOf(page));
  const [requested, setRequested] = useState<string>();
  if (requested) return <Pending page={page} when={requested} />;
  return (
    <div className="tf-bkf__guest">
      {page.whoCanBook === 'form' && <Callout tone="info" className="tf-bkf__guest-note">You answered the {page.formName} form. Now pick a time.</Callout>}
      <GuestView page={page} state={state} length={length} place={place} onLength={setLength} onPlace={setPlace}
        onBook={(r) => new Promise<void>((resolve) => { window.setTimeout(() => {
          onBooked(page, { ...r, length, place });
          if (page.confirmFirst) setRequested(`${formatLongDay(new Date(r.date.year, r.date.month - 1, r.date.day))} · ${formatClockRange(r.minutes, r.minutes + length)}`);
          resolve();
        }, 700); })} />
    </div>
  );
}

/** A request waiting: "Priya will confirm your time". */
function Pending({ page, when }: { readonly page: BookingPage; readonly when: string | undefined }) {
  return (
    <GuestCard>
      <span className="tf-bkf__guest-icon" aria-hidden="true"><Clock size={20} strokeWidth={1.75} /></span>
      <h2 className="tf-bkf__guest-title">Request sent</h2>
      <p className="tf-bkf__muted">{first(page.owner)} will confirm your time. You'll get an email either way, usually within a day.</p>
      <dl className="tf-bkf__answers">
        <div><dt>What</dt><dd>{page.name} with {page.owner}</dd></div>
        <div><dt>When</dt><dd className="tf-num">{when ?? `${formatLongDay(dayFrom(new Date(), 2))} · ${formatClockRange(15 * 60, 15 * 60 + lengthOf(page))}`}</dd></div>
        <div><dt>Where</dt><dd>{placeLabel(page, placeOf(page))}</dd></div>
      </dl>
    </GuestCard>
  );
}

/** The guest's own Manage booking page: reschedule or cancel. */
function Manage({ page, state, meeting, onGuestCancel, onGuestMove }: { readonly page: BookingPage; readonly state: BookingsState; readonly meeting: BookedMeeting | undefined } & Pick<GuestPlayerProps, 'onGuestCancel' | 'onGuestMove'>) {
  const [mode, setMode] = useState<'view' | 'move' | 'cancel' | 'moved' | 'cancelled'>('view');
  const [reason, setReason] = useState('');
  if (!meeting) return <GuestCard><EmptyState size="sm" icon={<CalendarX2 size={20} strokeWidth={1.75} />} title="No upcoming booking" description="Book one first, then open this from the email." /></GuestCard>;
  if (mode === 'moved' || mode === 'cancelled') {
    return (
      <GuestCard>
        <span className="tf-bkf__guest-icon tf-bkf__guest-icon--ok" aria-hidden="true"><SuccessCheck size={20} /></span>
        <h2 className="tf-bkf__guest-title">{mode === 'moved' ? 'Moved' : 'Cancelled'}</h2>
        <p className="tf-bkf__muted">{mode === 'moved' ? `${first(meeting.host)} has the new time. A new invitation is on its way.` : `${first(meeting.host)} has been told. Book again any time.`}</p>
      </GuestCard>
    );
  }
  if (mode === 'move') {
    return (
      <div className="tf-bkf__guest">
        <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => setMode('view')}>Back to your booking</Button>
        <GuestView page={page} state={{ ...state, meetings: state.meetings.filter((m) => m.id !== meeting.id) }} length={(meeting.end.getTime() - meeting.start.getTime()) / 60_000}
          onBook={(r) => new Promise<void>((resolve) => { window.setTimeout(() => { onGuestMove(meeting, at(new Date(r.date.year, r.date.month - 1, r.date.day), r.minutes)); setMode('moved'); resolve(); }, 600); })} />
      </div>
    );
  }
  return (
    <GuestCard>
      <Avatar name={meeting.host} size={44} />
      <h2 className="tf-bkf__guest-title">{meeting.title} with {meeting.host}</h2>
      <dl className="tf-bkf__answers">
        <div><dt>When</dt><dd className="tf-num">{meetingWhen(meeting)}</dd></div>
        <div><dt>Where</dt><dd>{meeting.placeLabel}</dd></div>
        <div><dt>Booked as</dt><dd>{meeting.invitee.name} · {meeting.invitee.email}</dd></div>
      </dl>
      {mode === 'cancel' ? (
        <div className="tf-bkf__stack tf-bkf__full">
          <TextArea label="Anything to tell them?" aside="Optional" rows={2} value={reason} onChange={setReason} size="lg" />
          <div className="tf-bkf__row"><Button variant="ghost" onPress={() => setMode('view')}>Keep it</Button><Button variant="danger" onPress={() => { onGuestCancel(meeting, reason.trim()); setMode('cancelled'); }}>Cancel booking</Button></div>
        </div>
      ) : (
        <div className="tf-bkf__row">
          <Button variant="secondary" icon={<CalendarClock {...i14} />} onPress={() => setMode('move')}>Reschedule</Button>
          <Button variant="ghost" onPress={() => setMode('cancel')}>Cancel booking</Button>
        </div>
      )}
    </GuestCard>
  );
}

/** A link that offers only the host's picked times. */
function Offered({ page, onBooked }: { readonly page: BookingPage } & Pick<GuestPlayerProps, 'onBooked'>) {
  const offer = page.offers[page.offers.length - 1];
  const [slot, setSlot] = useState<string>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  if (!offer) return <GuestCard><EmptyState size="sm" icon={<Clock size={20} strokeWidth={1.75} />} title="No times offered yet" description="Use Share › Offer specific times on this page first." /></GuestCard>;
  if (done) return <GuestCard><span className="tf-bkf__guest-icon tf-bkf__guest-icon--ok" aria-hidden="true"><SuccessCheck size={20} /></span><h2 className="tf-bkf__guest-title">You're booked</h2><p className="tf-bkf__muted">An invitation is on its way to {email}.</p></GuestCard>;
  const len = lengthOf(page);
  return (
    <GuestCard align="start">
      <Avatar name={page.owner} size={44} />
      <h2 className="tf-bkf__guest-title">{page.name} with {page.owner}</h2>
      <p className="tf-bkf__muted">{first(page.owner)} picked these times for you. Choose one.</p>
      <ChoiceChips label="Times" isLabelHidden size="md" selectedKeys={slot ? [slot] : []} onSelectionChange={(k) => setSlot([...k][0])}
        items={offer.slots.map((s) => ({ id: `${s.day}T${s.start}`, label: `${formatDay(parseDay(s.day))} · ${formatClockRange(s.start, s.start + len)}` }))} />
      <TextField label="Name" size="lg" value={name} onChange={setName} className="tf-bkf__full" />
      <TextField label="Email" size="lg" type="email" value={email} onChange={setEmail} className="tf-bkf__full" />
      <Button variant="primary" size="lg" className="tf-bkf__full" isDisabled={!slot || !name.trim() || !email.includes('@')} onPress={() => {
        const [day, start] = (slot ?? '').split('T');
        const d = parseDay(day ?? isoDay(new Date()));
        onBooked(page, { name, email, notes: '', date: new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), minutes: Number(start), timeZone: 'Asia/Kolkata', length: len, place: placeOf(page) });
        setDone(true);
      }}>Book</Button>
    </GuestCard>
  );
}

/** Booking by chat: the guest says when suits, the page offers times, one press books. */
function Chat({ page, state, onBooked }: { readonly page: BookingPage; readonly state: BookingsState } & Pick<GuestPlayerProps, 'onBooked'>) {
  const [lines, setLines] = useState<ReadonlyArray<BookingChatLine>>([{ id: 'h0', role: 'host', text: `Hi, I'm ${first(page.owner)}'s booking assistant. When works for you?`, suggestions: ['Tomorrow morning', 'Later this week', 'Next week'] }]);
  const [thinking, setThinking] = useState(false);
  const [booked, setBooked] = useState<BookingChatBooked>();
  const days = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 14 }, (_, n) => dayFrom(now, n + 1)).map((d) => ({ d, times: openTimes(page, state, d, now) })).filter((x) => x.times.length > 0);
  }, [page, state]);
  const send = (text: string) => {
    setLines((l) => [...l, { id: `g${l.length}`, role: 'guest', text }]);
    setThinking(true);
    window.setTimeout(() => {
      const morning = /morning/i.test(text);
      const later = /next week/i.test(text) ? days.slice(3, 5) : days.slice(0, 2);
      setThinking(false);
      setLines((l) => [...l, {
        id: `h${l.length}`, role: 'host', text: later.length ? `Here's what's open${morning ? ' in the morning' : ''}:` : 'Nothing is open then. Try another week?',
        days: later.map(({ d, times }) => ({ day: formatDay(d), times: times.filter((t) => !morning || t < 12 * 60).slice(0, 4).map((t) => ({ id: `${isoDay(d)}T${t}`, label: formatClockRange(t, t).split(' – ')[0] ?? '' })) })),
      }]);
    }, 900);
  };
  return (
    <BookingChat host={{ name: page.owner }} title={page.name.includes(`${lengthOf(page)} min`) ? page.name : `${page.name} · ${lengthOf(page)} min`} lines={lines} isThinking={thinking} thinking={['Checking the calendar', 'Finding open times']} booked={booked}
      onSend={send} onPickTime={(time) => new Promise<void>((resolve) => {
        window.setTimeout(() => {
          const [day, start] = time.id.split('T');
          const d = parseDay(day ?? isoDay(new Date()));
          const m = Number(start);
          onBooked(page, { name: 'Maria Bell', email: 'maria@acme.com', notes: 'Booked by chat', date: new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), minutes: m, timeZone: 'Asia/Kolkata', length: lengthOf(page), place: placeOf(page) });
          setBooked({ title: `${page.name} with ${page.owner}`, when: `${formatLongDay(d)} · ${formatClockRange(m, m + lengthOf(page))}`, where: PLACES[placeOf(page)].label, email: 'maria@acme.com' });
          resolve();
        }, 700);
      })} />
  );
}
