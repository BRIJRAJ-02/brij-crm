// The workspace's own link (timefix.com/<handle>) as guests see it: the venue page, then Fresha's steps. One page for every kind:
// a salon books a service with a person, a restaurant a table for a party, a team a meeting.
import { useMemo, useState } from 'react';
import { CalendarDate } from '@internationalized/date';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Select } from '../Select/Select.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import { VenuePage, VenueCheckout, PersonTile, type Venue } from '../VenuePage/VenuePage.tsx';
import { dishPrice } from '../MenuPage/MenuPage.tsx';
import { HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { formatClock, formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { BrandCard, DayTimes } from '../BookingFlow/BookingFlow.tsx';
import { HOST, PLACES, at, dayFrom, first, isoDay, lengthOf, lengthsText, openTimes, placeOf, plural, priceText, turnFor, type BookingPage, type BookingsState, type PlaceKind, venueDay } from './state.ts';
import { saveFile } from '../../lib/saveFile.ts';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Store } from 'lucide-react';
import { icsFor } from '../../lib/ics.ts';
import { useToast } from '../Toast/Toast.tsx';

type OnBooked = (page: BookingPage, r: { readonly name: string; readonly email: string; readonly notes: string; readonly date: CalendarDate; readonly minutes: number; readonly timeZone: string; readonly length: number; readonly place: PlaceKind; readonly party?: number; readonly phone?: string; readonly occasion?: string; readonly area?: string }) => boolean | void;
/** A guest asking to be told when a table frees up. */
export type OnWaitlist = (w: { readonly name: string; readonly phone: string; readonly party: number; readonly day: string; readonly wanted?: number }) => void;
const OCCASIONS = ['Birthday', 'Anniversary', 'Date night', 'Business', 'Celebration'];
/** Times split by service: before 4 pm is lunch. */
const byService = (times: ReadonlyArray<number>) => [{ name: 'Lunch', times: times.filter((m) => m < 16 * 60) }, { name: 'Dinner', times: times.filter((m) => m >= 16 * 60) }].filter((g) => g.times.length > 0);
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** The venue as the page shows it: open now, today's hours first, the week below. */
function venueOf(state: BookingsState, now: Date): Venue {
  const b = state.business;
  const week = state.savedHours.find((h) => h.id === state.defaultHoursId)?.hours ?? state.savedHours[0]?.hours;
  const todayKey = HOURS_DAYS[(now.getDay() + 6) % 7] ?? 'mon';
  const today = venueDay(state, now);
  const m = minutesOf(now);
  const openRange = today?.on ? today.ranges.find((r) => r.start <= m && m < r.end) : undefined;
  const next = today?.on ? today.ranges.find((r) => r.start > m) : undefined;
  const status = !b ? (openRange || next ? 'Taking bookings today' : 'Next times from tomorrow') : openRange ? `Open now · closes at ${formatClock(openRange.end)}` : next ? `Closed · opens at ${formatClock(next.start)}` : (() => {
    // Closed for the rest of today: say when it next opens, so a guest isn't left guessing.
    for (let n = 1; n <= 7; n++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n); const h = venueDay(state, d); const r = h?.on ? h.ranges[0] : undefined; if (r) return `Closed · opens ${n === 1 ? 'tomorrow' : DAY_NAMES[(d.getDay() + 6) % 7]?.slice(0, 3) ?? ''} at ${formatClock(r.start)}`; }
    return 'Closed today';
  })();
  return {
    name: b ? state.workspace : HOST, kind: b?.kindLabel ?? 'Meetings', rating: b?.rating, reviews: b?.reviews, address: b?.address ?? 'Online, by video call', area: b?.area,
    phone: b?.phone, status, isOpen: b ? Boolean(openRange) : Boolean(openRange || next), isOnline: !b,
    about: b?.about ?? 'Pick a meeting to see open times. You get a calendar invite with the video link.', photos: b?.photos ?? [], amenities: b?.amenities,
    hours: week ? HOURS_DAYS.map((d, i) => ({ day: DAY_NAMES[i] ?? d, ranges: week[d].on ? week[d].ranges.map((r) => ({ start: r.start, end: r.end })) : [] })) : undefined,
  };
}

