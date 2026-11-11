// Step 6, the guest's side, full screen (Desktop or Phone): the booking page, a request waiting, Manage booking, an expired one-time link,
// a hidden page, a page offering only picked times, and the booking chat.
import { useGuestScale } from '../../lib/guest-scale.ts';
import { Link } from '../Link/Link.tsx';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDate } from '@internationalized/date';
import { ArrowLeft, CalendarClock, CalendarPlus, ChevronRight, CalendarX2, Clock, Eye, EyeOff, Link2Off, Mail, Monitor, Smartphone } from 'lucide-react';
import type { BookingRequest } from '../BookingFlow/BookingFlow.tsx';
import { BrandCard } from '../BookingFlow/BookingFlow.tsx';
import { VenueGuest, type OnWaitlist } from './guest-venue.tsx';
import { MenuPage } from '../MenuPage/MenuPage.tsx';
import { BookingChat, type BookingChatLine, type BookingChatBooked } from '../BookingChat/BookingChat.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Button as AriaButton } from 'react-aria-components';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import { formatClock, formatClockRange } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { icsFor } from '../../lib/ics.ts';
import { saveFile } from '../../lib/saveFile.ts';
import { GuestView, i14 } from './parts.tsx';
import { PLACES, at, dayFrom, first, homeUrl, isoDay, lengthOf, meetingWhen, openTimes, pageUrl, parseDay, placeLabel, placeOf, plural, type BookedMeeting, type BookingPage, type BookingsState, type PlaceKind, handleOf } from './state.ts';

/** What the guest view plays. */
export type GuestScenario = 'book' | 'pending' | 'manage' | 'expired' | 'hidden' | 'offered' | 'chat' | 'profile' | 'taken' | 'menu';
/** Each scenario's name in the Demo menu. */
export const GUEST_SCENARIOS: ReadonlyArray<{ readonly id: GuestScenario; readonly label: string }> = [
  { id: 'book', label: 'Book a time' }, { id: 'profile', label: 'Your profile page' }, { id: 'pending', label: 'A request waiting' }, { id: 'taken', label: 'Someone takes the time first' }, { id: 'manage', label: 'Manage a booking' },
  { id: 'offered', label: 'Picked times only' }, { id: 'chat', label: 'Book by chat' }, { id: 'expired', label: 'An expired one-time link' }, { id: 'hidden', label: 'A hidden page' },
];

/** Props for GuestMode. */
export interface GuestPlayerProps {
  readonly play: { readonly scenario: GuestScenario; readonly pageId: string; readonly meetingId?: string; /** A table's code, from its QR. */ readonly table?: string; /** Someone who just sent a form: their name and email carry over. */ readonly prefill?: { readonly name: string; readonly email: string } } | undefined;
  readonly state: BookingsState;
  readonly onClose: () => void;
  /** A booking made as the guest; the host side plays it when the view closes. */
  readonly onBooked: (page: BookingPage, r: BookingRequest & { readonly length: number; readonly place: PlaceKind; readonly party?: number; readonly phone?: string; readonly occasion?: string; readonly area?: string }) => boolean | void;
  /** A restaurant guest asked to be told when a table frees up. */
  readonly onWaitlist?: OnWaitlist;
  /** A guest at a table (from its QR menu) calls a waiter or asks for the bill. */
  readonly onTableRequest?: (tableId: string, kind: 'waiter' | 'bill') => void;
  readonly onGuestCancel: (m: BookedMeeting, reason: string) => void;
  readonly onGuestMove: (m: BookedMeeting, start: Date) => boolean | void;
  /** The guest changes the booking they just made, on its success screen: the host side gets the change, not the original. */
  readonly onBookedChange?: (c: BookedChange) => void;
}
/** A change to the booking just made. */
export type BookedChange = { readonly kind: 'cancel' } | { readonly kind: 'move'; readonly date: CalendarDate; readonly minutes: number } | { readonly kind: 'guests'; readonly guests: ReadonlyArray<string> };

