import { Button as AriaButton, DialogTrigger, Heading } from 'react-aria-components';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AlertTriangle, MapPin, Users, Video } from 'lucide-react';
import { AvatarGroup } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { cx } from '../../lib/cx.ts';
import { formatClock, formatClockRange } from './clock.ts';
import './WeekCalendar.css';

export { formatClock, formatClockRange, minutesOf } from './clock.ts';

/** Timefix meetings are blue, internal time grey, in-person orange. */
export type WeekEventKind = 'meeting' | 'internal' | 'in-person';
/** One event on the grid. `day` is the column index; times are minutes from midnight. */
export interface WeekEvent {
  readonly id: string;
  readonly title: string;
  readonly day: number;
  readonly start: number;
  readonly end: number;
  readonly kind: WeekEventKind;
  readonly guests?: ReadonlyArray<string>;
  readonly location?: string;
}
/** Time another calendar holds: drawn hatched, never as an event. */
export interface WeekBusy { readonly id: string; readonly day: number; readonly start: number; readonly end: number; readonly source: string }
/** A column's header. */
export interface WeekDay { readonly weekday: string; readonly date: number; readonly label: string; readonly isToday?: boolean }
/** A time range dragged out on empty space (or picked with the keyboard). */
export interface WeekSelection { readonly day: number; readonly start: number; readonly end: number }

/** Props for WeekCalendar. */
export interface WeekCalendarProps {
  readonly days: ReadonlyArray<WeekDay>;
  readonly events: ReadonlyArray<WeekEvent>;
  readonly busy?: ReadonlyArray<WeekBusy>;
  readonly startHour?: number;
  readonly endHour?: number;
  /** Where the now-line sits; leave it out for a week that is not this one. */
  readonly now?: { readonly day: number; readonly minutes: number };
  readonly hour12?: boolean;
  readonly onSelect?: (selection: WeekSelection | undefined) => void;
  readonly onJoin?: (event: WeekEvent) => void;
  readonly onReschedule?: (event: WeekEvent) => void;
  /** Makes events movable: drag one (or Enter, arrows, Enter) to move it, drag its bottom edge to change its length. Called once, on drop. */
  readonly onEventChange?: (event: WeekEvent, next: WeekSelection) => void;
  /** How tall the scrolling hours area is (a CSS length), e.g. to fill a page; 8.5 hours when not given. */
  readonly scrollHeight?: string;
}