/** The guest's view of the workspace link. */
export function VenueGuest(props: { readonly state: BookingsState; readonly onBooked: OnBooked; readonly onOpenPage: (p: BookingPage) => void; readonly onWaitlist?: OnWaitlist; readonly onOpenMenu?: () => void }) {
  const b = props.state.business;
  // A page that isn't published yet says so to guests instead of taking bookings.
  if (b && !b.published) return <div className="tf-bkf__guest-page"><div className="tf-bkf__guest-card"><EmptyState size="sm" icon={<Store size={20} strokeWidth={1.75} />} title={`${props.state.workspace} isn’t taking bookings online yet`} description={b.phone ? `Call ${b.phone} to book.` : 'Check back soon.'} /></div></div>;
  return <VenueGuestPage {...props} />;
}

function VenueGuestPage({ state, onBooked, onOpenPage, onWaitlist, onOpenMenu }: { readonly state: BookingsState; readonly onBooked: OnBooked; readonly onOpenPage: (p: BookingPage) => void; readonly onWaitlist?: OnWaitlist; readonly onOpenMenu?: () => void }) {
  const now = new Date();
  const { toast } = useToast();
  const venue = venueOf(state, now);
  const b = state.business;
  const pages = state.pages.filter((p) => p.isOn && p.visibility !== 'link' && !p.inviteOnly && !p.linkKind && p.onLinkPage !== false && p.whoCanBook === 'anyone' && p.hostMode !== 'collective').slice().sort((a, b) => (a.linkOrder ?? 99) - (b.linkOrder ?? 99));
  const table = pages.find((p) => p.kind === 'table');
  const [pageId, setPageId] = useState<string>();
  const [step, setStep] = useState(0);
  const [who, setWho] = useState('any');
  const [length, setLength] = useState<number>();
  const [party, setParty] = useState(2);
  const [dayId, setDayId] = useState(isoDay(now));
  const [weekAt, setWeekAt] = useState(0);
  const [time, setTime] = useState<number>();
  /** The time was taken while they filled in details: they pick again. */
  const [taken, setTaken] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);
  const [phone, setPhone] = useState('');
  const [occasion, setOccasion] = useState('');
  const [area, setArea] = useState('any');
  const [waitMode, setWaitMode] = useState(false);
  const page = pages.find((p) => p.id === pageId);
  const len = length ?? (page ? (page.kind === 'table' ? turnFor(page, party) : lengthOf(page)) : 30);
  const areaPick = area === 'any' ? undefined : area;
  // A chosen person narrows the page to them; "any" keeps the round robin.
  const effective = page && who !== 'any' && page.kind !== 'table' ? { ...page, hosts: [who], hostMode: 'one' as const } : page;
  const strip = Array.from({ length: 14 }, (_, n) => dayFrom(now, n));
  const day = strip.find((d) => isoDay(d) === dayId) ?? now;
  const times = useMemo(() => (effective ? openTimes(effective, state, day, now, len, party, areaPick) : []), [effective, state, day, len, party, areaPick]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = page && page.kind !== 'table' ? page.hosts : [];
  const steps = page?.kind === 'table' ? [waitMode ? 'Waitlist' : 'Table', 'Details'] : people.length > 1 ? ['Service', 'Professional', 'Time', 'Confirm'] : ['Service', 'Time', 'Confirm'];
  const timeStep = page?.kind === 'table' ? 0 : people.length > 1 ? 2 : 1;
  const start = (p: BookingPage) => {
    if (!b) { onOpenPage(p); return; }
    setPageId(p.id); setWho('any'); setLength(undefined); setTime(undefined); setDone(false);
    setStep(1);
  };
  const confirmStep = steps.length - 1;
  const isTable = page?.kind === 'table';
  // A restaurant needs a phone to reach the party; email is how the confirmation and the change link arrive.
  // A salon texts reminders too, so it asks for a mobile as well.
  const detailsOk = name.trim() !== '' && phone.replace(/\D/g, '').length >= 8 && (isTable ? waitMode || email.includes('@') : email.includes('@'));
  const book = () => {
    if (!effective || !detailsOk) return;
    if (waitMode) { onWaitlist?.({ name: name.trim(), phone: phone.trim(), party, day: isoDay(day), wanted: time }); setDone(true); return; }
    if (time === undefined) return;
    const ok = onBooked(effective, { name: name.trim(), email: email.trim(), notes, date: new CalendarDate(day.getFullYear(), day.getMonth() + 1, day.getDate()), minutes: time, timeZone: 'Asia/Kolkata', length: len, place: placeOf(effective), party: isTable ? party : undefined,
      phone: phone.trim() || undefined, occasion: occasion || undefined, area: areaPick });
    if (ok === false) { setTaken(true); setTime(undefined); if (!isTable) setStep(people.length > 1 ? 2 : 1); return; }
    setTaken(false);
    setDone(true);
  };
  const addToCalendar = async () => {
    if (time === undefined || !page) return;
    const outcome = await saveFile(`${(state.workspace || 'booking').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`, icsFor(isTable ? `${state.workspace}, table for ${party}` : `${page.name} at ${venue.name}`, venue.address, at(day, time), len));
    if (outcome === 'saved') toast({ message: 'Calendar file saved', tone: 'success' });
    else if (outcome === 'failed') toast({ message: 'Couldn’t save the file. Try again.' });
  };
  const foot = <div className="tf-bkf__powered-row"><BrandCard className="tf-booking__brand--solo" /></div>;

  // The page itself.
  if (!page) {
    const items = pages.filter((p) => p.kind !== 'table').map((p) => ({ id: p.id, name: p.name, meta: p.kind === 'service' ? lengthsText(p) : `${lengthsText(p)} · ${PLACES[placeOf(p)].label}`, price: p.kind === 'service' ? priceText(p) : undefined, description: p.description || undefined, categoryId: p.categoryId }));
    const team = b?.kind === 'salon' ? [...new Set(pages.flatMap((p) => p.hosts))].map((n) => ({ id: n, name: n, title: b.titles?.[n] ?? 'Stylist' })) : [];
    const tableAside = table && (
      <TableCard state={state} table={table} now={now} party={party} dayId={dayId} area={area}
        onParty={(n) => { setParty(n); setTime(undefined); }} onDay={(d) => { setDayId(d); setTime(undefined); }} onArea={(x) => { setArea(x); setTime(undefined); }}
        onTime={(m) => { setPageId(table.id); setTime(m); setWaitMode(false); setStep(1); }}
        onWaitlist={onWaitlist ? () => { setPageId(table.id); setTime(undefined); setWaitMode(true); setStep(1); } : undefined} />
    );
    return (
      <VenuePage venue={venue} items={items} menu={venueMenu(state) ?? b?.menu} onFullMenu={venueMenu(state) ? onOpenMenu : undefined} categories={state.categories} itemsTitle={b ? (b.kind === 'restaurant' ? 'Menu highlights' : 'Services') : 'Meetings'} team={team}
        onBook={(id) => { const p = pages.find((x) => x.id === id); if (p) start(p); }}
        aside={tableAside ?? undefined} bookLabel={b ? 'Book now' : 'Book a meeting'} onBookNow={tableAside ? undefined : () => { const p = pages.find((x) => x.kind !== 'table'); if (p) start(p); }} foot={foot} />
    );
  }

  const summary = (
    <>
      <div className="tf-bkf-venue-sum__head">
        {venue.photos[0] ? <img src={venue.photos[0]} alt="" className="tf-bkf-venue-sum__img" /> : <Avatar name={venue.name} size={44} shape="square" />}
        <span className="tf-bkf-venue-sum__text"><strong>{venue.name}</strong>{venue.rating !== undefined && <span className="tf-bkf__muted tf-num" role="img" aria-label={`Rated ${venue.rating.toFixed(1)} out of 5${venue.reviews !== undefined ? ` from ${venue.reviews.toLocaleString('en-IN')} reviews` : ''}`}>{venue.rating.toFixed(1)} ★{venue.reviews !== undefined ? ` (${venue.reviews.toLocaleString('en-IN')})` : ''}</span>}<span className="tf-bkf__muted">{venue.area ?? venue.address}</span></span>
      </div>
      <div className="tf-bkf-venue-sum__lines">
        <span className="tf-bkf-venue-sum__line"><span>{page.kind === 'table' ? `${waitMode ? 'Waitlist, t' : 'T'}able for ${party}` : page.name}<span className="tf-bkf__muted tf-num">{page.kind === 'table' ? (time !== undefined ? ` · ${formatLongDay(day)}, ${formatClock(time)}` : ` · ${formatLongDay(day)}`) + (areaPick ? ` · ${areaPick}` : '') + (occasion ? ` · ${occasion}` : '') : ` · ${len} min${who !== 'any' ? ` with ${first(who)}` : ''}`}</span></span><span className="tf-num">{page.kind === 'service' ? priceText(page) : ''}</span></span>
        {page.kind !== 'table' && (time !== undefined ? <span className="tf-bkf-venue-sum__when tf-num">{formatLongDay(day)}, {formatClockRange(time, time + len)}</span> : step >= timeStep && <span className="tf-bkf__muted">Pick a day and time</span>)}
      </div>
      {page.kind === 'service' && <span className="tf-bkf-venue-sum__total"><span>Total</span><strong className="tf-num">{priceText(page, len)}</strong></span>}
      {!done && (step < confirmStep
        ? <Button variant="primary" size="lg" isDisabled={step === timeStep && time === undefined} onPress={() => setStep(step + 1)}>Continue</Button>
        : <Button variant="primary" size="lg" isDisabled={(!waitMode && time === undefined) || !detailsOk} onPress={book}>{waitMode ? 'Join the waitlist' : page.confirmFirst ? 'Send request' : isTable ? 'Book table' : 'Book'}</Button>)}
    </>
  );

  if (done) {
    const back = () => { setPageId(undefined); setDone(false); setWaitMode(false); };
    const cut = page.cancelCutoff ?? 0;
    return (
      <VenueCheckout steps={steps} step={steps.length - 1} title={waitMode ? 'You’re on the waitlist' : page.confirmFirst ? 'Request sent' : 'You’re booked'} onBack={back} summary={summary}>
        <div className="tf-bkf-venue-done">
          <span className="tf-booking__celebrate"><span className="tf-booking__check"><SuccessCheck size={28} /></span></span>
          <p>{waitMode ? `We’ll text ${phone} if a table for ${party} opens up on ${formatLongDay(day)}.`
            : page.confirmFirst ? `${venue.name} confirms soon. You’ll get an email.`
              : isTable ? `See you ${isoDay(day) === isoDay(now) ? 'tonight' : formatLongDay(day)} at ${time !== undefined ? formatClock(time) : ''}. A confirmation is on its way to ${email}.` : `A confirmation is on its way to ${email}.`}</p>
          {isTable && !waitMode && <p className="tf-bkf__muted">Plans changed? Use the link in your email to change or cancel{cut > 0 ? ` up to ${plural(cut, 'hour')} before` : ''}, or call {b?.phone}.</p>}
          <span className="tf-bkf__row">
            {!waitMode && <Button variant="secondary" onPress={() => { void addToCalendar(); }}>Add to calendar</Button>}
            <Button variant="ghost" onPress={back}>Back to {venue.name}</Button>
          </span>
        </div>
      </VenueCheckout>
    );
  }

  const title = step === 0 ? 'Select service' : page.kind === 'table' ? 'Your details' : steps[step] === 'Professional' ? 'Select professional' : steps[step] === 'Time' ? 'Select time' : 'Confirm';
  return (
    <VenueCheckout steps={steps} step={page.kind === 'table' ? 1 : step} title={waitMode ? 'Join the waitlist' : title} onBack={() => (step <= 1 ? setPageId(undefined) : setStep(step - 1))} summary={summary}>
      {taken && <p className="tf-bkf__error" role="alert">Sorry, that time was just taken. Pick another.</p>}
      {steps[step] === 'Professional' && (
        <div className="tf-bkf-venue-tiles">
          <PersonTile any name="Any professional" title="For the most times" isSelected={who === 'any'} onPress={() => { setWho('any'); setTime(undefined); }} />
          {people.map((n) => {
            // Their first open time in the next two weeks, so a guest can choose by when, not just by who.
            const theirs = page ? { ...page, hosts: [n], hostMode: 'one' as const } : undefined;
            const d = theirs ? strip.find((x) => openTimes(theirs, state, x, now, len).length > 0) : undefined;
            const first0 = d && theirs ? openTimes(theirs, state, d, now, len)[0] : undefined;
            const when = d && first0 !== undefined ? `Next free ${isoDay(d) === isoDay(now) ? 'today' : isoDay(d) === isoDay(dayFrom(now, 1)) ? 'tomorrow' : formatDay(d)}, ${formatClock(first0)}` : 'No times in the next two weeks';
            return <PersonTile key={n} name={n} title={[b?.titles?.[n], when].filter(Boolean).join(' · ')} isSelected={who === n} onPress={() => { setWho(n); setTime(undefined); }} />;
          })}
        </div>
      )}
      {steps[step] === 'Time' && (() => {
        // The same List view a meeting page has: a week strip, the day with 12h / 24h, the times as pills; Next sits on the chosen one.
        const week = strip.slice(weekAt * 7, weekAt * 7 + 7);
        const lastWeek = Math.ceil(strip.length / 7) - 1;
        const goWeek = (w: number) => { setWeekAt(w); const d = strip[w * 7]; if (d) { setDayId(isoDay(d)); setTime(undefined); } };
        const next = times.length === 0 ? strip.find((d) => d > day && effective && openTimes(effective, state, d, now, len).length > 0) : undefined;
        return (
          <>
            {page.durations.length > 1 && (
              <SegmentedControl aria-label="How long" size="sm" selectedKey={String(len)} onSelectionChange={(k) => { setLength(Number(k)); setTime(undefined); }}
                items={page.durations.map((d) => ({ id: String(d), label: `${d} min` }))} />
            )}
            <DayTimes days={week.map((d) => ({ id: isoDay(d), weekday: formatDay(d).split(' ')[0] ?? '', date: d.getDate(), label: formatLongDay(d), count: effective ? openTimes(effective, state, d, now, len).length : 0, isToday: isoDay(d) === isoDay(now) }))}
              dayId={dayId} onDay={(v) => { setDayId(v); setTime(undefined); }} onPrevious={weekAt > 0 ? () => goWeek(weekAt - 1) : undefined} onNext={weekAt < lastWeek ? () => goWeek(weekAt + 1) : undefined}
              dayTitle={<>{formatDay(day).split(' ')[0]} <span className="tf-bkf__muted tf-num">{day.getDate()}</span></>}
              times={times} value={time} onTime={setTime} onNextStep={() => setStep(step + 1)}
              empty={<span className="tf-bkf-venue-next"><span>Nothing free on {formatLongDay(day)}{who !== 'any' ? ` with ${first(who)}` : ''}.</span>
                {next && <Button size="sm" variant="secondary" onPress={() => { setDayId(isoDay(next)); setWeekAt(Math.floor(strip.indexOf(next) / 7)); setTime(undefined); }}>Next free: {formatLongDay(next)}</Button>}</span>} />
          </>
        );
      })()}
      {(steps[step] === 'Confirm' || steps[step] === 'Details') && (isTable ? (
        <div className="tf-bkf__stack">
          <div className="tf-bkf__pair">
            <TextField label="Name" size="lg" value={name} onChange={setName} isRequired autoComplete="name" />
            <TextField label="Mobile" size="lg" type="tel" value={phone} onChange={setPhone} isRequired autoComplete="tel" description={waitMode ? 'We text you when a table frees up.' : 'In case we need to reach you.'} />
            {waitMode && <Select label="Hoping for" value={time === undefined ? 'any' : String(time)} onChange={(v) => setTime(!v || v === 'any' ? undefined : Number(v))}
              items={[{ id: 'any', label: 'Any time that day' }, ...(venueDay(state, day)?.ranges ?? []).flatMap((r) => Array.from({ length: Math.max(0, Math.floor((r.end - r.start) / 30)) }, (_, n) => r.start + n * 30)).map((m) => ({ id: String(m), label: `Around ${formatClock(m)}` }))]} />}
          </div>
          {!waitMode && <TextField label="Email" size="lg" type="email" value={email} onChange={setEmail} isRequired autoComplete="email" description="Your confirmation, and the link to change or cancel." />}
          {!waitMode && <Select label="Occasion" value={occasion || 'none'} onChange={(v) => setOccasion(v && v !== 'none' ? v : '')} items={[{ id: 'none', label: 'No occasion' }, ...OCCASIONS.map((o) => ({ id: o, label: o }))]} />}
          <TextArea label="Allergies or requests" aside="Optional" rows={2} size="lg" value={notes} onChange={setNotes} placeholder="A high chair, a quiet table, a nut allergy" />
          {!waitMode && <p className="tf-bkf__muted">Your table is held for {page.holdLate ?? 15} minutes after your time. {(page.cancelCutoff ?? 0) > 0 ? `Free to cancel up to ${plural(page.cancelCutoff ?? 0, 'hour')} before.` : 'Free to cancel any time.'}</p>}
        </div>
      ) : (
        <div className="tf-bkf__stack">
          <TextField label="Name" size="lg" value={name} onChange={setName} isRequired autoComplete="name" />
          <div className="tf-bkf__pair">
            <TextField label="Email" size="lg" type="email" value={email} onChange={setEmail} isRequired autoComplete="email" />
            <TextField label="Mobile" size="lg" type="tel" value={phone} onChange={setPhone} isRequired autoComplete="tel" description="For a reminder text the day before." />
          </div>
          <TextArea label="Notes for your visit" aside="Optional" rows={3} size="lg" value={notes} onChange={setNotes} />
          {page && <p className="tf-bkf__muted">{(page.cancelCutoff ?? 0) > 0 || (page.moveCutoff ?? 0) > 0 ? `Free to change or cancel up to ${plural(Math.max(page.cancelCutoff ?? 0, page.moveCutoff ?? 0), 'hour')} before, from the link in your email.` : 'Free to change or cancel any time, from the link in your email.'}</p>}
        </div>
      ))}
    </VenueCheckout>
  );
}