/** Guest mode: the admin app steps aside for the public page exactly as a guest sees it, on the canvas, with a slim bar to switch
 *  Desktop / Phone and get Back to Bookings. Esc goes back too (unless a picker inside the page is open). */
export function GuestMode({ play, state, onClose, onBooked, onGuestCancel, onGuestMove, onBookedChange, onWaitlist, onTableRequest }: GuestPlayerProps) {
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
  useGuestScale(Boolean(play && page));
  if (!play || !page) return null;
  const scenario = play.scenario;
  return (
    <div className="tf-bkf-guestmode">
      <header className="tf-bkf-guestmode__bar" aria-label="Guest mode">
        <span className="tf-bkf-guestmode__label"><Eye {...i14} aria-hidden="true" />Viewing as a guest</span>
        <SegmentedControl aria-label="Device" size="sm" selectedKey={device} onSelectionChange={(k) => setDevice(k === 'phone' ? 'phone' : 'desktop')}
          items={[{ id: 'desktop', label: 'Desktop', icon: <Monitor {...i14} /> }, { id: 'phone', label: 'Phone', icon: <Smartphone {...i14} /> }]} />
        <span className="tf-bkf-guestmode__url">{scenario === 'profile' ? homeUrl(state) : scenario === 'menu' ? `${homeUrl(state)}/menu${play.table ? `?t=${play.table}` : ''}` : pageUrl(page.slug, state.business?.handle)}</span>
        <span className="tf-bkf__spacer" />
        <AriaButton ref={back} className="tf-bkf-guestmode__back" onPress={onClose}><ArrowLeft {...i14} aria-hidden="true" />Back to Bookings</AriaButton>
      </header>
      <main className="tf-bkf-guestmode__page" data-device={device} data-venue={scenario === 'profile' || scenario === 'menu' || (scenario === 'book' && page?.kind === 'table') || undefined}>
        <div className="tf-bkf-guestmode__frame" data-device={device}>
          <Screen key={`${scenario}-${page.id}`} scenario={scenario} page={page} state={state} meetingId={play.meetingId} table={play.table} prefill={play.prefill} onBooked={onBooked} onGuestCancel={onGuestCancel} onGuestMove={onGuestMove} onBookedChange={onBookedChange} onWaitlist={onWaitlist} onTableRequest={onTableRequest} />
        </div>
      </main>
    </div>
  );
}

