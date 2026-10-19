import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { ProviderMark, type ProviderName } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import type { Hue } from '../../hue.ts';
import styles from './WeekCalendar.module.css';
import { strings } from './strings.ts';

/** One day column: its key (`yyyy-MM-dd`), its header and its full name. */
export interface WeekCalendarDay {
  readonly key: string;
  /** "Mon". */
  readonly weekday: string;
  /** "19". */
  readonly dayNumber: string;
  /** "Monday, 19 October": the column's name and the header button's. */
  readonly label: string;
  readonly isToday: boolean;
  readonly isPast: boolean;
}

/** One block on the grid: a booking, one of the member's own calendar events, or time they closed. */
export interface WeekCalendarBlock {
  readonly id: string;
  readonly dayKey: string;
  /** Minutes from the day's midnight, clipped to the day. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly title: string;
  /** "9:00 – 9:30 AM". */
  readonly time: string;
  /** A third line when the block is tall enough (the page's title). */
  readonly detail?: string;
  /**
   * `booking` is accent; `event` quieter, in its calendar's hue; `blocked` and
   * `held` are time the member closed (spec 0027), hatched and quiet, a solid
   * edge for a block and a dashed one for a hold.
   */
  readonly kind: 'booking' | 'event' | 'blocked' | 'held';
  /** An event's calendar hue (each connection keeps one). */
  readonly hue?: Hue;
  readonly isCancelled?: boolean;
  /** Where the block came from, as a small mark before its title: Timefix for a booking, the calendar's brand for an event. */
  readonly provider?: ProviderName;
}