/** The table booking card: guests, date, area and the open times by service. The venue page's side card, and the editor's preview. */
export function TableCard({ state, table, now, party, dayId, area, onParty, onDay, onArea, onTime, onWaitlist }: {
  readonly state: BookingsState; readonly table: BookingPage; readonly now: Date; readonly party: number; readonly dayId: string; readonly area: string;
  readonly onParty: (n: number) => void; readonly onDay: (id: string) => void; readonly onArea: (a: string) => void; readonly onTime: (m: number) => void; readonly onWaitlist?: () => void;
}) {
  const b = state.business;
  const strip = Array.from({ length: 14 }, (_, n) => dayFrom(now, n));
  const day = strip.find((d) => isoDay(d) === dayId) ?? now;
  const areaPick = area === 'any' ? undefined : area;
  const max = table.party?.max ?? 8;
  const min = table.party?.min ?? 1;
  const big = party > max;
  const areas = table.pickArea ? [...new Set((state.tables ?? []).filter((t) => t.online).map((t) => t.area))] : [];
  const turn = turnFor(table, party);
  const t = big ? [] : openTimes(table, state, day, now, turn, party, areaPick);
  // Nothing that day: the next day that has a table is one tap away, or ask to be told if one frees up.
  const nextDay = !big && t.length === 0 ? strip.find((d) => d > day && openTimes(table, state, d, now, turnFor(table, party), party, areaPick).length > 0) : undefined;
  return (
    <div className="tf-bkf-venue-table">
      <div className="tf-bkf__pair">
        <Select label="Guests" value={big ? 'more' : String(party)} onChange={(v) => { if (v) onParty(v === 'more' ? max + 1 : Number(v)); }}
          items={[...Array.from({ length: max - min + 1 }, (_, n) => min + n).map((n) => ({ id: String(n), label: n === 1 ? '1 guest' : `${n} guests` })), { id: 'more', label: `${max + 1}+ guests` }]} />
        <Select label="Date" value={dayId} onChange={(v) => { if (v) onDay(v); }}
          items={strip.map((d, n) => ({ id: isoDay(d), label: n === 0 ? `Today, ${formatDay(d)}` : n === 1 ? `Tomorrow, ${formatDay(d)}` : formatLongDay(d) }))} />
      </div>
      {areas.length > 1 && !big && <Select label="Seating" value={area} onChange={(v) => { if (v) onArea(v); }} items={[{ id: 'any', label: 'Any area' }, ...areas.map((x) => ({ id: x, label: x }))]} />}
      {big ? (
        <div className="tf-bkf-venue-next">
          <span>Booking for {max + 1} or more? Call us and we’ll set it up, including a set menu if you’d like one.</span>
          <span className="tf-bkf-venue-phone tf-num">{b?.phone}</span>
        </div>
      ) : t.length === 0 ? (
        <div className="tf-bkf-venue-next">
          {/* A closed day says so and offers the next open day; the waitlist is only for a full day the place is open. */}
          <span className="tf-bkf__muted">{!venueDay(state, day)?.on ? `Closed on ${formatLongDay(day)}` : isoDay(day) === isoDay(now) ? `No more tables today for ${party}${areaPick ? ` on the ${areaPick}` : ''}` : `No tables on ${formatLongDay(day)} for ${party}${areaPick ? ` on the ${areaPick}` : ''}`}.</span>
          <span className="tf-bkf__row">
            {nextDay && <Button variant="secondary" onPress={() => onDay(isoDay(nextDay))}>See {formatLongDay(nextDay)}</Button>}
            {onWaitlist && venueDay(state, day)?.on && <Button variant="ghost" onPress={onWaitlist}>Join the waitlist</Button>}
          </span>
        </div>
      ) : byService(t).map((g) => (
        <ChoiceChips key={g.name} label={g.name} selectionMode="single" size="sm" selectedKeys={[]} onSelectionChange={(k) => { const v = [...k][0]; if (v) onTime(Number(v)); }}
          items={g.times.map((m) => ({ id: String(m), label: formatClock(m) }))} />
      ))}
      {!big && <p className="tf-bkf__muted">The table is yours for {turn < 120 ? `${turn} minutes` : `${turn / 60} hours`}{table.holdLate ? `, and kept ${table.holdLate} minutes if you’re running late` : ''}.</p>}
    </div>
  );
}