/** "Powered by Timefix" under the guest pages Timefix draws itself (BookingFlow and the chat carry their own). */
function PoweredBy() {
  return <div className="tf-bkf__powered-row"><BrandCard className="tf-booking__brand--solo" /></div>;
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

function Screen({ scenario, page, state, meetingId, table, prefill, onBooked, onGuestCancel, onGuestMove, onBookedChange, onWaitlist, onTableRequest }: { readonly scenario: GuestScenario; readonly page: BookingPage; readonly state: BookingsState; readonly meetingId?: string; readonly table?: string; readonly prefill?: { readonly name: string; readonly email: string } } & Pick<GuestPlayerProps, 'onBooked' | 'onGuestCancel' | 'onGuestMove' | 'onBookedChange' | 'onWaitlist' | 'onTableRequest'>) {
  if (scenario === 'hidden' || (!page.isOn && scenario === 'book')) {
    return <GuestCard><EmptyState size="sm" icon={<EyeOff size={20} strokeWidth={1.75} />} title="This page isn't taking bookings right now" description={`${first(page.owner)} has paused ${page.name}. Try again later, or email them.`}
      action={<ContactOwner owner={page.owner} email={`${first(page.owner).toLowerCase()}@${state.business ? `${handleOf(state)}.com` : 'northwind.com'}`} />} /></GuestCard>;
  }
  if (scenario === 'expired') {
    return <GuestCard><EmptyState size="sm" icon={<Link2Off size={20} strokeWidth={1.75} />} title="This link has been used" description={`It was for one booking with ${first(page.owner)}. Ask them for a new one.`}
      action={<ContactOwner owner={page.owner} email={`${first(page.owner).toLowerCase()}@${state.business ? `${handleOf(state)}.com` : 'northwind.com'}`} />} /></GuestCard>;
  }
  if (scenario === 'pending') { const w = state.meetings.find((m) => m.pageId === page.id && m.status === 'pending' && m.start > new Date()); return <Pending page={page} when={w ? meetingWhen(w) : undefined} />; }
  if (scenario === 'manage') return <Manage page={page} state={state} meeting={state.meetings.find((m) => m.id === meetingId) ?? state.meetings.find((m) => m.pageId === page.id && m.status === 'confirmed' && m.start > new Date())} onGuestCancel={onGuestCancel} onGuestMove={onGuestMove} />;
  if (scenario === 'offered') return <Offered page={page} state={state} onBooked={onBooked} />;
  if (scenario === 'chat') return <Chat page={page} state={state} onBooked={onBooked} />;
  if (scenario === 'profile') return <Profile owner={page.owner} state={state} onBooked={onBooked} onBookedChange={onBookedChange} onWaitlist={onWaitlist} />;
  if (scenario === 'menu') return <Profile owner={page.owner} state={state} onBooked={onBooked} onBookedChange={onBookedChange} onWaitlist={onWaitlist} startOnMenu table={table} onTableRequest={onTableRequest} />;
  // A table page's own link opens the restaurant's page with the table card, as booking sites do.
  if (page.kind === 'table') return <Profile owner={page.owner} state={state} onBooked={onBooked} onBookedChange={onBookedChange} onWaitlist={onWaitlist} />;
  return <Book page={page} state={state} onBooked={onBooked} onBookedChange={onBookedChange} failFirst={scenario === 'taken'} prefill={prefill} />;
}

/** The profile page (timefix.com/priya): every public page the person hosts; picking one opens it. */
function Profile({ owner, state, onBooked, onBookedChange, onWaitlist, startOnMenu = false, table, onTableRequest }: { readonly owner: string; readonly state: BookingsState; readonly startOnMenu?: boolean; readonly table?: string } & Pick<GuestPlayerProps, 'onBooked' | 'onBookedChange' | 'onWaitlist' | 'onTableRequest'>) {
  const [open, setOpen] = useState<string>();
  // The menu link and the venue page lead to each other: "See the full menu" one way, "Book a table" the other.
  const [onMenu, setOnMenu] = useState(startOnMenu);
  const chosen = state.pages.find((p) => p.id === open);
  if (chosen) {
    return (
      <div className="tf-bkf__profile-back-wrap">
        <Link onPress={() => setOpen(undefined)} weight="strong" className="tf-bkf__profile-back"><ArrowLeft {...i14} aria-hidden="true" />All of {first(owner)}’s meetings</Link>
        <Book page={chosen} state={state} onBooked={onBooked} onBookedChange={onBookedChange} />
      </div>
    );
  }
  if (onMenu) {
    const live = state.menuLive;
    const at = state.tables?.find((t) => t.code === table || t.name.toLowerCase() === table?.toLowerCase());
    const now = new Date();
    return (
      <MenuPage venue={state.workspace} line={state.business?.address} cover={state.business?.photos[0]} menus={live?.menus ?? []} dishes={live?.dishes ?? []} addOns={live?.addOns ?? []}
        table={at?.name.replace(/^T/, '')} now={now.getHours() * 60 + now.getMinutes()} onBookTable={state.pages.some((p) => p.kind === 'table' && p.isOn) ? () => setOnMenu(false) : undefined} foot={<PoweredBy />}
        onRequest={at && onTableRequest ? (k) => onTableRequest(at.id, k) : undefined} requested={(state.tableRequests ?? []).filter((r) => r.tableId === at?.id).map((r) => r.kind)} />
    );
  }
  return <VenueGuest state={state} onBooked={onBooked} onWaitlist={onWaitlist} onOpenPage={(p) => setOpen(p.id)} onOpenMenu={() => setOnMenu(true)} />;
}

/** The booking page, with a length or place choice first when the page offers several. */
function Book({ page, state, onBooked, onBookedChange, failFirst = false, prefill }: { readonly page: BookingPage; readonly state: BookingsState; readonly failFirst?: boolean; readonly prefill?: { readonly name: string; readonly email: string } } & Pick<GuestPlayerProps, 'onBooked' | 'onBookedChange'>) {
  const tries = useRef(0);
  const [length, setLength] = useState(lengthOf(page));
  const [place, setPlace] = useState<PlaceKind>(placeOf(page));
  const [requested, setRequested] = useState<string>();
  const [chatBooked, setChatBooked] = useState<{ readonly name: string; readonly email: string; readonly date: CalendarDate; readonly minutes: number }>();
  if (requested) return <Pending page={page} when={requested} />;
  return (
    <div className="tf-bkf__guest">
      {(page.whoCanBook === 'form' || prefill) && <Callout tone="info" className="tf-bkf__guest-note">{prefill ? `Thanks, ${prefill.name.split(' ')[0]}. Now pick a time.` : `You answered the ${page.formName} form. Now pick a time.`}</Callout>}
      <GuestView guestIs={prefill} page={page} state={state} length={length} place={place} onLength={setLength} onPlace={setPlace} chat={<Chat page={page} state={state} onBooked={onBooked} embedded length={length} place={place}
        onDone={(b) => { if (page.confirmFirst) setRequested(`${formatLongDay(new Date(b.date.year, b.date.month - 1, b.date.day))} · ${formatClockRange(b.minutes, b.minutes + length)}`); else setChatBooked(b); }} />} chatBooked={chatBooked}
        after={{ onCancelled: () => onBookedChange?.({ kind: 'cancel' }), onMoved: (date, minutes) => onBookedChange?.({ kind: 'move', date, minutes }), onGuestsChange: (guests) => onBookedChange?.({ kind: 'guests', guests }) }}
        onBook={(r) => new Promise<void>((resolve, reject) => { window.setTimeout(() => {
          tries.current += 1;
          if (failFirst && tries.current === 1) { reject(new Error('taken')); return; }
          if (onBooked(page, { ...r, length, place }) === false) { reject(new Error('taken')); return; }
          if (page.confirmFirst) setRequested(`${formatLongDay(new Date(r.date.year, r.date.month - 1, r.date.day))} · ${formatClockRange(r.minutes, r.minutes + length)}`);
          resolve();
        }, 700); })} />
    </div>
  );
}

/** How a guest reaches the owner when a page can't book: the address shown and copied (mail links don't open everywhere). */
function ContactOwner({ owner, email }: { readonly owner: string; readonly email: string }) {
  const [copied, setCopied] = useState(false);
  return <span className="tf-bkf__row"><span className="tf-bkf__muted tf-num">{email}</span>
    <Button size="sm" icon={<Mail {...i14} />} onPress={() => { void navigator.clipboard.writeText(email).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? 'Copied' : `Copy ${first(owner)}’s email`}</Button></span>;
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
        {when && <div><dt>When</dt><dd className="tf-num">{when}</dd></div>}
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
        <GuestView page={page} state={{ ...state, meetings: state.meetings.filter((m) => m.id !== meeting.id) }} length={(meeting.end.getTime() - meeting.start.getTime()) / 60_000} guestIs={meeting.invitee}
          onBook={(r) => new Promise<void>((resolve, reject) => { window.setTimeout(() => { if (onGuestMove(meeting, at(new Date(r.date.year, r.date.month - 1, r.date.day), r.minutes)) === false) { reject(new Error('taken')); return; } setMode('moved'); resolve(); }, 600); })} />
      </div>
    );
  }
  return (
    <GuestCard>
      <Avatar name={meeting.host} size={44} />
      <h2 className="tf-bkf__guest-title">{meeting.tables?.length ? `${meeting.title} at ${state.workspace}` : `${meeting.title} with ${meeting.host}`}</h2>
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
      ) : (() => {
        // The page's cut-offs hold here too: too close to the time, the guest is told who to contact instead.
        const hoursLeft = (meeting.start.getTime() - Date.now()) / 3_600_000;
        const canMove = !page.moveCutoff || hoursLeft > page.moveCutoff; const canCancel = !page.cancelCutoff || hoursLeft > page.cancelCutoff;
        return (<>
          {(() => {
            // One plain line: what they can still do online and until when, then what's too late and who to reach.
            const until = (h: number) => { const by = new Date(meeting.start.getTime() - h * 3_600_000); return `${formatDay(by)}, ${formatClock(by.getHours() * 60 + by.getMinutes())}`; };
            // The owner's own "too late" message covers the case where nothing can be changed online; a partial block gets the plain line.
            const reach = `Reply to your confirmation email to reach ${first(meeting.host)}.`;
            if (!canMove && !canCancel) return <p className="tf-bkf__muted">{page.tooLateMessage || <>It’s too close to change online (within {plural(Math.min(page.moveCutoff ?? 0, page.cancelCutoff ?? 0) || Math.max(page.moveCutoff ?? 0, page.cancelCutoff ?? 0), 'hour')}). {reach}</>}</p>;
            if (!canMove) return <p className="tf-bkf__muted tf-num">You can cancel this online{page.cancelCutoff ? ` until ${until(page.cancelCutoff)}` : ''}. It’s too close to move it online (within {plural(page.moveCutoff ?? 0, 'hour')}). {reach}</p>;
            if (!canCancel) return <p className="tf-bkf__muted tf-num">You can move this online{page.moveCutoff ? ` until ${until(page.moveCutoff)}` : ''}. It’s too close to cancel online (within {plural(page.cancelCutoff ?? 0, 'hour')}). {reach}</p>;
            const h = Math.max(page.moveCutoff ?? 0, page.cancelCutoff ?? 0);
            return h ? <p className="tf-bkf__muted tf-num">You can change or cancel this online until {until(h)}.</p> : null;
          })()}
          <div className="tf-bkf__row">
            {canMove && <Button variant="secondary" icon={<CalendarClock {...i14} />} onPress={() => setMode('move')}>Reschedule</Button>}
            {canCancel && <Button variant="ghost" onPress={() => setMode('cancel')}>Cancel booking</Button>}
            <Button variant="ghost" icon={<CalendarPlus {...i14} />} onPress={() => { void saveFile(`${meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`, new Blob([icsFor(meeting.title, meeting.placeLabel, meeting.start, Math.round((meeting.end.getTime() - meeting.start.getTime()) / 60_000))], { type: 'text/calendar' })); }}>Add to calendar</Button>
          </div>
        </>);
      })()}
    </GuestCard>
  );
}

