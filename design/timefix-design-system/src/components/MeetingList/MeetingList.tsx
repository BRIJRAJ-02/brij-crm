import { Button as AriaButton } from 'react-aria-components';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, CalendarX2, Link2, MapPin, MoreHorizontal, Phone, StickyNote, UserX, Video, X } from 'lucide-react';
import { AvatarGroup } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { Skeleton } from '../Motion/Motion.tsx';
import { StatusIcon } from '../Icon/StatusIcon.tsx';
import { cx } from '../../lib/cx.ts';
import { formatClock, formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { formatDay, formatLongDay, relativeDayLabel } from '../../lib/format.ts';
import './MeetingList.css';

/** Where a meeting happens. */
export type MeetingPlace = 'video' | 'phone' | 'in-person';
/** A meeting's state. */
export type MeetingStatus = 'confirmed' | 'pending' | 'cancelled' | 'completed' | 'no-show';
/** One booked meeting. */
export interface Meeting {
  readonly id: string;
  readonly start: Date;
  readonly end: Date;
  readonly title: string;
  readonly invitee: { readonly name: string; readonly email: string };
  readonly guests?: ReadonlyArray<string>;
  readonly place: MeetingPlace;
  readonly placeLabel: string;
  readonly status: MeetingStatus;
  /** Whose meeting it is, when the list shows a team's: added to the place line. */
  readonly host?: string;
}

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const clock = (d: Date, hour12: boolean) => formatClock(minutesOf(d), hour12);
const span = (a: Date, b: Date, hour12: boolean) => formatClockRange(minutesOf(a), minutesOf(b), hour12);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
/** A day heading: "Wednesday 11 November", with a Today, Tomorrow or Yesterday chip in front. */
function dayTitle(d: Date, now: Date): { main: string; chip?: string } {
  const rel = relativeDayLabel(d, now);
  return rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday' ? { main: formatLongDay(d), chip: rel } : { main: formatLongDay(d) };
}

/** A place's icon at 14px. */
export function PlaceIcon({ place }: { readonly place: MeetingPlace }) {
  return place === 'video' ? <Video {...i14} aria-hidden /> : place === 'phone' ? <Phone {...i14} aria-hidden /> : <MapPin {...i14} aria-hidden />;
}

/** A meeting's status as a tag: the shape keeps its meaning without colour. */
export function MeetingStatusTag({ status }: { readonly status: MeetingStatus }) {
  switch (status) {
    case 'confirmed': return <Tag size="sm" status="done">Confirmed</Tag>;
    case 'pending': return <Tag size="sm" status="waiting">Pending</Tag>;
    case 'cancelled': return <Tag size="sm" status="failed">Cancelled</Tag>;
    case 'no-show': return <Tag size="sm" status="failed" hue="orange">No-show</Tag>;
    case 'completed': return <Tag size="sm" status="done" hue="gray">Completed</Tag>;
  }
}

/** Props for MeetingList. */
export interface MeetingListProps {
  /** Sorted by start. */
  readonly meetings: ReadonlyArray<Meeting>;
  readonly now: Date;
  readonly hour12?: boolean;
  /** Draws skeleton rows; when it turns false the rows resolve in (14 skeleton reveal). */
  readonly loading?: boolean;
  readonly onReschedule?: (m: Meeting) => void;
  /** Cancels at once; the row collapses in place to "Cancelled · Undo". */
  readonly onCancel?: (m: Meeting) => void;
  readonly onUndoCancel?: (m: Meeting) => void;
  /** The undo window passed: email the guest now. The strip then reads "Cancelled · Guest emailed". */
  readonly onCancelSettled?: (m: Meeting) => void;
  /** How long Undo stays offered; matches the action toast's 8 seconds by default. */
  readonly undoMs?: number;
  /** Opens a meeting (its drawer): a press on the row, or Enter or Space on a focused row. Makes rows focusable. */
  readonly onOpen?: (m: Meeting) => void;
  /** Requests waiting for the host's OK: a first group, "Needs your OK · 2", in the same row style, each row showing its day. */
  readonly requests?: ReadonlyArray<Meeting>;
  /** Fills its container instead of capping at 1040px (a full-width page). */
  readonly isFullWidth?: boolean;
  /** Meetings that busy time on a calendar now overlaps: their row carries a small "Clash" tag. */
  readonly conflictIds?: ReadonlySet<string>;
  /** A row that just arrived (a new booking): it drops in under its day with a soft accent wash. */
  readonly highlightId?: string;
  readonly onCopyLink?: (m: Meeting) => void;
  readonly onNoShow?: (m: Meeting) => void;
  /** "Add a note" in the row's menu. */
  readonly onNote?: (m: Meeting) => void;
  /** Requests (status `pending`) show Confirm and Decline in place of the hover actions when these are given. */
  readonly onConfirm?: (m: Meeting) => void;
  readonly onDecline?: (m: Meeting) => void;
  /** What the empty state offers, e.g. a "Copy booking link" button. */
  readonly emptyAction?: ReactNode;
}

function RowActions({ m, onReschedule, onCancel, onCopyLink, onNoShow, onNote, onConfirm, onDecline }: { readonly m: Meeting } & Pick<MeetingListProps, 'onReschedule' | 'onCancel' | 'onCopyLink' | 'onNoShow' | 'onNote' | 'onConfirm' | 'onDecline'>) {
  const open = m.status === 'confirmed' || m.status === 'pending';
  if (m.status === 'pending' && onConfirm && onDecline) {
    return (
      <span className="tf-meetings__decide">
        <Button size="sm" variant="ghost" onPress={() => onDecline(m)} aria-label={`Decline ${m.title} with ${m.invitee.name}`}>Decline</Button>
        <Button size="sm" variant="secondary" onPress={() => onConfirm(m)} aria-label={`Confirm ${m.title} with ${m.invitee.name}`}>Confirm</Button>
      </span>
    );
  }
  return (
    <span className="tf-meetings__actions">
      {open && <Tooltip label="Reschedule"><IconButton label={`Reschedule ${m.title}`} size="sm" onPress={() => onReschedule?.(m)}><CalendarClock {...i14} /></IconButton></Tooltip>}
      {open && <Tooltip label="Cancel"><IconButton label={`Cancel ${m.title}`} size="sm" onPress={() => onCancel?.(m)}><X {...i14} /></IconButton></Tooltip>}
      <MenuTrigger>
        <IconButton label={`More for ${m.title}`} size="sm"><MoreHorizontal {...i14} /></IconButton>
        <Menu aria-label={`Actions for ${m.title}`} placement="bottom end" onAction={(key) => {
          if (key === 'copy') onCopyLink?.(m);
          else if (key === 'noshow') onNoShow?.(m);
          else if (key === 'reschedule') onReschedule?.(m);
          else if (key === 'cancel') onCancel?.(m);
          else if (key === 'note') onNote?.(m);
        }}>
          <MenuItem id="copy" icon={<Link2 {...i16} />}>Copy meeting link</MenuItem>
          {open && <MenuItem id="reschedule" icon={<CalendarClock {...i16} />}>Reschedule</MenuItem>}
          <MenuItem id="note" icon={<StickyNote {...i16} />}>Add a note</MenuItem>
          <MenuItem id="noshow" icon={<UserX {...i16} />}>Mark as no-show</MenuItem>
          {open && <MenuSeparator />}
          {open && <MenuItem id="cancel" icon={<CalendarX2 {...i16} />} isDanger>Cancel meeting</MenuItem>}
        </Menu>
      </MenuTrigger>
    </span>
  );
}

/** How long a cancelled row offers Undo before the guest is emailed. */
export const CANCEL_UNDO_MS = 8_000;

/** The Meetings list: day groups with sticky headers, a now-line, rows that open on press or Enter, hover actions, and cancel to "Cancelled · Undo" in place. */
export function MeetingList({ meetings, now, hour12 = true, loading = false, onReschedule, onCancel, onUndoCancel, onCancelSettled, undoMs = CANCEL_UNDO_MS, onCopyLink, onNoShow, onNote, onConfirm, onDecline, onOpen, highlightId, conflictIds, requests = [], isFullWidth = false, emptyAction }: MeetingListProps) {
  // A cancelled row is a strip: first "Cancelled · Undo", then, once the undo window passes, "Cancelled · Guest emailed".
  const [strips, setStrips] = useState<ReadonlyMap<string, 'undo' | 'settled'>>(new Map());
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => { for (const t of timers.current.values()) window.clearTimeout(t); }, []);
  const [skeleton, setSkeleton] = useState(loading);
  useEffect(() => {
    if (loading) { setSkeleton(true); return undefined; }
    const t = window.setTimeout(() => setSkeleton(false), 400); // --duration-slow, the reveal's length
    return () => window.clearTimeout(t);
  }, [loading]);

  const cancel = (m: Meeting) => {
    setStrips((s) => new Map(s).set(m.id, 'undo'));
    onCancel?.(m);
    timers.current.set(m.id, window.setTimeout(() => {
      timers.current.delete(m.id);
      setStrips((s) => new Map(s).set(m.id, 'settled'));
      onCancelSettled?.(m);
    }, undoMs));
  };
  const undo = (m: Meeting) => {
    window.clearTimeout(timers.current.get(m.id));
    timers.current.delete(m.id);
    setStrips((s) => { const n = new Map(s); n.delete(m.id); return n; });
    onUndoCancel?.(m);
  };
  const press = (m: Meeting, strip: boolean) => (e: MouseEvent<HTMLLIElement>) => {
    if (!onOpen || strip || (e.target as Element).closest('button, a, input, [role="menuitem"]')) return;
    onOpen(m);
  };
  const key = (m: Meeting, strip: boolean) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (!onOpen || strip || e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onOpen(m);
  };

  const groups: Array<{ key: string; day: Date; items: Meeting[]; title?: string }> = requests.length ? [{ key: 'requests', day: requests[0]?.start ?? now, items: [...requests], title: 'Needs your OK' }] : [];
  meetings.forEach((m) => {
    const last = groups[groups.length - 1];
    if (last && !last.title && sameDay(last.day, m.start)) last.items.push(m);
    else groups.push({ key: m.start.toDateString(), day: m.start, items: [m] });
  });

  const content = !loading && meetings.length === 0 && requests.length === 0 ? (
    <div className="tf-meetings__empty">
      <span className="tf-meetings__empty-icon"><CalendarX2 size={20} strokeWidth={1.75} aria-hidden /></span>
      <p className="tf-meetings__reveal tf-meetings__empty-title">No meetings yet</p>
      <p className="tf-meetings__reveal tf-meetings__empty-sub">When someone books a time with you, it shows up here.</p>
      {emptyAction && <span className="tf-meetings__reveal">{emptyAction}</span>}
    </div>
  ) : (
    groups.map((g) => {
      const t = g.title ? { main: g.title, chip: undefined } : dayTitle(g.day, now);
      const isToday = !g.title && sameDay(g.day, now);
      const nowAt = isToday ? g.items.findIndex((m) => m.start >= now) : -1;
      return (
        <section key={g.key} className="tf-meetings__group" aria-label={t.main}>
          <h3 className="tf-meetings__day">
            {t.chip ? <span className={cx('tf-meetings__rel', isToday && 'tf-meetings__rel--today')}>{t.chip}</span> : null}
            <span className={cx(t.chip && 'tf-meetings__date')}>{t.main}</span>
          </h3>
          <ul className="tf-meetings__rows">
            {g.items.map((m, n) => {
              const phase = strips.get(m.id);
              const strip = phase !== undefined;
              const past = m.end <= now;
              return (
                <Fragment key={m.id}>
                  {n === nowAt && (
                    <li className="tf-meetings__now" aria-label={`Now, ${clock(now, hour12)}`}>
                      <span className="tf-meetings__now-label tf-num" aria-hidden="true">{clock(now, hour12)}</span>
                      <span className="tf-meetings__now-line" aria-hidden="true" />
                    </li>
                  )}
                  <li className={cx('tf-meetings__row', strip && 'is-strip', past && 'is-past', m.status === 'cancelled' && !strip && 'is-cancelled', m.id === highlightId && 'is-new', onOpen && !strip && 'is-openable')}
                    tabIndex={onOpen && !strip ? 0 : undefined} aria-label={onOpen && !strip ? `${m.title} with ${m.invitee.name}, ${span(m.start, m.end, hour12)}` : undefined}
                    aria-haspopup={onOpen && !strip ? 'dialog' : undefined} onClick={press(m, strip)} onKeyDown={key(m, strip)}>
                    <div className="tf-meetings__main" inert={strip}>
                      <span className="tf-meetings__time tf-num">{g.title && <span className="tf-meetings__time-day">{formatDay(m.start)}</span>}{span(m.start, m.end, hour12)}</span>
                      <span className="tf-meetings__what">
                        <span className="tf-meetings__title">{m.title} <span className="tf-meetings__with">with {m.invitee.name}</span></span>
                        <span className="tf-meetings__place"><PlaceIcon place={m.place} />{m.placeLabel}{m.host !== undefined && <> · {m.host}</>}</span>
                      </span>
                      <span className="tf-meetings__status">{m.status !== 'confirmed' && m.status !== 'pending' && <MeetingStatusTag status={m.status} />}{conflictIds?.has(m.id) && <Tag size="sm" hue="orange" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>Clash</Tag>}</span>
                      <RowActions m={m} onReschedule={onReschedule} onCancel={cancel} onCopyLink={onCopyLink} onNoShow={onNoShow} onNote={onNote} onConfirm={onConfirm} onDecline={onDecline} />
                    </div>
                    <div className="tf-meetings__strip" inert={!strip} role={strip ? 'status' : undefined}>
                      {strip && (
                        <>
                          <span className="tf-meetings__strip-icon"><StatusIcon shape="failed" size={14} /></span>
                          <span className="tf-meetings__strip-text">
                            Cancelled <span aria-hidden="true">·</span> {phase === 'settled' ? 'Guest emailed' : <span className="tf-sr-only">{m.title} with {m.invitee.name}.</span>}
                          </span>
                          {phase === 'undo' && <Button size="sm" variant="ghost" onPress={() => undo(m)}>Undo</Button>}
                        </>
                      )}
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </section>
      );
    })
  );

  return (
    <div className={cx('tf-meetings', isFullWidth && 'tf-meetings--full', !loading && 'is-revealed')} aria-busy={loading}>
      {skeleton && (
        <div className="tf-meetings__skeleton" aria-hidden="true">
          <span className="tf-meetings__skel-head"><Skeleton width={140} height={12} /></span>
          {[0, 1, 2, 3].map((n) => (
            <span key={n} className="tf-meetings__skel-row">
              <Skeleton width={96} height={12} />
              <span className="tf-meetings__skel-two"><Skeleton width="70%" height={12} /><Skeleton width="45%" height={10} /></span>
              <span className="tf-meetings__skel-person"><Skeleton width={28} height={28} round /><Skeleton width="60%" height={12} /></span>
              <Skeleton width={72} height={20} />
              <span />
            </span>
          ))}
        </div>
      )}
      <div className="tf-meetings__content">{!loading && content}</div>
    </div>
  );
}

/** Props for MeetingCard. */
export interface MeetingCardProps {
  readonly meeting: Meeting;
  readonly hour12?: boolean;
  /** A coloured strip in the shell under the card: green "Today · Join meeting", orange "2 conflicted · See conflict". */
  readonly strip?: { readonly tone: 'success' | 'warning'; readonly text: string; readonly action: string; readonly onAction?: () => void };
}

/** One meeting as a shell card, with an optional status strip and its one action. */
export function MeetingCard({ meeting: m, hour12 = true, strip }: MeetingCardProps) {
  const people = [m.invitee.name, ...(m.guests ?? [])];
  return (
    <article className={cx('tf-meetcard', strip && `tf-meetcard--${strip.tone}`)} aria-label={m.title}>
      <div className="tf-meetcard__card">
        <div className="tf-meetcard__top">
          <span className="tf-meetcard__time tf-num">{formatDay(m.start)} · {span(m.start, m.end, hour12)}</span>
          {m.status !== 'confirmed' && <MeetingStatusTag status={m.status} />}
        </div>
        <p className="tf-meetcard__title">{m.title}</p>
        <p className="tf-meetcard__place"><PlaceIcon place={m.place} />{m.placeLabel}</p>
        <div className="tf-meetcard__people"><AvatarGroup names={people} size={28} max={4} /><span className="tf-meetcard__who">{people.length === 1 ? m.invitee.name : `${m.invitee.name} and ${people.length - 1} more`}</span></div>
      </div>
      {strip && (
        <div className="tf-meetcard__strip">
          <span className="tf-meetcard__strip-text">{strip.tone === 'success' ? <span className="tf-meetcard__live" aria-hidden="true" /> : <AlertTriangle {...i14} aria-hidden />}{strip.text}</span>
          <AriaButton className="tf-meetcard__strip-action" onPress={strip.onAction}>{strip.action}<ArrowRight {...i14} aria-hidden /></AriaButton>
        </div>
      )}
    </article>
  );
}