const STEP = 15;
/** How far the pointer travels before a press on an event becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
const SETTLE_MS = 250; // --duration-fast
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Side-by-side lanes for events that overlap in one day. */
function placeLanes(list: ReadonlyArray<WeekEvent>) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: WeekEvent[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => { cluster.forEach((e) => { const p = out.get(e.id); if (p) out.set(e.id, { lane: p.lane, lanes: laneEnds.length }); }); cluster = []; laneEnds = []; };
  for (const e of sorted) {
    if (e.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= e.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds = [...laneEnds, e.end]; } else laneEnds = laneEnds.map((end, n) => (n === lane ? e.end : end));
    out.set(e.id, { lane, lanes: 1 });
    cluster = [...cluster, e];
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return out;
}

/** An event being moved or resized: where it was, where it is now, and how. */
interface Moving {
  readonly id: string;
  readonly mode: 'move' | 'resize';
  readonly via: 'pointer' | 'keyboard';
  readonly origin: WeekSelection;
  readonly at: WeekSelection;
}
/** A pointer press on an event that has not yet travelled far enough to be a drag. */
interface Pressing { readonly id: string; readonly mode: 'move' | 'resize'; readonly x: number; readonly y: number; readonly origin: WeekSelection; readonly started: boolean }

/** The team week: hour gutter, day headers, now-line, tinted events with a popover, hatched busy time, drag to select, and events that move and resize. */
export function WeekCalendar({ days, events, busy = [], startHour = 8, endHour = 18, now, hour12 = true, onSelect, onJoin, onReschedule, onEventChange, scrollHeight }: WeekCalendarProps) {
  const hours = endHour - startHour;
  const from = startHour * 60;
  const [sel, setSel] = useState<WeekSelection>();
  const drag = useRef<{ day: number; anchor: number } | undefined>(undefined);
  const pos = (m: number) => (m - from) / 60;
  const range = (a: number, b: number) => formatClockRange(a, b, hour12);
  const editable = onEventChange !== undefined;
  const hintId = useId();

  // Moving and resizing events.
  const [moving, setMoving] = useState<Moving>();
  const [openId, setOpenId] = useState<string>();
  const [settling, setSettling] = useState<string>();
  const [said, setSaid] = useState('');
  const press = useRef<Pressing | undefined>(undefined);
  const justDragged = useRef(false);
  const cols = useRef<Array<HTMLDivElement | null>>([]);
  const movingRef = useRef(moving);
  movingRef.current = moving;
  const dayLabel = (day: number) => days[day]?.label ?? '';
  const titleOf = (id: string) => events.find((e) => e.id === id)?.title ?? 'Event';

  const finish = (commit: boolean) => {
    const m = movingRef.current;
    press.current = undefined;
    setMoving(undefined);
    if (!m) return;
    const ev = events.find((e) => e.id === m.id);
    const changed = m.at.day !== m.origin.day || m.at.start !== m.origin.start || m.at.end !== m.origin.end;
    if (commit && ev && changed) {
      onEventChange?.(ev, m.at);
      setSettling(m.id);
      window.setTimeout(() => setSettling((s) => (s === m.id ? undefined : s)), SETTLE_MS);
      setSaid(`${ev.title} moved to ${dayLabel(m.at.day)}, ${range(m.at.start, m.at.end)}`);
    } else setSaid(commit ? '' : `Move cancelled. ${titleOf(m.id)} stays at ${range(m.origin.start, m.origin.end)}`);
  };
  // Esc cancels a pointer drag wherever focus is.
  useEffect(() => {
    if (moving?.via !== 'pointer') return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Where a pointer drag puts the event: 15 minute steps vertically, the column under the pointer for a move. */
  const placeAt = (p: Pressing, x: number, y: number): WeekSelection => {
    const col = cols.current[p.origin.day];
    const hourPx = col ? col.getBoundingClientRect().height / hours : 48;
    const dm = Math.round(((y - p.y) / hourPx) * (60 / STEP)) * STEP;
    if (p.mode === 'resize') return { ...p.origin, end: Math.min(Math.max(p.origin.end + dm, p.origin.start + STEP), endHour * 60) };
    const len = p.origin.end - p.origin.start;
    const start = Math.min(Math.max(p.origin.start + dm, from), endHour * 60 - len);
    const over = cols.current.findIndex((c) => { const r = c?.getBoundingClientRect(); return r !== undefined && x >= r.left && x < r.right; });
    return { day: over === -1 ? p.origin.day : over, start, end: start + len };
  };
  const eventDown = (ev: WeekEvent, mode: 'move' | 'resize') => (e: PointerEvent<HTMLElement>) => {
    if (!editable || e.button !== 0) return;
    if (mode === 'resize') e.stopPropagation();
    press.current = { id: ev.id, mode, x: e.clientX, y: e.clientY, origin: { day: ev.day, start: ev.start, end: ev.end }, started: false };
  };
  const eventMove = (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.started) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD_PX) return;
      // Captured only once it is a drag, so a plain click still opens the event's popover.
      e.currentTarget.setPointerCapture(e.pointerId);
      press.current = { ...p, started: true };
      setOpenId(undefined);
    }
    const at = placeAt(p, e.clientX, e.clientY);
    setMoving({ id: p.id, mode: p.mode, via: 'pointer', origin: p.origin, at });
  };
  const eventUp = () => {
    const p = press.current;
    press.current = undefined;
    if (!p?.started) return;
    justDragged.current = true;
    window.setTimeout(() => { justDragged.current = false; }, 0);
    finish(true);
  };
  /** Keyboard moving: Enter picks up, arrows move 15 minutes or a day, Shift with arrows changes the length, Enter drops, Esc cancels. */
  const eventKeys = (ev: WeekEvent) => (e: KeyboardEvent<HTMLElement>) => {
    if (!editable) return;
    const m = moving?.id === ev.id && moving.via === 'keyboard' ? moving : undefined;
    if (!m) {
      if (e.key !== 'Enter' || moving) return;
      e.preventDefault(); e.stopPropagation();
      const origin = { day: ev.day, start: ev.start, end: ev.end };
      setMoving({ id: ev.id, mode: 'move', via: 'keyboard', origin, at: origin });
      setSaid(`Picked up ${ev.title}, ${dayLabel(ev.day)}, ${range(ev.start, ev.end)}. Arrows move it, Enter drops, Esc cancels.`);
      return;
    }
    const a = m.at;
    const len = a.end - a.start;
    let next: WeekSelection | undefined;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const d = e.key === 'ArrowDown' ? STEP : -STEP;
      if (e.shiftKey) next = { ...a, end: Math.min(Math.max(a.end + d, a.start + STEP), endHour * 60) };
      else { const start = Math.min(Math.max(a.start + d, from), endHour * 60 - len); next = { ...a, start, end: start + len }; }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      next = { ...a, day: Math.min(Math.max(a.day + (e.key === 'ArrowRight' ? 1 : -1), 0), days.length - 1) };
    } else if (e.key === 'Tab') { finish(false); return; } else return;
    e.preventDefault(); e.stopPropagation();
    setMoving({ ...m, at: next });
    setSaid(`${dayLabel(next.day)}, ${range(next.start, next.end)}`);
  };
  const conflictAt = (id: string, at: WeekSelection) =>
    busy.some((b) => b.day === at.day && overlaps(b, at)) || events.some((o) => o.id !== id && o.day === at.day && overlaps(o, at));

  const update = (next: WeekSelection | undefined) => { setSel(next); onSelect?.(next); };
  const minuteAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = from + Math.floor(((e.clientY - r.top) / r.height) * hours * (60 / STEP)) * STEP;
    return Math.min(Math.max(m, from), endHour * 60 - STEP);
  };
  const down = (day: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tf-week__item')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = minuteAt(e);
    drag.current = { day, anchor: m };
    setSel({ day, start: m, end: m + STEP });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const m = minuteAt(e);
    setSel({ day: d.day, start: Math.min(d.anchor, m), end: Math.max(d.anchor, m) + STEP });
  };
  const up = () => { if (drag.current) { drag.current = undefined; onSelect?.(sel); } };
  const keys = (day: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const cur = sel?.day === day ? sel : undefined;
    const clamp = (s: WeekSelection) => (s.start < from || s.end > endHour * 60 || s.end <= s.start ? cur : s);
    let next: WeekSelection | undefined;
    if (e.key === 'Enter' || e.key === ' ') next = cur ?? { day, start: Math.max(from, 9 * 60), end: Math.max(from, 9 * 60) + 30 };
    else if (e.key === 'Escape') { if (sel) { e.preventDefault(); update(undefined); } return; }
    else if (cur && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const d = e.key === 'ArrowDown' ? STEP : -STEP;
      next = clamp(e.shiftKey ? { ...cur, end: cur.end + d } : { ...cur, start: cur.start + d, end: cur.end + d });
    } else return;
    e.preventDefault();
    update(next);
  };

  return (
    <div className="tf-week" style={{ '--tf-week-days': days.length, '--tf-week-hours': hours } as React.CSSProperties}>
      <div className="tf-week__head" role="presentation">
        <span className="tf-week__corner" />
        {days.map((d) => (
          <div key={d.label} className={cx('tf-week__dayhead', d.isToday && 'tf-week__dayhead--today')}>
            <span className="tf-week__weekday">{d.weekday}</span>
            <span className="tf-week__date tf-num">{d.date}</span>
          </div>
        ))}
      </div>
      <div className="tf-week__scroll" style={scrollHeight ? ({ '--tf-week-scroll': scrollHeight } as React.CSSProperties) : undefined}>
        <div className="tf-week__body">
          <div className="tf-week__gutter" aria-hidden="true">
            {Array.from({ length: hours }, (_, n) => n > 0 && <span key={n} className="tf-week__hour" style={{ '--tf-at': n } as React.CSSProperties}>{hour12 ? `${((startHour + n + 11) % 12) + 1} ${startHour + n < 12 ? 'AM' : 'PM'}` : `${String(startHour + n).padStart(2, '0')}:00`}</span>)}
            {now && now.minutes >= from && now.minutes <= endHour * 60 && (
              <span className="tf-week__now-time tf-num" style={{ '--tf-top': pos(now.minutes) } as React.CSSProperties}>{formatClock(now.minutes, hour12)}</span>
            )}
          </div>
          {days.map((d, day) => {
            const dayEvents = events.filter((e) => e.day === day);
            const dayBusy = busy.filter((b) => b.day === day);
            const lanes = placeLanes(dayEvents);
            return (
              <div key={d.label} ref={(el) => { cols.current[day] = el; }} className="tf-week__col" tabIndex={0} role="group"
                aria-label={`${d.label}. Enter picks a time, arrows move it, Shift with arrows changes its length.`}
                onPointerDown={down(day)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={keys(day)}>
                {Array.from({ length: hours }, (_, n) => <span key={n} className="tf-week__line" style={{ '--tf-at': n } as React.CSSProperties} aria-hidden="true" />)}
                {dayBusy.map((b) => (
                  <div key={b.id} className="tf-week__busy" style={{ '--tf-top': pos(b.start), '--tf-len': (b.end - b.start) / 60 } as React.CSSProperties} title={`Busy · ${b.source}`}>
                    <span aria-hidden="true">Busy</span>
                    <span className="tf-sr-only">Busy {range(b.start, b.end)}, {b.source}</span>
                  </div>
                ))}
                {dayEvents.map((ev) => {
                  const lane = lanes.get(ev.id) ?? { lane: 0, lanes: 1 };
                  const conflict = conflictAt(ev.id, ev);
                  const isGhost = moving?.id === ev.id;
                  return (
                    <div key={ev.id}
                      className={cx('tf-week__item', isGhost && 'is-ghost', settling === ev.id && 'is-settling', editable && 'is-editable')}
                      style={{ '--tf-top': pos(ev.start), '--tf-len': (ev.end - ev.start) / 60, '--tf-lane': lane.lane, '--tf-lanes': lane.lanes } as React.CSSProperties}
                      onPointerDown={eventDown(ev, 'move')} onPointerMove={eventMove} onPointerUp={eventUp} onPointerCancel={() => finish(false)}
                      onKeyDownCapture={eventKeys(ev)}>
                      <DialogTrigger isOpen={openId === ev.id && !moving} onOpenChange={(o) => { if (o && justDragged.current) return; setOpenId(o ? ev.id : undefined); }}>
                        <AriaButton className={cx('tf-week__event', `tf-week__event--${ev.kind}`, ev.end - ev.start < 60 && 'tf-week__event--short')}
                          aria-label={`${ev.title}, ${range(ev.start, ev.end)}${conflict ? ', conflict' : ''}`} aria-describedby={editable ? hintId : undefined}>
                          <EventFace ev={ev} start={ev.start} end={ev.end} conflict={conflict} hour12={hour12} />
                        </AriaButton>
                        <Popover label={ev.title} placement="end top" offset={8} className="tf-week__pop">
                          <div className="tf-week__dialog">
                            <Heading slot="title" className="tf-week__pop-title">{ev.title}</Heading>
                            <p className="tf-week__pop-when tf-num">{d.label} · {range(ev.start, ev.end)}</p>
                            {ev.location && <p className="tf-week__pop-row">{ev.kind === 'in-person' ? <MapPin size={14} strokeWidth={1.75} aria-hidden /> : <Video size={14} strokeWidth={1.75} aria-hidden />}{ev.location}</p>}
                            {conflict && <p className="tf-week__pop-row tf-week__pop-row--warn"><AlertTriangle size={14} strokeWidth={1.75} aria-hidden />Overlaps other busy time</p>}
                            {ev.guests && ev.guests.length > 0 && (
                              <div className="tf-week__pop-row"><Users size={14} strokeWidth={1.75} aria-hidden /><AvatarGroup names={ev.guests} size={20} max={4} /><span className="tf-num">{ev.guests.length} guests</span></div>
                            )}
                            <div className="tf-week__pop-actions">
                              {ev.kind === 'meeting' && <Button size="sm" variant="primary" icon={<Video size={14} strokeWidth={1.75} />} onPress={() => onJoin?.(ev)}>Join</Button>}
                              <Button size="sm" onPress={() => onReschedule?.(ev)}>Reschedule</Button>
                            </div>
                          </div>
                        </Popover>
                      </DialogTrigger>
                      {editable && <span className="tf-week__resize" aria-hidden="true" onPointerDown={eventDown(ev, 'resize')} />}
                    </div>
                  );
                })}
                {moving?.at.day === day && (() => {
                  const ev = events.find((x) => x.id === moving.id);
                  if (!ev) return null;
                  return (
                    <div className="tf-week__item tf-week__item--lifted" aria-hidden="true"
                      style={{ '--tf-top': pos(moving.at.start), '--tf-len': (moving.at.end - moving.at.start) / 60, '--tf-lane': 0, '--tf-lanes': 1 } as React.CSSProperties}>
                      <div className={cx('tf-week__event', `tf-week__event--${ev.kind}`, moving.at.end - moving.at.start < 60 && 'tf-week__event--short')}>
                        <EventFace ev={ev} start={moving.at.start} end={moving.at.end} conflict={conflictAt(ev.id, moving.at)} hour12={hour12} showRange />
                      </div>
                    </div>
                  );
                })()}
                {sel?.day === day && (
                  <div className="tf-week__sel" style={{ '--tf-top': pos(sel.start), '--tf-len': (sel.end - sel.start) / 60 } as React.CSSProperties} aria-hidden="true">
                    <span className="tf-num">{range(sel.start, sel.end)}</span>
                  </div>
                )}
                {now?.day === day && now.minutes >= from && now.minutes <= endHour * 60 && (
                  <span className="tf-week__now" style={{ '--tf-top': pos(now.minutes) } as React.CSSProperties} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="tf-sr-only" aria-live="polite">{said || (sel ? `Selected ${days[sel.day]?.label ?? ''}, ${range(sel.start, sel.end)}` : '')}</p>
      {editable && <p id={hintId} className="tf-sr-only">Enter picks the event up: arrows move it 15 minutes or a day, Shift with arrows changes its length, Enter drops it, Esc puts it back. Space opens its details.</p>}
    </div>
  );
}

/** An event's inside: title and time (one line under an hour), and the Conflict tag. While moving it always shows its new range. */
function EventFace({ ev, start, end, conflict, hour12, showRange = false }: { readonly ev: WeekEvent; readonly start: number; readonly end: number; readonly conflict: boolean; readonly hour12: boolean; readonly showRange?: boolean }) {
  // Under an hour (48px) there is room for one line only: "Title · 10:00 AM".
  const short = end - start < 60;
  return (
    <>
      {/* A button centres overflowing content, so the body is pinned to the event's box. */}
      <span className={cx('tf-week__event-body', conflict && 'has-conflict')}>
        {short ? (
          <span className="tf-week__event-line"><span className="tf-week__event-title">{ev.title}</span><span className="tf-week__event-time tf-num"> · {showRange ? formatClockRange(start, end, hour12) : formatClock(start, hour12)}</span></span>
        ) : (
          <>
            <span className="tf-week__event-title">{ev.title}</span>
            <span className="tf-week__event-time tf-num">{formatClockRange(start, end, hour12)}</span>
          </>
        )}
      </span>
      {conflict && <span className="tf-week__conflict"><AlertTriangle size={12} strokeWidth={2} aria-hidden />{!short && 'Conflict'}</span>}
    </>
  );
}