/** A link that offers only the host's picked times. */
function Offered({ page, state, onBooked }: { readonly page: BookingPage; readonly state: BookingsState } & Pick<GuestPlayerProps, 'onBooked'>) {
  const offer = page.offers[page.offers.length - 1];
  const [slot, setSlot] = useState<string>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  if (!offer) return <GuestCard><EmptyState size="sm" icon={<Clock size={20} strokeWidth={1.75} />} title="No times offered yet" description="Use Share › Offer specific times on this page first." /></GuestCard>;
  const len = lengthOf(page);
  // An offered time is used up once someone books it, and gone once it has passed.
  const taken = (s: { readonly day: string; readonly start: number }) => { const at0 = at(parseDay(s.day), s.start); return at0 < new Date() || state.meetings.some((m) => m.pageId === page.id && m.status !== 'cancelled' && m.start.getTime() === at0.getTime()); };
  const open = offer.slots.filter((s) => !taken(s));
  if (!done && open.length === 0) return <GuestCard><EmptyState size="sm" icon={<Clock size={20} strokeWidth={1.75} />} title="These times have gone" description={`They were booked or have passed. Ask ${first(page.owner)} for new ones.`} /></GuestCard>;
  if (done && page.confirmFirst && slot) { const [dd, st] = slot.split('T'); return <Pending page={page} when={`${formatLongDay(parseDay(dd ?? ''))} · ${formatClockRange(Number(st), Number(st) + len)}`} />; }
  if (done) return <GuestCard><span className="tf-bkf__guest-icon tf-bkf__guest-icon--ok" aria-hidden="true"><SuccessCheck size={20} /></span><h2 className="tf-bkf__guest-title">You're booked</h2><p className="tf-bkf__muted">An invitation is on its way to {email}.</p></GuestCard>;
  return (
    <GuestCard align="start">
      <Avatar name={page.owner} size={44} />
      <h2 className="tf-bkf__guest-title">{page.name} with {page.owner}</h2>
      <p className="tf-bkf__muted">{first(page.owner)} picked these times for you. Choose one. Times are India time (IST).</p>
      {gone && <p className="tf-bkf__error" role="alert">That time was just taken. Pick another.</p>}
      <ChoiceChips label="Times" isLabelHidden size="md" selectedKeys={slot ? [slot] : []} onSelectionChange={(k) => setSlot([...k][0])}
        items={open.map((s) => ({ id: `${s.day}T${s.start}`, label: `${formatDay(parseDay(s.day))} · ${formatClockRange(s.start, s.start + len)}` }))} />
      <TextField label="Name" size="lg" value={name} onChange={setName} className="tf-bkf__full" />
      <TextField label="Email" size="lg" type="email" value={email} onChange={setEmail} className="tf-bkf__full" />
      <Button variant="primary" size="lg" className="tf-bkf__full" isDisabled={!slot || !name.trim() || !email.includes('@')} onPress={() => {
        const [day, start] = (slot ?? '').split('T');
        const d = parseDay(day ?? isoDay(new Date()));
        if (onBooked(page, { name, email, notes: '', date: new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), minutes: Number(start), timeZone: 'Asia/Kolkata', length: len, place: placeOf(page) }) === false) { setSlot(undefined); setGone(true); return; }
        setDone(true);
      }}>Book</Button>
    </GuestCard>
  );
}

