import {
  useEffect,
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
import { focusLater } from '../../lib/focus-later.ts';
import { Popover, type PopoverPlacement } from '../../molecules/Popover/Popover.tsx';
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
   * edge for a block and a dashed one for a hold; `busy` is the member's own
   * calendar time with nobody else invited (spec 0024), shown by its time
   * alone, plain and quiet.
   */
  readonly kind: 'booking' | 'event' | 'blocked' | 'held' | 'busy';
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

/** How far a finger may move, in CSS pixels, and still be a tap rather than a scroll. */
const TAP_SLOP = 8;

/** Time the member closed, or is busy: it sits under bookings and events rather than in their lanes. */
const isClosed = (block: WeekCalendarBlock) =>
  block.kind === 'blocked' || block.kind === 'held' || block.kind === 'busy';

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
  /**
   * The week's blocks are still loading: the grid itself shows (the days, the hours, today), busy, so the week
   * arrives in place with nothing moving; a day says it is loading rather than "nothing on".
   */
  readonly isLoading?: boolean;
  /**
   * A new object puts focus on that block when it is still on the week, else on its day's column, once any closing
   * overlay has gone and only when focus fell to the page: how the screen hands focus on after a change made
   * through a dialog outside the block's card (a block removed, a booking cancelled), as the week does itself when
   * the screen closes a card whose block went.
   */
  readonly focusDay?: { readonly dayKey: string; readonly blockId?: string };
}

/**
 * Where a block's card opens: beside it while the week shows seven days, under it once its container is narrower
 * than `bp-container-md` and one day takes the width, where a card beside the block would leave the screen.
 */
function placementBeside(block: HTMLElement): PopoverPlacement {
  const week = block.closest('section');
  if (week === null) return 'end top';
  const narrow = Number.parseFloat(getComputedStyle(week).getPropertyValue('--bp-container-md'));
  return Number.isFinite(narrow) && week.clientWidth < narrow ? 'bottom start' : 'end top';
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
  isLoading = false,
  focusDay,
}: WeekCalendarProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLDivElement>());
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());
  // The open card's anchor: the block that was pressed.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  // Beside the block on a week of seven days; under it on one day, whose block takes the width.
  const [cardPlacement, setCardPlacement] = useState<PopoverPlacement>('end top');
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
  // A span drawn out of view (from the keyboard, or moved with From and To) scrolls into it, its card beside it.
  useLayoutEffect(() => {
    ghost?.scrollIntoView({ block: 'nearest' });
  }, [ghost, draft?.dayKey, draft?.startMinute, draft?.endMinute]);
  // A finger's touch until it lifts: a tap draws, a scroll doesn't.
  const tap = useRef<{ readonly dayKey: string; readonly minute: number; readonly y: number } | null>(null);
  // The open block's day, so focus has somewhere to go when the block is gone (removed from its card).
  const anchorDay = useRef(selectedDay);
  /**
   * After a card closes and its exit has played, when focus fell to the page: its block, as Escape's return does
   * (a card the screen opened again has no trigger of its own to go back to), else its day when what it was
   * anchored to is gone (a drawn span, a removed block).
   */
  const focusDayLater = (dayKey: string, from: HTMLElement | null) => {
    focusLater(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return undefined;
      return from?.isConnected === true ? from : columns.current.get(dayKey);
    });
  };
  // A card closed by the screen (a removal, Done) rather than by Escape: focus the day when its anchor is gone.
  const shownCard = useRef<{ readonly day: string; readonly from: HTMLElement | null } | null>(null);
  useEffect(() => {
    const card =
      openId !== undefined
        ? { day: anchorDay.current, from: anchor }
        : draft !== undefined
          ? { day: draft.dayKey, from: null }
          : null;
    const closed = shownCard.current;
    shownCard.current = card;
    if (card === null && closed !== null) focusDayLater(closed.day, closed.from);
  });
  // A block or day the screen asks focus for: after any closing overlay (its dialog), never taking focus the person moved.
  useEffect(() => {
    if (focusDay === undefined) return;
    focusLater(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return undefined;
      const block = focusDay.blockId === undefined ? undefined : blockRefs.current.get(focusDay.blockId);
      return block?.isConnected === true ? block : columns.current.get(focusDay.dayKey);
    });
  }, [focusDay]);

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
    <section className={styles.root} aria-label={label} aria-busy={isLoading || undefined}>
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
            const ofDay = blocks.filter((block) => block.dayKey === day.key);
            // Closed time sits under bookings and events, full width, out of their lanes (AC-705).
            const closed = ofDay.filter((block) => isClosed(block)).map((block) => ({ ...block, lane: 0, lanes: 1 }));
            const placed = placeBlocks(ofDay.filter((block) => !isClosed(block)));
            const dayBlocks = [...closed, ...placed];
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
                aria-label={isLoading ? strings.dayLoading(day.label) : strings.dayBlocks(day.label, dayBlocks.length)}
                {...(onDraw === undefined
                  ? {}
                  : { 'aria-description': strings.drawHint, 'aria-keyshortcuts': 'Enter' })}
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
                        // A finger taps (a drag would fight the scroll): it draws on lifting, unless it scrolled.
                        if (event.pointerType === 'touch') {
                          tap.current = { dayKey: day.key, minute: at, y: event.clientY };
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
                        if (tap.current !== null && Math.abs(event.clientY - tap.current.y) > TAP_SLOP)
                          tap.current = null;
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
                        const tapped = tap.current;
                        tap.current = null;
                        if (tapped?.dayKey === day.key && event.pointerType === 'touch') {
                          onDraw(defaultSpan(day.key, tapped.minute));
                          return;
                        }
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
                      // A scroll took the pointer: no tap, no span.
                      onPointerCancel: () => {
                        tap.current = null;
                        setDragging(null);
                      },
                      // The browser let go of the pointer without a pointer up (a window switch): no span half drawn.
                      onLostPointerCapture: () => {
                        if (drag.current !== null) setDragging(null);
                      },
                    })}
              >
                {/* The span drawn sits under bookings and events, so it never hides what it is drawn across. */}
                {(dragging?.dayKey === day.key ? dragging : draft?.dayKey === day.key ? draft : undefined) !==
                  undefined && (
                  <Ghost
                    span={dragging?.dayKey === day.key ? dragging : (draft ?? dragging)}
                    isDrawing={dragging?.dayKey === day.key}
                    minuteLabel={minuteLabel}
                    ref={dragging?.dayKey === day.key ? undefined : setGhost}
                  />
                )}
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
                        setCardPlacement(placementBeside(event.currentTarget));
                        anchorDay.current = block.dayKey;
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
            if (!isOpen) {
              onDraftClose?.();
              focusDayLater(draft.dayKey, null);
            }
          }}
          placement="end top"
          width="menu"
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
            if (!isOpen) {
              onClose();
              focusDayLater(anchorDay.current, anchor);
            }
          }}
          placement={cardPlacement}
          label={strings.details}
        >
          {detail}
        </Popover>
      )}
    </section>
  );
}

/** The span being drawn, or drawn: an outline, dashed while dragging, with its start, and from an hour its end, at opposite corners. */
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
      {minuteLabel !== undefined && length >= 4 * SNAP && (
        <span className={styles.ghostEnd}>{minuteLabel(span.endMinute)}</span>
      )}
    </div>
  );
}
