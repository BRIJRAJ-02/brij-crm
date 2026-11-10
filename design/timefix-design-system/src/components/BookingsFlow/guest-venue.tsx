// The workspace's own link (timefix.com/<handle>) as guests see it: the venue page, then Fresha's steps. One page for every kind:
// a salon books a service with a person, a restaurant a table for a party, a team a meeting.
import { useMemo, useState } from 'react';
import { CalendarDate } from '@internationalized/date';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { DayStrip } from '../DayStrip/DayStrip.tsx';
import { Select } from '../Select/Select.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import { VenuePage, VenueCheckout, PersonTile, type Venue } from '../VenuePage/VenuePage.tsx';
import { HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { formatClock, formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { BrandCard } from '../BookingFlow/BookingFlow.tsx';
import { HOST, PLACES, dayFrom, first, isoDay, lengthOf, lengthsText, openTimes, placeOf, priceText, type BookingPage, type BookingsState, type PlaceKind } from './state.ts';

type OnBooked = (page: BookingPage, r: { readonly name: string; readonly email: string; readonly notes: string; readonly date: CalendarDate; readonly minutes: number; readonly timeZone: string; readonly length: number; readonly place: PlaceKind; readonly party?: number }) => void;

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** The venue as the page shows it: open now, today's hours first, the week below. */
function venueOf(state: BookingsState, now: Date): Venue {
  const b = state.business;
  const week = state.savedHours.find((h) => h.id === state.defaultHoursId)?.hours ?? state.savedHours[0]?.hours;
  const todayKey = HOURS_DAYS[(now.getDay() + 6) % 7] ?? 'mon';
  const today = week?.[todayKey];
  const m = minutesOf(now);
  const openRange = today?.on ? today.ranges.find((r) => r.start <= m && m < r.end) : undefined;
  const next = today?.on ? today.ranges.find((r) => r.start > m) : undefined;
  const status = !b ? (openRange || next ? 'Taking bookings today' : 'Next times from tomorrow') : openRange ? `Open now · closes at ${formatClock(openRange.end)}` : next ? `Closed · opens at ${formatClock(next.start)}` : 'Closed today';
  return {
    name: b ? state.workspace : HOST, kind: b?.kindLabel ?? 'Meetings', rating: b?.rating, reviews: b?.reviews, address: b?.address ?? 'Online, by video call', area: b?.area,
    phone: b?.phone, status, isOpen: b ? Boolean(openRange) : Boolean(openRange || next), isOnline: !b,
    about: b?.about ?? 'Pick a meeting to see open times. You get a calendar invite with the video link.', photos: b?.photos ?? [], amenities: b?.amenities,
    hours: week ? HOURS_DAYS.map((d, i) => ({ day: DAY_NAMES[i] ?? d, text: week[d].on ? week[d].ranges.map((r) => formatClockRange(r.start, r.end)).join(', ') : 'Closed', isToday: d === todayKey, isOpen: week[d].on })) : undefined,
  };
}

/** The guest's view of the workspace link. */
export function VenueGuest({ state, onBooked, onOpenPage }: { readonly state: BookingsState; readonly onBooked: OnBooked; readonly onOpenPage: (p: BookingPage) => void }) {
  const now = new Date();
  const venue = venueOf(state, now);
  const b = state.business;
  const pages = state.pages.filter((p) => p.isOn && p.visibility !== 'link' && p.whoCanBook === 'anyone' && p.hostMode !== 'collective');
  const table = pages.find((p) => p.kind === 'table');
  const [pageId, setPageId] = useState<string>();
  const [step, setStep] = useState(0);
  const [who, setWho] = useState('any');
  const [length, setLength] = useState<number>();
  const [party, setParty] = useState(2);
  const [dayId, setDayId] = useState(isoDay(now));
  const [time, setTime] = useState<number>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);
  const page = pages.find((p) => p.id === pageId);
  const len = length ?? (page ? lengthOf(page) : 30);
  // A chosen person narrows the page to them; "any" keeps the round robin.
  const effective = page && who !== 'any' && page.kind !== 'table' ? { ...page, hosts: [who], hostMode: 'one' as const } : page;
  const strip = Array.from({ length: 14 }, (_, n) => dayFrom(now, n));
  const day = strip.find((d) => isoDay(d) === dayId) ?? now;
  const times = useMemo(() => (effective ? openTimes(effective, state, day, now, len, party) : []), [effective, state, day, len, party]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = page && page.kind !== 'table' ? page.hosts : [];
  const steps = page?.kind === 'table' ? ['Table', 'Details'] : people.length > 1 ? ['Service', 'Professional', 'Time', 'Confirm'] : ['Service', 'Time', 'Confirm'];
  const timeStep = page?.kind === 'table' ? 0 : people.length > 1 ? 2 : 1;
  const start = (p: BookingPage) => {
    if (!b) { onOpenPage(p); return; }
    setPageId(p.id); setWho('any'); setLength(undefined); setTime(undefined); setDone(false);
    setStep(1);
  };
  const confirmStep = steps.length - 1;
  const book = () => {
    if (!effective || time === undefined || !name.trim() || !email.includes('@')) return;
    onBooked(effective, { name: name.trim(), email: email.trim(), notes, date: new CalendarDate(day.getFullYear(), day.getMonth() + 1, day.getDate()), minutes: time, timeZone: 'Asia/Kolkata', length: len, place: placeOf(effective), party: page?.kind === 'table' ? party : undefined });
    setDone(true);
  };
  const foot = <div className="tf-bkf__powered-row"><BrandCard className="tf-booking__brand--solo" /></div>;

  // The page itself.
  if (!page) {
    const items = pages.filter((p) => p.kind !== 'table').map((p) => ({ id: p.id, name: p.name, meta: p.kind === 'service' ? lengthsText(p) : `${lengthsText(p)} · ${PLACES[placeOf(p)].label}`, price: p.kind === 'service' ? priceText(p) : undefined, description: p.description || undefined, categoryId: p.categoryId }));
    const team = b?.kind === 'salon' ? [...new Set(pages.flatMap((p) => p.hosts))].map((n) => ({ id: n, name: n, title: b.titles?.[n] ?? 'Stylist' })) : [];
    const tableAside = table && (
      <div className="tf-bkf-venue-table">
        <Select label="Guests" value={String(party)} onChange={(v) => { if (v) { setParty(Number(v)); setTime(undefined); } }}
          items={Array.from({ length: (table.party?.max ?? 8) - (table.party?.min ?? 1) + 1 }, (_, n) => (table.party?.min ?? 1) + n).map((n) => ({ id: String(n), label: n === 1 ? '1 guest' : `${n} guests` }))} />
        <Select label="Date" value={dayId} onChange={(v) => { if (v) { setDayId(v); setTime(undefined); } }}
          items={strip.map((d, n) => ({ id: isoDay(d), label: n === 0 ? `Today, ${formatDay(d)}` : n === 1 ? `Tomorrow, ${formatDay(d)}` : formatLongDay(d) }))} />
        {(() => {
          const t = openTimes(table, state, day, now, lengthOf(table), party);
          return t.length === 0 ? <p className="tf-bkf__muted">No tables for {party} that day. Try another date, or call {b?.phone}.</p> : (
            <ChoiceChips label="Time" selectionMode="single" size="sm" selectedKeys={[]} onSelectionChange={(k) => { const v = [...k][0]; if (v) { setPageId(table.id); setTime(Number(v)); setStep(1); } }}
              items={t.slice(0, 12).map((m) => ({ id: String(m), label: formatClock(m) }))} />
          );
        })()}
      </div>
    );
    return (
      <VenuePage venue={venue} items={items} categories={state.categories} itemsTitle={b ? (b.kind === 'restaurant' ? 'Menu highlights' : 'Services') : 'Meetings'} team={team}
        onBook={(id) => { const p = pages.find((x) => x.id === id); if (p) start(p); }}
        aside={tableAside ?? undefined} bookLabel={b ? 'Book now' : 'Book a meeting'} onBookNow={tableAside ? undefined : () => { const p = pages.find((x) => x.kind !== 'table'); if (p) start(p); }} foot={foot} />
    );
  }

  const summary = (
    <>
      <div className="tf-bkf-venue-sum__head">
        {venue.photos[0] ? <img src={venue.photos[0]} alt="" className="tf-bkf-venue-sum__img" /> : <Avatar name={venue.name} size={44} shape="square" />}
        <span className="tf-bkf-venue-sum__text"><strong>{venue.name}</strong>{venue.rating !== undefined && <span className="tf-bkf__muted tf-num">{venue.rating.toFixed(1)} ★ ({venue.reviews?.toLocaleString('en-IN')})</span>}<span className="tf-bkf__muted">{venue.area ?? venue.address}</span></span>
      </div>
      <div className="tf-bkf-venue-sum__lines">
        <span className="tf-bkf-venue-sum__line"><span>{page.kind === 'table' ? `Table for ${party}` : page.name}<span className="tf-bkf__muted tf-num">{page.kind === 'table' ? (time !== undefined ? ` · ${formatLongDay(day)}, ${formatClock(time)}` : '') : ` · ${len} min${who !== 'any' ? ` with ${first(who)}` : ''}`}</span></span><span className="tf-num">{page.kind === 'service' ? priceText(page) : ''}</span></span>
        {page.kind !== 'table' && time !== undefined && <span className="tf-bkf__muted tf-num">{formatLongDay(day)}, {formatClockRange(time, time + len)}</span>}
      </div>
      {page.kind === 'service' && <span className="tf-bkf-venue-sum__total"><span>Total</span><strong className="tf-num">{priceText(page)}</strong></span>}
      {!done && (step < confirmStep
        ? <Button variant="primary" size="lg" isDisabled={step === timeStep && time === undefined} onPress={() => setStep(step + 1)}>Continue</Button>
        : <Button variant="primary" size="lg" isDisabled={time === undefined || !name.trim() || !email.includes('@')} onPress={book}>{page.confirmFirst ? 'Send request' : 'Book'}</Button>)}
    </>
  );

  if (done) {
    return (
      <VenueCheckout steps={steps} step={steps.length - 1} title={page.confirmFirst ? 'Request sent' : 'You’re booked'} onBack={() => { setPageId(undefined); setDone(false); }} summary={summary}>
        <div className="tf-bkf-venue-done">
          <span className="tf-booking__celebrate"><span className="tf-booking__check"><SuccessCheck size={28} /></span></span>
          <p>{page.confirmFirst ? `${venue.name} confirms soon. You’ll get an email.` : `A confirmation is on its way to ${email}.`}</p>
          <Button variant="secondary" onPress={() => { setPageId(undefined); setDone(false); }}>Back to {venue.name}</Button>
        </div>
      </VenueCheckout>
    );
  }

  const title = step === 0 ? 'Select service' : page.kind === 'table' ? 'Your details' : steps[step] === 'Professional' ? 'Select professional' : steps[step] === 'Time' ? 'Select time' : 'Confirm';
  return (
    <VenueCheckout steps={steps} step={page.kind === 'table' ? 1 : step} title={title} onBack={() => (step <= 1 ? setPageId(undefined) : setStep(step - 1))} summary={summary}>
      {page.durations.length > 1 && steps[step] !== 'Confirm' && steps[step] !== 'Details' && (
        <ChoiceChips label="Length" selectionMode="single" size="sm" selectedKeys={[String(len)]} onSelectionChange={(k) => { const v = [...k][0]; if (v) { setLength(Number(v)); setTime(undefined); } }}
          items={page.durations.map((d) => ({ id: String(d), label: `${d} min` }))} />
      )}
      {steps[step] === 'Professional' && (
        <div className="tf-bkf-venue-tiles">
          <PersonTile any name="Any professional" title="For the most times" isSelected={who === 'any'} onPress={() => { setWho('any'); setTime(undefined); }} />
          {people.map((n) => <PersonTile key={n} name={n} title={b?.titles?.[n] ?? ''} isSelected={who === n} onPress={() => { setWho(n); setTime(undefined); }} />)}
        </div>
      )}
      {steps[step] === 'Time' && (
        <>
          <DayStrip label="Day" days={strip.map((d) => ({ id: isoDay(d), weekday: formatDay(d).split(' ')[0] ?? '', date: d.getDate(), label: formatLongDay(d), count: effective ? openTimes(effective, state, d, now, len).length : 0, isToday: isoDay(d) === isoDay(now) }))}
            value={dayId} onChange={(v) => { setDayId(v); setTime(undefined); }} unit={['time', 'times']} />
          {times.length === 0 ? <p className="tf-bkf__muted">Nothing free that day{who !== 'any' ? ` with ${first(who)}` : ''}. Pick another day{who !== 'any' ? ' or Any professional' : ''}.</p> : (
            <div className="tf-bkf-venue-times" role="radiogroup" aria-label="Time">
              {times.map((m) => <button key={m} type="button" role="radio" aria-checked={time === m} className="tf-bkf-venue-time tf-num" onClick={() => setTime(m)}>{formatClock(m)}</button>)}
            </div>
          )}
        </>
      )}
      {(steps[step] === 'Confirm' || steps[step] === 'Details') && (
        <div className="tf-bkf__stack">
          <div className="tf-bkf__pair">
            <TextField label="Name" size="lg" value={name} onChange={setName} isRequired autoComplete="name" />
            <TextField label="Email" size="lg" type="email" value={email} onChange={setEmail} isRequired autoComplete="email" />
          </div>
          <TextArea label={page.kind === 'table' ? 'Anything we should know?' : 'Notes for your visit'} aside="Optional" rows={3} size="lg" value={notes} onChange={setNotes} />
        </div>
      )}
    </VenueCheckout>
  );
}