/** Booking by chat: the guest says when suits, the page offers times, one press books. */
function Chat({ page, state, onBooked, embedded = false, onDone, length, place }: {
  readonly page: BookingPage; readonly state: BookingsState; readonly embedded?: boolean;
  /** Inside the booking card: hand the booking to the card's success screen instead of drawing a booked card in the thread. */
  readonly onDone?: (b: { readonly name: string; readonly email: string; readonly date: CalendarDate; readonly minutes: number }) => void;
  /** The length and place the guest chose in the card (inside the booking card); else the page's first. */
  readonly length?: number; readonly place?: PlaceKind;
} & Pick<GuestPlayerProps, 'onBooked'>) {
  const len = length ?? lengthOf(page);
  const where = place ?? placeOf(page);
  const [lines, setLines] = useState<ReadonlyArray<BookingChatLine>>([{ id: 'h0', role: 'host', text: `Hi, I'm ${first(page.owner)}'s booking assistant. When works for you?`, suggestions: ['Tomorrow morning', 'Later this week', 'Next week'] }]);
  const [thinking, setThinking] = useState(false);
  const [booked, setBooked] = useState<BookingChatBooked>();
  const days = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 14 }, (_, n) => dayFrom(now, n + 1)).map((d) => ({ d, times: openTimes(page, state, d, now, len) })).filter((x) => x.times.length > 0);
  }, [page, state, len]);
  // After a time is picked the assistant asks for a name, then an email, and only then books.
  const [stage, setStage] = useState<'time' | 'name' | 'email' | 'booking'>('time');
  const [chosen, setChosen] = useState<{ readonly d: Date; readonly m: number }>();
  const [who, setWho] = useState('');
  const say = (text: string) => setLines((l) => [...l, { id: `h${l.length}`, role: 'host', text }]);
  const reply = (text: string, ms = 600) => { setThinking(true); window.setTimeout(() => { setThinking(false); say(text); }, ms); };
  const book = (email: string) => {
    if (!chosen) return;
    setStage('booking'); setThinking(true);
    window.setTimeout(() => {
      setThinking(false);
      const date = new CalendarDate(chosen.d.getFullYear(), chosen.d.getMonth() + 1, chosen.d.getDate());
      if (onBooked(page, { name: who, email, notes: 'Booked by chat', date, minutes: chosen.m, timeZone: 'Asia/Kolkata', length: len, place: where }) === false) { setStage('time'); setChosen(undefined); say('Sorry, someone just took that time. When else works?'); return; }
      if (onDone) { onDone({ name: who, email, date, minutes: chosen.m }); return; }
      setBooked({ title: `${page.name} with ${page.owner}`, when: `${formatLongDay(chosen.d)} · ${formatClockRange(chosen.m, chosen.m + len)}`, where: placeLabel(page, where), email, isRequest: page.confirmFirst, host: first(page.owner) });
    }, 800);
  };
  const send = (text: string) => {
    setLines((l) => [...l, { id: `g${l.length}`, role: 'guest', text }]);
    if (stage === 'name') {
      const name = text.trim();
      if (name.length < 2) { reply('What name should I put on the booking?'); return; }
      setWho(name); setStage('email');
      reply(`Thanks, ${name.split(' ')[0]}. What email should the invite go to?`);
      return;
    }
    if (stage === 'email') {
      const email = text.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { reply('That doesn’t look like an email address. Could you check it?'); return; }
      book(email);
      return;
    }
    setThinking(true);
    window.setTimeout(() => {
      const morning = /morning/i.test(text);
      // Read what they said: tomorrow, later this week, next week; otherwise the next open days. Mornings keep only days with a morning time.
      const now = new Date(); const tomorrow = dayFrom(now, 1); const nextMonday = dayFrom(now, 7 - ((now.getDay() + 6) % 7)); const weekAfter = dayFrom(nextMonday, 7);
      const fits = days.filter(({ times }) => !morning || times.some((t) => t < 12 * 60));
      const pick = /tomorrow/i.test(text) ? fits.filter(({ d }) => d.toDateString() === tomorrow.toDateString())
        : /next week/i.test(text) ? fits.filter(({ d }) => d >= nextMonday && d < weekAfter)
        : /this week|later/i.test(text) ? fits.filter(({ d }) => d > tomorrow && d < nextMonday)
        : fits;
      const later = pick.slice(0, 2);
      setThinking(false);
      setLines((l) => [...l, {
        id: `h${l.length}`, role: 'host', text: later.length ? `Here's what's open${morning ? ' in the morning' : ''} (India time):` : 'Nothing is open then. Try another week?',
        days: later.map(({ d, times }) => ({ day: formatDay(d), times: times.filter((t) => !morning || t < 12 * 60).slice(0, 4).map((t) => ({ id: `${isoDay(d)}T${t}`, label: formatClock(t) })) })),
      }]);
    }, 900);
  };
  return (
    <BookingChat bare={embedded} host={{ name: page.owner }} title={page.name.includes(`${len} min`) ? page.name : `${page.name} · ${len} min`} lines={lines} isThinking={thinking} thinking={['Checking the calendar', 'Finding open times']} booked={booked}
      placeholder={stage === 'name' ? 'Your name' : stage === 'email' ? 'you@company.com' : 'When works for you?'}
      onSend={send} onPickTime={(time) => {
        const [day, start] = time.id.split('T');
        const d = parseDay(day ?? isoDay(new Date()));
        const m = Number(start);
        setChosen({ d, m }); setStage('name');
        setLines((l) => [...l, { id: `g${l.length}`, role: 'guest', text: `${formatDay(d)} at ${formatClock(m)}` }]);
        reply(`${formatLongDay(d)} at ${formatClock(m)} works. What name should I book it under?`, 500);
      }} />
  );
}