/** The table card on its own, for the editor's preview: it keeps its own picks and books nothing. */
export function TablePreview({ state, table }: { readonly state: BookingsState; readonly table: BookingPage }) {
  const now = new Date();
  const [party, setParty] = useState(2);
  const [dayId, setDayId] = useState(isoDay(now));
  const [area, setArea] = useState('any');
  return (
    <div className="tf-bkf-venue-preview">
      <strong className="tf-bkf-venue-preview__name">{state.workspace}</strong>
      <span className="tf-bkf__muted">{state.business?.kindLabel} · {state.business?.area}</span>
      <TableCard state={state} table={table} now={now} party={party} dayId={dayId} area={area} onParty={setParty} onDay={setDayId} onArea={setArea} onTime={() => undefined} />
    </div>
  );
}

/** The page's Menu section: the popular dishes on the live menus (five at most), else the first ones. */
function venueMenu(state: BookingsState): ReadonlyArray<{ readonly name: string; readonly description?: string; readonly price: string; readonly tag?: string }> | undefined {
  const live = state.menuLive;
  if (!live) return undefined;
  const ids = [...new Set(live.menus.filter((m) => m.isLive).flatMap((m) => m.sections.flatMap((s) => s.dishIds)))];
  const dishes = ids.map((id) => live.dishes.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => d !== undefined && !d.soldOut);
  const pick = [...dishes.filter((d) => d.popular), ...dishes.filter((d) => !d.popular)].slice(0, 5);
  return pick.length ? pick.map((d) => ({ name: d.name, description: d.description, price: dishPrice(d), tag: d.diet.includes('vegan') ? 'Vegan' : d.diet.includes('vegetarian') ? 'Vegetarian' : undefined })) : undefined;
}