/** A span drawn on one day: minutes from its local midnight, the end exclusive (1440 is the next midnight). */
export interface WeekCalendarSpan {
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Drawing snaps to the quarter hour: the finest span anybody drags on purpose. */
const SNAP = 15;

/** Props for WeekCalendar. */
export interface WeekCalendarProps {
  /** What the grid is ("Bookings, 19 – 25 October 2026"). */
  readonly label: string;
  readonly days: readonly WeekCalendarDay[];
  readonly blocks: readonly WeekCalendarBlock[];
  /** The day shown on a narrow screen and focused by the arrow keys. */
  readonly selectedDay: string;
  readonly onSelectDay: (key: string) => void;
  /** The hour axis's labels, 0 to 23 ("9 AM"). */
  readonly hourLabel: (hour: number) => string;
  /** Today's column and the minute now, for the now line. */
  readonly now?: { readonly dayKey: string; readonly minute: number };
  /** The minute the grid opens with at its top (an hour before now, or 8 AM). */
  readonly scrollToMinute: number;
  /** The block whose card is open, and the card. */
  readonly openId?: string;
  readonly detail?: ReactNode;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
  /**
   * Drawing on empty time (spec 0027): with this set, dragging across a day
   * draws a span snapped to 15 minutes, and a click, a tap, or Enter on the
   * day draws `drawMinutes`. It answers the span drawn; the screen sets `draft`.
   */
  readonly onDraw?: (span: WeekCalendarSpan) => void;
  /** The span drawn, shown solid with `draftCard` beside it until `onDraftClose`. */
  readonly draft?: WeekCalendarSpan;
  readonly draftCard?: ReactNode;
  /** The draft card's name ("Tuesday 20 October, 10:00 to 10:30 AM"). */
  readonly draftLabel?: string;
  readonly onDraftClose?: () => void;
  /** What a click, tap or Enter draws, in minutes. Default 30. */
  readonly drawMinutes?: number;
  /** Where Enter on a day starts its span (the member's working start). Default 9:00. */
  readonly drawStartMinute?: (dayKey: string) => number;
  /** A minute of the day as a time ("10:15 AM"), for the drawn span's corners. */
  readonly minuteLabel?: (minute: number) => string;
}

/** A block with its lane: overlapping blocks share their cluster's width, side by side. */
interface Placed extends WeekCalendarBlock {
  readonly lane: number;
  readonly lanes: number;
}

/**
 * Lanes for one day's blocks: sorted by start then end, clustered while they
 * overlap, each taking the first lane free at its start; every block in a
 * cluster divides the width by the cluster's lane count.
 */
export function placeBlocks(blocks: readonly WeekCalendarBlock[]): readonly Placed[] {
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const placed: Placed[] = [];
  let cluster: { block: WeekCalendarBlock; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const each of cluster) placed.push({ ...each.block, lane: each.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };
  for (const block of sorted) {
    if (cluster.length > 0 && block.startMinute >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinute);
    } else laneEnds[lane] = block.endMinute;
    cluster.push({ block, lane });
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  close();
  return placed;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * A week of days as columns of hours (the Bookings page's calendar, spec
 * 0025): bookings and the member's other calendar events as blocks placed by
 * time, overlapping ones side by side, a now line in today's column, and a
 * card anchored to the open block. Today's column is tinted all the way
 * down, and its date is solid accent. It opens with `scrollToMinute` at its top. On
 * a narrow container the header stays a row of seven days and the grid shows
 * the selected day alone. One day column is in the tab order: Left and Right
 * move between days, Up and Down between a day's blocks, Enter opens one,
 * Escape closes its card.
 */
export function WeekCalendar({
  label,
  days,
  blocks,
  selectedDay,
  onSelectDay,
  hourLabel,
  now,
  scrollToMinute,
  openId,
  detail,
  onOpen,
  onClose,
  onDraw,
  draft,
  draftCard,
  draftLabel,
  onDraftClose,
  drawMinutes = 30,
  drawStartMinute,
  minuteLabel,
}: WeekCalendarProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLDivElement>());
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());
  // The open card's anchor: the block that was pressed.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  // The span being dragged, before it is drawn; and the drawn span's ghost, the draft card's anchor.
  // The drag lives in a ref as well: pointer events can come faster than renders, and each must see the last.
  const [dragging, setDraggingState] = useState<(WeekCalendarSpan & { readonly from: number }) | null>(null);
  const drag = useRef<(WeekCalendarSpan & { readonly from: number }) | null>(null);
  const setDragging = (next: (WeekCalendarSpan & { readonly from: number }) | null) => {
    drag.current = next;
    setDraggingState(next);
  };
  const [ghost, setGhost] = useState<HTMLDivElement | null>(null);
  const ghostRef = useMemo(() => ({ current: ghost }), [ghost]);

  /** The minute under the pointer in `column`, snapped and clamped to the day. */
  const minuteAt = (column: HTMLElement, clientY: number): number => {
    const box = column.getBoundingClientRect();
    const raw = ((clientY - box.top) / box.height) * 1440;
    return Math.min(1440, Math.max(0, Math.round(raw / SNAP) * SNAP));
  };
  /** A span of the default length from `start`, kept inside the day. */
  const defaultSpan = (dayKey: string, start: number): WeekCalendarSpan => {
    const startMinute = Math.min(start, 1440 - SNAP);
    return { dayKey, startMinute, endMinute: Math.min(startMinute + drawMinutes, 1440) };
  };

  // Opens with the minute asked for at its top, once laid out (it tries again next frame when not yet).
  useLayoutEffect(() => {
    let frame = 0;
    const place = (tries: number) => {
      const box = scroller.current;
      if (box === null) return;
      const hour = box.scrollHeight / 24;
      if (box.scrollHeight <= box.clientHeight && tries < 2) {
        frame = requestAnimationFrame(() => place(tries + 1));
        return;
      }
      // A quarter hour above the minute, so its hour's label shows whole.
      const top = (scrollToMinute / 60) * hour - hour / 4;
      box.scrollTop = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight));
    };
    place(0);
    return () => cancelAnimationFrame(frame);
  }, [scrollToMinute]);

  const index = Math.max(
    0,
    days.findIndex((day) => day.key === selectedDay),
  );
  const moveDay = (delta: number) => {
    const next = days[index + delta];
    if (next === undefined) return;
    onSelectDay(next.key);
    requestAnimationFrame(() => columns.current.get(next.key)?.focus());
  };
  const onColumnKey = (event: KeyboardEvent<HTMLDivElement>, day: WeekCalendarDay, dayBlocks: readonly Placed[]) => {
    if (onDraw !== undefined && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onDraw(defaultSpan(day.key, drawStartMinute?.(day.key) ?? 9 * 60));
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveDay(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const order = [...dayBlocks].sort((a, b) => a.startMinute - b.startMinute);
    const at = order.findIndex((block) => blockRefs.current.get(block.id) === document.activeElement);
    const next =
      order[at === -1 ? (event.key === 'ArrowDown' ? 0 : order.length - 1) : at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next !== undefined) blockRefs.current.get(next.id)?.focus();
    else if (day.key !== selectedDay) onSelectDay(day.key);
  };

  return (
    <section className={styles.root} aria-label={label}>
      <div className={styles.head}>
        <span className={styles.corner} aria-hidden="true" />
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            className={styles.dayButton}
            data-today={day.isToday || undefined}
            data-past={day.isPast || undefined}
            aria-pressed={day.key === selectedDay}
            aria-label={day.isToday ? strings.today(day.label) : day.label}
            onClick={() => onSelectDay(day.key)}
          >
            <span className={styles.dayNumber}>{day.dayNumber}</span>
            <span className={styles.weekday}>{day.weekday}</span>
          </button>
        ))}
      </div>
      <div ref={scroller} className={styles.scroller}>
        <div className={styles.body}>
          <div className={styles.axis} aria-hidden="true">
            {HOURS.map((hour) => (
              <span key={hour} className={styles.hour}>
                {hour === 0 ? '' : hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const dayBlocks = placeBlocks(blocks.filter((block) => block.dayKey === day.key));
            return (
              // A composite: the day takes focus, and the arrow keys move between days and their blocks.
              // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
              <div
                key={day.key}
                ref={(element) => {
                  if (element === null) columns.current.delete(day.key);
                  else columns.current.set(day.key, element);
                }}
                role="group"
                aria-label={strings.dayBlocks(day.label, dayBlocks.length)}
                tabIndex={day.key === selectedDay ? 0 : -1}
                className={styles.column}
                data-selected={day.key === selectedDay || undefined}
                data-today={day.isToday || undefined}
                data-past={day.isPast || undefined}
                data-drawable={onDraw === undefined ? undefined : true}
                onKeyDown={(event) => onColumnKey(event, day, dayBlocks)}
                {...(onDraw === undefined
                  ? {}
                  : {
                      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
                        // Only the primary button, and never on a block: blocks keep their own presses.
                        if (event.button !== 0 || event.target !== event.currentTarget) return;
                        const at = minuteAt(event.currentTarget, event.clientY);
                        // A finger taps (a drag would fight the scroll); a mouse or pen drags.
                        if (event.pointerType === 'touch') {
                          onDraw(defaultSpan(day.key, at));
                          return;
                        }
                        // Keeps the drag when the pointer leaves the column; a pointer the browser no longer tracks can't be held.
                        if (event.currentTarget.isConnected) {
                          try {
                            event.currentTarget.setPointerCapture(event.pointerId);
                          } catch {
                            // Nothing to hold: the drag still ends on this column's pointer up.
                          }
                        }
                        setDragging({ dayKey: day.key, from: at, startMinute: at, endMinute: at });
                      },
                      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
                        const current = drag.current;
                        if (current?.dayKey !== day.key) return;
                        const at = minuteAt(event.currentTarget, event.clientY);
                        setDragging({
                          ...current,
                          startMinute: Math.min(current.from, at),
                          endMinute: Math.max(current.from, at),
                        });
                      },
                      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
                        const current = drag.current;
                        if (current?.dayKey !== day.key) return;
                        const at = minuteAt(event.currentTarget, event.clientY);
                        const startMinute = Math.min(current.from, at);
                        const endMinute = Math.max(current.from, at);
                        setDragging(null);
                        // A click is not an empty span: it means "here", so it draws the default length.
                        onDraw(
                          endMinute - startMinute < SNAP
                            ? defaultSpan(day.key, current.from)
                            : { dayKey: day.key, startMinute, endMinute },
                        );
                      },
                      onPointerCancel: () => setDragging(null),
                      // The browser let go of the pointer without a pointer up (a window switch): no span half drawn.
                      onLostPointerCapture: () => {
                        if (drag.current !== null) setDragging(null);
                      },
                    })}
              >
                {dayBlocks.map((block) => {
                  const length = block.endMinute - block.startMinute;
                  return (
                    <button
                      key={block.id}
                      ref={(element) => {
                        if (element === null) blockRefs.current.delete(block.id);
                        else blockRefs.current.set(block.id, element);
                      }}
                      type="button"
                      tabIndex={-1}
                      className={styles.block}
                      data-kind={block.kind}
                      data-hue={block.hue}
                      data-cancelled={block.isCancelled || undefined}
                      data-open={block.id === openId || undefined}
                      data-size={length < 45 ? 'compact' : length < 75 ? 'short' : 'tall'}
                      aria-haspopup="dialog"
                      aria-expanded={block.id === openId}
                      aria-label={strings.blockName(block.title, block.time)}
                      style={{
                        '--start': String(block.startMinute),
                        '--length': String(Math.max(length, 15)),
                        '--lane': String(block.lane),
                        '--lanes': String(block.lanes),
                      }}
                      onClick={(event) => {
                        if (block.id === openId) {
                          onClose();
                          return;
                        }
                        setAnchor(event.currentTarget);
                        onOpen(block.id);
                      }}
                    >
                      <span className={styles.blockHead}>
                        {block.provider !== undefined && <ProviderMark provider={block.provider} size="sm" />}
                        <span className={styles.blockTitle}>{block.title}</span>
                      </span>
                      <span className={styles.blockTime}>{block.time}</span>
                      {block.detail !== undefined && <span className={styles.blockDetail}>{block.detail}</span>}
                    </button>
                  );
                })}
                {(dragging?.dayKey === day.key ? dragging : draft?.dayKey === day.key ? draft : undefined) !==
                  undefined && (
                  <Ghost
                    span={dragging?.dayKey === day.key ? dragging : (draft ?? dragging)}
                    isDrawing={dragging?.dayKey === day.key}
                    minuteLabel={minuteLabel}
                    ref={dragging?.dayKey === day.key ? undefined : setGhost}
                  />
                )}
                {now?.dayKey === day.key && (
                  <span className={styles.now} style={{ '--start': String(now.minute) }} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {draft !== undefined && dragging === null && draftCard !== undefined && ghost !== null && (
        <Popover
          triggerRef={ghostRef}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) onDraftClose?.();
          }}
          placement="end top"
          label={draftLabel ?? strings.details}
        >
          {draftCard}
        </Popover>
      )}
      {openId !== undefined && detail !== undefined && anchor !== null && (
        <Popover
          triggerRef={anchorRef}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) onClose();
          }}
          placement="end top"
          label={strings.details}
        >
          {detail}
        </Popover>
      )}
    </section>
  );
}

/** The span being drawn, or drawn: an outline, dashed while dragging, with its start and end at opposite corners. */
function Ghost({
  span,
  isDrawing,
  minuteLabel,
  ref,
}: {
  readonly span: WeekCalendarSpan | null;
  readonly isDrawing: boolean;
  readonly minuteLabel: ((minute: number) => string) | undefined;
  readonly ref: Ref<HTMLDivElement> | undefined;
}) {
  if (span === null) return null;
  const length = span.endMinute - span.startMinute;
  return (
    <div
      ref={ref}
      className={styles.ghost}
      data-drawing={isDrawing || undefined}
      aria-hidden="true"
      style={{ '--start': String(span.startMinute), '--length': String(Math.max(length, 4)) }}
    >
      {minuteLabel !== undefined && length >= SNAP && (
        <span className={styles.ghostStart}>{minuteLabel(span.startMinute)}</span>
      )}
      {minuteLabel !== undefined && length >= 2 * SNAP && (
        <span className={styles.ghostEnd}>{minuteLabel(span.endMinute)}</span>
      )}
    </div>
  );
}
