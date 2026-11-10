// A restaurant's home: the host stand. One day at a time, split by service (Lunch, Dinner) with covers, each table booking moving
// Booked → Seated → Left (or Late → No-show), plus Walk in, a waitlist and a floor view of every table. Same meetings underneath.
import { useEffect, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, LayoutGrid, LayoutList, MoreHorizontal, Pencil, Plus, Repeat, UserPlus, UserX, Users, X } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { ProgressBar } from '../Progress/Progress.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatClock, formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { TabToolbar, i14, i16 } from './parts.tsx';
import {
  HOST, PLACES, at, dayFrom, first, fitTables, heldTables, isoDay, nextId, plural, turnFor,
  type BookedMeeting, type BookingPage, type BookingsAction, type BookingsState, type Table, type WaitParty, venueDay } from './state.ts';

/** Where a table booking is tonight. */
type Stage = 'request' | 'booked' | 'late' | 'seated' | 'left' | 'no-show' | 'cancelled';
const stageOf = (m: BookedMeeting, now: Date, holdLate: number): Stage =>
  m.status === 'cancelled' ? 'cancelled' : m.status === 'no-show' ? 'no-show' : m.status === 'pending' ? 'request'
    : m.seating === 'left' || m.status === 'completed' ? 'left' : m.seating === 'seated' ? 'seated'
      : now.getTime() > m.start.getTime() + holdLate * 60_000 ? 'late' : 'booked';

const mins = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
const OCCASIONS = ['Birthday', 'Anniversary', 'Date night', 'Business', 'Celebration'];
const TAGS = ['VIP', 'Regular', 'Allergy', 'Wheelchair', 'High chair'];
const QUOTES = [10, 15, 20, 30, 45, 60];

/** Props for ReservationsTab. */
export interface ReservationsTabProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  readonly fresh: string | undefined;
  readonly onCancel: (m: BookedMeeting) => void;
  readonly onConfirm: (id: string) => void;
  readonly onDecline: (id: string) => void;
  /** A booking to open (from a toast or the inbox): the tab goes to its day and opens it. */
  readonly openId?: string;
  readonly onOpened?: () => void;
}

/** The Reservations tab. */
export function ReservationsTab({ state, dispatch, fresh, openId, onOpened, onCancel, onConfirm, onDecline }: ReservationsTabProps) {
  const { toast } = useToast();
  const now = new Date();
  const page = state.pages.find((p) => p.kind === 'table');
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'list' | 'floor'>('list');
  const [editing, setEditing] = useState<BookedMeeting | 'new'>();
  const [seating, setSeating] = useState<SeatAsk>();
  const [waiting, setWaiting] = useState(false);
  // A new booking or one opened from elsewhere: show its day, and open it when asked.
  const dayOf = (id: string | undefined) => { const m = id ? state.meetings.find((x) => x.id === id) : undefined; return m ? Math.round((dayFrom(m.start, 0).getTime() - dayFrom(now, 0).getTime()) / 86_400_000) : undefined; };
  useEffect(() => { const d = dayOf(fresh); if (d !== undefined) setOffset(d); }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = openId ? state.meetings.find((x) => x.id === openId) : undefined;
    if (!m) return;
    const d = dayOf(openId); if (d !== undefined) setOffset(d);
    setEditing(m); onOpened?.();
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!page) return null;
  const holdLate = page.holdLate ?? 15;
  const day = dayFrom(now, offset);
  const isToday = offset === 0;
  const todays = state.meetings.filter((m) => m.pageId === page.id && m.start.toDateString() === day.toDateString());
  const live = todays.filter((m) => m.status !== 'cancelled');
  const covers = live.filter((m) => m.status !== 'no-show').reduce((n, m) => n + (m.party ?? 0), 0);
  const seatedNow = live.filter((m) => stageOf(m, now, holdLate) === 'seated');
  const wait = (state.waitlist ?? []).filter((w) => w.day === isoDay(day));
  const services = servicesOn(state, day);
  const tableName = (ids: ReadonlyArray<string> | undefined) => (ids ?? []).map((id) => state.tables?.find((t) => t.id === id)?.name ?? '').filter(Boolean).join(' + ') || 'No table';

  const update = (m: BookedMeeting, text: string) => dispatch({ type: 'meeting/update', meeting: { ...m, activity: [...m.activity, { id: nextId('a'), text, at: new Date() }] } });
  const withUndo = (before: BookedMeeting, after: BookedMeeting, text: string, message: string) => {
    update(after, text);
    toast({ message, action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/update', meeting: before }) } });
  };
  const seat = (m: BookedMeeting) => {
    // A table still taken by a party that's run over: pick another one rather than double-seat it.
    const clash = state.meetings.some((x) => x.id !== m.id && x.seating === 'seated' && x.status !== 'cancelled' && x.start.toDateString() === now.toDateString() && (x.tables ?? []).some((t) => (m.tables ?? []).includes(t)));
    if (clash) { toast({ message: `${tableName(m.tables)} is still taken. Pick another table.` }); setSeating({ kind: 'move', meeting: m }); return; }
    withUndo(m, { ...m, seating: 'seated', seatedAt: new Date() }, `Seated at ${tableName(m.tables)}`, `${first(m.invitee.name)}'s party seated at ${tableName(m.tables)}`);
  };
  const finish = (m: BookedMeeting) => withUndo(m, { ...m, seating: 'left', status: 'completed', end: now > m.start ? new Date() : m.end }, 'Left', `${tableName(m.tables)} is free`);
  const noShow = (m: BookedMeeting) => withUndo(m, { ...m, status: 'no-show' }, 'Marked as no-show', `${first(m.invitee.name)} marked as no-show. ${tableName(m.tables)} is free.`);

  const rowActions = (m: BookedMeeting, stage: Stage): ReactNode => {
    if (stage === 'request') return (
      <span className="tf-bkf-res__decide">
        <Button size="sm" variant="ghost" onPress={() => onDecline(m.id)}>Decline</Button>
        <Button size="sm" variant="secondary" onPress={() => onConfirm(m.id)}>Confirm</Button>
      </span>
    );
    const main = stage === 'booked' || stage === 'late' ? <Button size="sm" variant="secondary" onPress={() => seat(m)}>Seat</Button>
      : stage === 'seated' ? <Button size="sm" variant="secondary" onPress={() => finish(m)}>Finish</Button> : undefined;
    return (
      <span className="tf-bkf-res__acts">
        {isToday && main}
        <MenuTrigger>
          <IconButton label={`More for ${m.invitee.name}`} size="sm"><MoreHorizontal {...i14} /></IconButton>
          <Menu aria-label={`Actions for ${m.invitee.name}`} placement="bottom end" onAction={(k) => {
            if (k === 'edit') setEditing(m);
            else if (k === 'move') setSeating({ kind: 'move', meeting: m });
            else if (k === 'noshow') noShow(m);
            else if (k === 'unseat') withUndo(m, { ...m, seating: undefined, seatedAt: undefined }, 'Back to booked', `${first(m.invitee.name)} isn't seated`);
            else if (k === 'reseat') withUndo(m, { ...m, seating: 'seated', status: 'confirmed', seatedAt: m.seatedAt ?? new Date() }, 'Back to seated', `${first(m.invitee.name)} is seated again`);
            else if (k === 'cancel') onCancel(m);
          }}>
            <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit reservation</MenuItem>
            {(stage === 'booked' || stage === 'late' || stage === 'seated') && <MenuItem id="move" icon={<Repeat {...i16} />}>Change table</MenuItem>}
            {stage === 'seated' && <MenuItem id="unseat" icon={<Clock {...i16} />}>Not seated yet</MenuItem>}
            {(stage === 'left' || stage === 'no-show') && isToday && <MenuItem id="reseat" icon={<Users {...i16} />}>{stage === 'left' ? 'Still at the table' : 'They came: seat them'}</MenuItem>}
            {(stage === 'late' || (stage === 'booked' && m.start <= now)) && <MenuItem id="noshow" icon={<UserX {...i16} />}>Mark as no-show</MenuItem>}
            {(stage === 'booked' || stage === 'late') && <MenuSeparator />}
            {(stage === 'booked' || stage === 'late') && <MenuItem id="cancel" icon={<X {...i16} />} isDanger>Cancel reservation</MenuItem>}
          </Menu>
        </MenuTrigger>
      </span>
    );
  };

  const row = (m: BookedMeeting) => {
    const stage = stageOf(m, now, holdLate);
    return (
      <li key={m.id} className={cx('tf-bkf-res', m.id === fresh && 'is-new', (stage === 'left' || stage === 'no-show') && 'is-done')} data-stage={stage}>
        <span className="tf-bkf-res__time tf-num">{formatClock(minutesOf(m.start))}</span>
        <button type="button" className="tf-bkf-res__who" onClick={() => setEditing(m)} aria-label={`Open ${m.invitee.name}, ${plural(m.party ?? 2, 'guest')}`}>
          <span className="tf-bkf-res__name">{m.invitee.name}{m.walkIn && <span className="tf-bkf__muted"> · walk-in</span>}</span>
          <span className="tf-bkf-res__meta">
            {(m.tags ?? []).map((t) => <Tag key={t} size="sm" hue={t === 'VIP' ? 'purple' : t === 'Allergy' ? 'red' : 'gray'}>{t}</Tag>)}
            {m.occasion && <Tag size="sm" hue="yellow">{m.occasion}</Tag>}
            {m.area && <span className="tf-bkf__muted">Asked for {m.area}</span>}
            {m.notes && <span className="tf-bkf-res__note">{m.notes}</span>}
          </span>
        </button>
        <span className="tf-bkf-res__party tf-num" aria-label={plural(m.party ?? 2, 'guest')}><Users {...i14} aria-hidden />{m.party ?? 2}</span>
        <span className="tf-bkf-res__table tf-num">{tableName(m.tables)}</span>
        <span className="tf-bkf-res__stage">{stageTag(m, stage, now, holdLate)}</span>
        {rowActions(m, stage)}
      </li>
    );
  };

  const requests = live.filter((m) => m.status === 'pending');
  const listView = (
    <div className="tf-bkf-res-list">
      {requests.length > 0 && (
        <section className="tf-bkf-res-group" aria-label="Requests">
          <h3 className="tf-bkf-res-group__h"><span>Requests</span><span className="tf-bkf__muted tf-num">{`${requests.length} to answer`}</span></h3>
          <ul className="tf-bkf-res-rows">{requests.map(row)}</ul>
        </section>
      )}
      {services.map((s) => {
        const rows = todays.filter((m) => m.status !== 'pending' && m.status !== 'cancelled' && minutesOf(m.start) >= s.start && minutesOf(m.start) < s.end);
        const c = rows.filter((m) => m.status !== 'no-show').reduce((n, m) => n + (m.party ?? 0), 0);
        return (
          <section key={s.name} className="tf-bkf-res-group" aria-label={s.name}>
            <h3 className="tf-bkf-res-group__h"><span>{s.name}<span className="tf-bkf__muted tf-num"> · {formatClockRange(s.start, s.end)}</span></span><span className="tf-bkf__muted tf-num">{plural(c, 'cover')} · {plural(rows.length, 'table')}{(() => {
              // Pacing: the busiest start time against the page's cap, so the host sees a rush coming.
              const cap = page.pacing ?? 0; if (!cap) return null;
              const at0 = [...rows.filter((m) => m.status !== 'no-show').reduce((mp, m) => mp.set(minutesOf(m.start), (mp.get(minutesOf(m.start)) ?? 0) + (m.party ?? 0)), new Map<number, number>())].sort((x, y) => y[1] - x[1])[0];
              return at0 ? ` · busiest ${formatClock(at0[0])}, ${at0[1]} of ${cap}` : null;
            })()}</span></h3>
            {rows.length === 0 ? <p className="tf-bkf__muted tf-bkf-res-group__empty">No reservations yet.</p> : <ul className="tf-bkf-res-rows">{rows.map(row)}</ul>}
          </section>
        );
      })}
      {(() => {
        // Anyone seated or booked outside a service (a walk-in at 4:30, a private booking) still shows, never lost between groups.
        const rows = todays.filter((m) => m.status !== 'pending' && m.status !== 'cancelled' && !services.some((s) => minutesOf(m.start) >= s.start && minutesOf(m.start) < s.end));
        if (rows.length === 0) return null;
        const c = rows.filter((m) => m.status !== 'no-show').reduce((n, m) => n + (m.party ?? 0), 0);
        return (
          <section className="tf-bkf-res-group" aria-label="Outside service hours">
            <h3 className="tf-bkf-res-group__h"><span>Outside service hours</span><span className="tf-bkf__muted tf-num">{plural(c, 'cover')} · {plural(rows.length, 'table')}</span></h3>
            <ul className="tf-bkf-res-rows">{rows.map(row)}</ul>
          </section>
        );
      })()}
      {services.length === 0 && <EmptyState icon={<CalendarPlus size={20} strokeWidth={1.75} />} title="Closed this day" description="No service in your opening hours. You can still add a private booking." />}
      {(() => { const n = todays.filter((m) => m.status === 'cancelled').length; return n > 0 ? <p className="tf-bkf__muted">{plural(n, 'cancellation')} this day.</p> : null; })()}
    </div>
  );

  const waitRail = (
    <aside className="tf-bkf-res-wait" aria-label="Waitlist">
      <div className="tf-bkf-res-wait__head">
        <h3 className="tf-bkf-res-group__h"><span>Waitlist</span><span className="tf-bkf__muted tf-num">{wait.length > 0 ? plural(wait.reduce((n, w) => n + w.party, 0), 'guest') : ''}</span></h3>
        <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => setWaiting(true)}>Add</Button>
      </div>
      {wait.length === 0 ? <p className="tf-bkf__muted">Nobody waiting. Add a party at the door, or guests join online when you're full.</p> : (
        <ul className="tf-bkf-res-rows">
          {wait.map((w) => {
            const waited = mins(w.added, now);
            const over = w.quote !== undefined && waited > w.quote;
            return (
              <li key={w.id} className="tf-bkf-res-w">
                <span className="tf-bkf-res-w__text">
                  <span className="tf-bkf-res__name">{w.name}<span className="tf-bkf__muted tf-num"> · {w.party}</span></span>
                  <span className={cx('tf-bkf__muted tf-num', over && 'tf-bkf-res-w__over')}>
                    {w.online ? `Online · ${w.wanted !== undefined ? `hoping for ${formatClock(w.wanted)}` : 'any time'}` : `Waiting ${waited} min${w.quote !== undefined ? ` · quoted ${w.quote}` : ''}`}{w.notified ? ' · told it’s ready' : ''}
                  </span>
                </span>
                <span className="tf-bkf-res__acts">
                  {isToday && <Button size="sm" variant="secondary" onPress={() => setSeating({ kind: 'wait', wait: w })}>Seat</Button>}
                  <MenuTrigger>
                    <IconButton label={`More for ${w.name}`} size="sm"><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={`Actions for ${w.name}`} placement="bottom end" onAction={(k) => {
                      const list = state.waitlist ?? [];
                      if (k === 'notify') { dispatch({ type: 'waitlist/set', waitlist: list.map((x) => (x.id === w.id ? { ...x, notified: true } : x)) }); toast({ message: w.phone ? `Texted ${first(w.name)} at ${w.phone}: your table is ready` : `Marked as told. ${first(w.name)} left no phone, so call their name.`, tone: 'success' }); }
                      else if (k === 'remove') { dispatch({ type: 'waitlist/set', waitlist: list.filter((x) => x.id !== w.id) }); toast({ message: `${first(w.name)} left the waitlist`, action: { label: 'Undo', onAction: () => dispatch({ type: 'waitlist/set', waitlist: list }) } }); }
                    }}>
                      <MenuItem id="notify" icon={<Clock {...i16} />} description={w.phone || 'No phone: call their name'}>{w.phone ? 'Text: table ready' : 'Table ready (told in person)'}</MenuItem>
                      <MenuItem id="remove" icon={<X {...i16} />}>Remove</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );

  return (
    <div className="tf-bkf__meetings">
      <TabToolbar
        start={<>
          <SegmentedControl aria-label="View" selectedKey={view} onSelectionChange={(k) => setView(k === 'floor' ? 'floor' : 'list')}
            items={[{ id: 'list', label: 'List', icon: <LayoutList {...i14} /> }, { id: 'floor', label: 'Floor', icon: <LayoutGrid {...i14} /> }]} />
          <span className="tf-bkf__weeknav">
            <IconButton size="sm" label="Previous day" onPress={() => setOffset(offset - 1)}><ChevronLeft {...i16} /></IconButton>
            <span className="tf-num tf-bkf-res__day" aria-live="polite">{isToday ? `Today, ${formatDay(day)}` : offset === 1 ? `Tomorrow, ${formatDay(day)}` : formatLongDay(day)}</span>
            <IconButton size="sm" label="Next day" onPress={() => setOffset(offset + 1)}><ChevronRight {...i16} /></IconButton>
            {!isToday && <Button size="sm" variant="ghost" onPress={() => setOffset(0)}>Today</Button>}
          </span>
        </>}
        action={<span className="tf-bkf-res__actions">
          {isToday && <Button variant="secondary" icon={<UserPlus {...i14} />} onPress={() => setSeating({ kind: 'walkin' })}>Walk in</Button>}
          <Button variant="primary" icon={<CalendarPlus {...i14} />} onPress={() => setEditing('new')}>New reservation</Button>
        </span>} />
      <p className="tf-bkf-res__sum tf-num">
        <strong>{plural(covers, 'cover')}</strong><span>{plural(live.filter((m) => m.status !== 'no-show').length, 'table')}</span>
        {isToday && <span>{seatedNow.length} seated now</span>}
        {wait.length > 0 && <span>{wait.length} waiting</span>}
      </p>
      <div className="tf-bkf-res-layout">
        {view === 'list' ? listView : <FloorView onNew={() => setEditing('new')} state={state} page={page} day={day} isToday={isToday} now={now} holdLate={holdLate}
          onSeat={seat} onFinish={finish} onOpen={setEditing} onWalkIn={(t) => setSeating({ kind: 'walkin', table: t })} />}
        {waitRail}
      </div>
      {editing && <ReservationDialog key={editing === 'new' ? 'new' : editing.id} state={state} page={page} day={day} meeting={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)}
        onSave={(m, isNew) => {
          if (isNew) { dispatch({ type: 'meeting/add', meeting: m }); toast({ message: `${first(m.invitee.name)}, ${plural(m.party ?? 2, 'guest')} at ${formatClock(minutesOf(m.start))} · ${tableName(m.tables)}`, tone: 'success' }); }
          else { update(m, 'Reservation changed'); toast({ message: 'Reservation saved', tone: 'success' }); }
          setEditing(undefined);
        }} />}
      {seating && <SeatDialog state={state} page={page} ask={seating} now={now} onClose={() => setSeating(undefined)}
        onSeat={(m, isNew) => {
          const where = tableName(m.tables);
          if (isNew) dispatch({ type: 'meeting/add', meeting: m }); else update(m, `Moved to ${where}`);
          if (seating.kind === 'wait') dispatch({ type: 'waitlist/set', waitlist: (state.waitlist ?? []).filter((x) => x.id !== seating.wait.id) });
          toast({ message: seating.kind === 'move' ? `${first(m.invitee.name)} moved to ${where}` : `${m.walkIn ? `Walk-in, ${m.party ?? 2}` : first(m.invitee.name)} seated at ${where}`, tone: 'success' });
          setSeating(undefined);
        }} />}
      {waiting && <WaitDialog onClose={() => setWaiting(false)} onAdd={(w) => {
        dispatch({ type: 'waitlist/set', waitlist: [...(state.waitlist ?? []), { ...w, id: nextId('w'), added: new Date(), day: isoDay(day) }] });
        toast({ message: `${first(w.name)} added, quoted ${w.quote ?? 0} min`, tone: 'success' }); setWaiting(false);
      }} />}
    </div>
  );
}

/** The day's services from opening hours: one range is "Service", two are Lunch and Dinner. */
function servicesOn(state: BookingsState, day: Date): ReadonlyArray<{ readonly name: string; readonly start: number; readonly end: number }> {
  const d = venueDay(state, day);
  if (!d?.on) return [];
  return d.ranges.map((r) => ({ name: d.ranges.length === 1 ? 'Service' : r.start < 16 * 60 ? 'Lunch' : 'Dinner', start: r.start, end: r.end }));
}

function stageTag(m: BookedMeeting, stage: Stage, now: Date, holdLate: number): ReactNode {
  switch (stage) {
    case 'request': return null;
    case 'late': {
      const late = mins(m.start, now);
      return <Tag size="sm" status="progress" hue="orange">{late > holdLate * 2 ? `${late} min late` : 'Late'}</Tag>;
    }
    case 'seated': {
      const sat = m.seatedAt ? mins(m.seatedAt, now) : 0;
      const turn = mins(m.start, m.end);
      return <Tag size="sm" status="done" hue={sat > turn ? 'orange' : 'green'}>{sat > turn ? `Over by ${sat - turn} min` : `Seated · ${sat} min`}</Tag>;
    }
    case 'left': return <Tag size="sm" hue="gray">Left</Tag>;
    case 'no-show': return <Tag size="sm" status="failed" hue="orange">No-show</Tag>;
    default: return null;
  }
}

/** Every table by area: who's at it and for how long, or when it's next booked. Tap one to act on it. */
function FloorView({ state, page, day, isToday, now, holdLate, onSeat, onFinish, onOpen, onWalkIn, onNew }: {
  /** A free table on a day ahead: book it by phone. */ readonly onNew?: () => void;
  readonly state: BookingsState; readonly page: BookingPage; readonly day: Date; readonly isToday: boolean; readonly now: Date; readonly holdLate: number;
  readonly onSeat: (m: BookedMeeting) => void; readonly onFinish: (m: BookedMeeting) => void; readonly onOpen: (m: BookedMeeting) => void; readonly onWalkIn: (t: Table) => void;
}) {
  const tables = state.tables ?? [];
  const areas = [...new Set(tables.map((t) => t.area))];
  const on = state.meetings.filter((m) => m.pageId === page.id && m.status !== 'cancelled' && m.status !== 'no-show' && m.start.toDateString() === day.toDateString());
  return (
    <div className="tf-bkf-floor">
      {areas.map((a) => (
        <section key={a} className="tf-bkf-floor__area" aria-label={a}>
          <h3 className="tf-bkf-res-group__h"><span>{a}</span><span className="tf-bkf__muted tf-num">{plural(tables.filter((t) => t.area === a).reduce((n, t) => n + t.seats, 0), 'seat')}</span></h3>
          <ul className="tf-bkf-floor__grid">
            {tables.filter((t) => t.area === a).map((t) => {
              const mine = on.filter((m) => (m.tables ?? []).includes(t.id));
              const sat = isToday ? mine.find((m) => stageOf(m, now, holdLate) === 'seated') : undefined;
              const next = mine.find((m) => m.seating !== 'left' && m.status !== 'completed' && m !== sat && (!isToday || m.end > now));
              const state_ = sat ? 'seated' : next && isToday && next.start.getTime() - now.getTime() < 30 * 60_000 ? 'soon' : 'free';
              const satFor = sat?.seatedAt ? mins(sat.seatedAt, now) : 0;
              const turn = sat ? mins(sat.start, sat.end) : 1;
              return (
                <li key={t.id}>
                  <MenuTrigger>
                    <AriaButton className="tf-bkf-floor__table" data-state={state_} data-seats={t.seats > 4 ? 'big' : t.seats > 2 ? 'mid' : 'small'} aria-label={`${t.name}, ${t.seats} seats, ${sat ? `seated, ${sat.invitee.name}` : next ? `free until ${formatClock(minutesOf(next.start))}, then ${next.invitee.name}` : 'free'}`}>
                      <span className="tf-bkf-floor__name">{t.name}<span className="tf-bkf__muted tf-num"> · {t.seats}</span></span>
                      {sat ? (
                        <>
                          <span className="tf-bkf-floor__who">{sat.invitee.name} · {sat.party}</span>
                          <ProgressBar size="sm" aria-label={`${satFor} of ${turn} minutes`} value={Math.min(satFor, turn)} maxValue={turn} />
                          <span className="tf-bkf__muted tf-num">{satFor} of {turn} min</span>
                        </>
                      ) : next ? (
                        <span className="tf-bkf__muted tf-num">{isToday && next.start > now ? `Free until ${formatClock(minutesOf(next.start))} · ${first(next.invitee.name)} (${next.party})` : `${formatClock(minutesOf(next.start))} · ${first(next.invitee.name)} (${next.party})`}</span>
                      ) : <span className="tf-bkf__muted">{t.online ? 'Free' : 'Free · staff only'}</span>}
                    </AriaButton>
                    <Menu aria-label={`${t.name} actions`} placement="bottom start" onAction={(k) => {
                      if (k === 'finish' && sat) onFinish(sat);
                      else if (k === 'seat' && next) onSeat(next);
                      else if (k === 'walkin') onWalkIn(t);
                      else if (k === 'new') onNew?.();
                      else if (k === 'open-sat' && sat) onOpen(sat);
                      else if (k === 'open-next' && next) onOpen(next);
                    }}>
                      {sat ? <MenuItem id="finish" icon={<Users {...i16} />}>Finish: table is free</MenuItem> : null}
                      {sat ? <MenuItem id="open-sat" icon={<Pencil {...i16} />}>{sat.invitee.name}</MenuItem> : null}
                      {!sat && next && isToday ? <MenuItem id="seat" icon={<Users {...i16} />}>Seat {first(next.invitee.name)} ({next.party})</MenuItem> : null}
                      {next ? <MenuItem id="open-next" icon={<Pencil {...i16} />} description={formatClock(minutesOf(next.start))}>{next.invitee.name}</MenuItem> : null}
                      {!sat && isToday ? <MenuItem id="walkin" icon={<UserPlus {...i16} />}>Seat a walk-in</MenuItem> : null}
                      {!isToday ? <MenuItem id="new" icon={<CalendarPlus {...i16} />}>New reservation</MenuItem> : null}
                    </Menu>
                  </MenuTrigger>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Seating someone now: a walk-in, a party off the waitlist, or a booking moving tables. */
type SeatAsk = { readonly kind: 'walkin'; readonly table?: Table } | { readonly kind: 'wait'; readonly wait: WaitParty } | { readonly kind: 'move'; readonly meeting: BookedMeeting };

/** Tables free now for a party: single tables that seat them, then joinable pairs. */
function freeChoices(state: BookingsState, party: number, date: Date, start: number, length: number, skip?: string): ReadonlyArray<{ readonly id: string; readonly label: string; readonly tables: ReadonlyArray<string> }> {
  const held = heldTables(state, date, start, length, skip);
  const free = (state.tables ?? []).filter((t) => !held.has(t.id));
  const singles = free.filter((t) => t.seats >= party).sort((a, b) => a.seats - b.seats).map((t) => ({ id: t.id, label: `${t.name} · ${t.seats} seats · ${t.area}`, tables: [t.id] }));
  const pairs = free.flatMap((a, i) => free.slice(i + 1).filter((b) => a.joinable && b.joinable && a.area === b.area && a.seats + b.seats >= party && a.seats < party && b.seats < party)
    .map((b) => ({ id: `${a.id}+${b.id}`, label: `${a.name} + ${b.name} · ${a.seats + b.seats} seats · ${a.area}`, tables: [a.id, b.id] })));
  return [...singles, ...pairs];
}

function SeatDialog({ state, page, ask, now, onClose, onSeat }: { readonly state: BookingsState; readonly page: BookingPage; readonly ask: SeatAsk; readonly now: Date; readonly onClose: () => void; readonly onSeat: (m: BookedMeeting, isNew: boolean) => void }) {
  const [party, setParty] = useState(ask.kind === 'wait' ? ask.wait.party : ask.kind === 'move' ? ask.meeting.party ?? 2 : Math.min(ask.table?.seats ?? 2, 2));
  const [name, setName] = useState(ask.kind === 'wait' ? ask.wait.name : '');
  const nowMin = minutesOf(now);
  const turn = turnFor(page, party);
  const skip = ask.kind === 'move' ? ask.meeting.id : undefined;
  // Moving a reservation checks tables at its own time; seating now checks now.
  const at0 = ask.kind === 'move' ? ask.meeting.start : now;
  const choices = freeChoices(state, party, at0, minutesOf(at0), ask.kind === 'move' ? Math.round((ask.meeting.end.getTime() - ask.meeting.start.getTime()) / 60_000) : turn, skip);
  const preset = ask.kind === 'walkin' && ask.table && choices.some((c) => c.id === ask.table?.id) ? ask.table.id : undefined;
  const [pick, setPick] = useState<string | undefined>(preset);
  const chosen = choices.find((c) => c.id === pick) ?? choices[0];
  const title = ask.kind === 'move' ? `Change table for ${first(ask.meeting.invitee.name)}` : ask.kind === 'wait' ? `Seat ${first(ask.wait.name)}` : 'Walk in';
  const go = () => {
    if (!chosen) return;
    const start = at(now, nowMin);
    if (ask.kind === 'move') {
      const m = ask.meeting;
      onSeat({ ...m, tables: chosen.tables, placeLabel: chosen.label.split(' · ')[0] ?? '' }, false);
      return;
    }
    const guest = name.trim() || 'Walk-in';
    onSeat({
      id: nextId('m'), pageId: page.id, host: HOST, start, end: new Date(start.getTime() + turn * 60_000), title: `Table for ${party}`,
      invitee: { name: guest, email: '' }, place: PLACES['in-person'].meeting, placeLabel: chosen.label.split(' · ')[0] ?? '', status: 'confirmed', guestZone: 'Asia/Kolkata',
      notes: '', answers: [], activity: [{ id: nextId('a'), text: ask.kind === 'wait' ? 'Seated from the waitlist' : 'Walked in', at: new Date() }],
      party, tables: chosen.tables, seating: 'seated', seatedAt: new Date(), walkIn: ask.kind === 'walkin', phone: ask.kind === 'wait' ? ask.wait.phone : undefined,
    }, true);
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={title} description={ask.kind === 'move' ? 'Free tables now that fit the party.' : `Free now, held for ${turn} min.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!chosen} onPress={go}>{ask.kind === 'move' ? 'Move table' : 'Seat'}</Button></>}>
      <div className="tf-bkf__stack">
        {ask.kind !== 'move' && (
          <div className="tf-bkf__pair">
            <NumberField label="Guests" value={party} minValue={1} maxValue={20} onChange={(n) => { setParty(Number.isFinite(n) ? n : 2); setPick(undefined); }} />
            <TextField label="Name" aside="Optional" value={name} onChange={setName} placeholder="Walk-in" />
          </div>
        )}
        {choices.length === 0
          ? <p className="tf-bkf__muted">No table free for {party} right now. Add them to the waitlist instead.</p>
          : <Select label="Table" value={chosen?.id ?? null} onChange={(v) => setPick(v ?? undefined)} items={choices.map((c, n) => ({ id: c.id, label: c.label, description: n === 0 ? 'Best fit' : undefined }))} />}
      </div>
    </Dialog>
  );
}

function WaitDialog({ onClose, onAdd }: { readonly onClose: () => void; readonly onAdd: (w: Pick<WaitParty, 'name' | 'phone' | 'party' | 'quote'>) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState(2);
  const [quote, setQuote] = useState(20);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Add to waitlist" description="They get a text when their table is ready."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onAdd({ name: name.trim(), phone, party, quote })}>Add</Button></>}>
      <div className="tf-bkf__stack">
        <div className="tf-bkf__pair">
          <TextField label="Name" value={name} onChange={setName} autoFocus isRequired />
          <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
        </div>
        <div className="tf-bkf__pair">
          <NumberField label="Guests" value={party} minValue={1} maxValue={20} onChange={(n) => setParty(Number.isFinite(n) ? n : 2)} />
          <Select label="Quoted wait" value={String(quote)} onChange={(v) => { if (v) setQuote(Number(v)); }} items={QUOTES.map((q) => ({ id: String(q), label: `${q} min` }))} />
        </div>
      </div>
    </Dialog>
  );
}

/** New reservation, or open one: the guest, party, when, which table, and what the floor should know. */
function ReservationDialog({ state, page, day, meeting, onClose, onSave }: {
  readonly state: BookingsState; readonly page: BookingPage; readonly day: Date; readonly meeting?: BookedMeeting; readonly onClose: () => void; readonly onSave: (m: BookedMeeting, isNew: boolean) => void;
}) {
  const now = new Date();
  const [name, setName] = useState(meeting?.invitee.name ?? '');
  const [phone, setPhone] = useState(meeting?.phone ?? '');
  const [email, setEmail] = useState(meeting?.invitee.email ?? '');
  const [party, setParty] = useState(meeting?.party ?? 2);
  const [dayId, setDayId] = useState(isoDay(meeting?.start ?? day));
  const [time, setTime] = useState<number | undefined>(meeting ? minutesOf(meeting.start) : undefined);
  const [pick, setPick] = useState<string | undefined>(meeting?.tables?.join('+'));
  const [occasion, setOccasion] = useState(meeting?.occasion ?? '');
  const [tags, setTags] = useState<ReadonlyArray<string>>(meeting?.tags ?? []);
  const [notes, setNotes] = useState(meeting?.notes ?? '');
  // Its own date stays in the list, even when it has passed, so editing an old reservation never shows a blank date.
  const ahead = Array.from({ length: 60 }, (_, n) => dayFrom(now, n));
  const days = meeting && !ahead.some((x) => isoDay(x) === isoDay(meeting.start)) ? [dayFrom(meeting.start, 0), ...ahead] : ahead;
  const d = days.find((x) => isoDay(x) === dayId) ?? (meeting?.start ?? day);
  const turn = turnFor(page, party);
  // The host can book any time in service hours, staff-only tables included.
  const slots = servicesOn(state, d).flatMap((s) => Array.from({ length: Math.max(0, Math.floor((s.end - s.start) / 15)) }, (_, n) => s.start + n * 15));
  const choices = time === undefined ? [] : freeChoices(state, party, d, time, turn, meeting?.id);
  const chosen = choices.find((c) => c.id === pick) ?? choices[0];
  const auto = time !== undefined ? fitTables(state, party, d, time, turn, false, undefined, meeting?.id) : undefined;
  const ok = name.trim() !== '' && time !== undefined && chosen !== undefined;
  const save = () => {
    if (!ok || time === undefined || !chosen) return;
    const start = at(d, time);
    const base: BookedMeeting = meeting ?? {
      id: nextId('m'), pageId: page.id, host: HOST, start, end: start, title: '', invitee: { name: '', email: '' }, place: PLACES['in-person'].meeting, placeLabel: '',
      status: 'confirmed', guestZone: 'Asia/Kolkata', notes: '', answers: [], activity: [{ id: nextId('a'), text: `Booked by ${first(HOST)} by phone`, at: new Date() }],
    };
    onSave({
      ...base, start, end: new Date(start.getTime() + turn * 60_000), title: `Table for ${party}`, invitee: { ...base.invitee, name: name.trim(), email: email.trim() },
      party, tables: chosen.tables, placeLabel: chosen.label.split(' · ')[0] ?? '', phone: phone.trim() || undefined, occasion: occasion || undefined, tags: tags.length ? tags : undefined, notes: notes.trim(),
    }, !meeting);
  };
  const extras = Boolean(meeting?.occasion || meeting?.tags?.length || meeting?.notes);
  const fields = (
    <div className="tf-bkf__stack">
      <Select label="Occasion" value={occasion || 'none'} onChange={(v) => setOccasion(v && v !== 'none' ? v : '')} items={[{ id: 'none', label: 'None' }, ...OCCASIONS.map((o) => ({ id: o, label: o }))]} />
      <ChoiceChips label="Tags" selectionMode="multiple" size="sm" selectedKeys={[...tags]} onSelectionChange={(k) => setTags([...k].map(String))} items={TAGS.map((t) => ({ id: t, label: t }))} />
      <TextArea label="Notes for the floor" rows={2} value={notes} onChange={setNotes} placeholder="Allergies, seating, a cake to bring out" />
    </div>
  );
  return (
    <Dialog isOpen size="md" onOpenChange={(o) => { if (!o) onClose(); }} title={meeting ? meeting.invitee.name : 'New reservation'}
      description={meeting ? `${plural(meeting.party ?? 2, 'guest')} · ${formatLongDay(meeting.start)}, ${formatClock(minutesOf(meeting.start))}${meeting.phone ? ` · ${meeting.phone}` : ''}` : 'Taken by phone or in person. The guest gets an email if you add one.'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ok} onPress={save}>{meeting ? 'Save' : 'Book table'}</Button></>}>
      <div className="tf-bkf__stack">
        <div className="tf-bkf__pair">
          <TextField label="Name" value={name} onChange={setName} autoFocus={!meeting} isRequired />
          <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
        </div>
        <TextField label="Email" aside="Optional" type="email" value={email} onChange={setEmail} />
        <div className="tf-bkf__pair">
          <NumberField label="Guests" value={party} minValue={1} maxValue={30} onChange={(n) => { setParty(Number.isFinite(n) ? n : 2); setPick(undefined); }} />
          <Select label="Date" value={dayId} onChange={(v) => { if (v) { setDayId(v); setPick(undefined); } }}
            items={days.map((x) => { const n = Math.round((dayFrom(x, 0).getTime() - dayFrom(now, 0).getTime()) / 86_400_000); return { id: isoDay(x), label: n === 0 ? `Today, ${formatDay(x)}` : n === 1 ? `Tomorrow, ${formatDay(x)}` : n < 0 ? `${formatLongDay(x)} (passed)` : formatLongDay(x) }; })} />
        </div>
        <div className="tf-bkf__pair">
          <Select label="Time" placeholder={slots.length ? 'Pick a time' : 'Closed this day'} isDisabled={slots.length === 0} value={time === undefined ? null : String(time)} onChange={(v) => { if (v) { setTime(Number(v)); setPick(undefined); } }}
            items={slots.map((m) => ({ id: String(m), label: formatClock(m) }))} />
          <Select label="Table" placeholder={time === undefined ? 'Pick a time first' : 'No table free'} isDisabled={choices.length === 0} value={chosen?.id ?? null} onChange={(v) => setPick(v ?? undefined)}
            items={choices.map((c) => ({ id: c.id, label: c.label.split(' · ')[0] ?? c.label, description: c.tables.join('+') === auto?.map((t) => t.id).join('+') ? 'Best fit' : c.label.split(' · ').slice(1).join(' · ') }))} />
        </div>
        {time !== undefined && choices.length === 0 && <p className="tf-bkf__muted">Every table that seats {party} is taken at {formatClock(time)}. Try another time, or add them to the waitlist.</p>}
        {extras ? fields : <ShowMore showLabel="Occasion, tags and notes" hideLabel="Fewer details">{fields}</ShowMore>}
      </div>
    </Dialog>
  );
}
