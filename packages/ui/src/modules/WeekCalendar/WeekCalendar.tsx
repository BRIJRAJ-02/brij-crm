import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { ProviderMark, type ProviderName } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { Popover, type PopoverPlacement } from '../../molecules/Popover/Popover.tsx';
import type { Hue } from '../../hue.ts';
import { liftClosed, placeBlocks, type More, type Placed as PlacedSlot, type Slot } from './placeBlocks.ts';
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
  /**
   * The `team` view's head for this column in place of the weekday and date (TeamDay's person: their picture, name
   * and status). Drawn as it is given; the column keeps `label` as its name.
   */
  readonly head?: ReactNode;
  /**
   * A stretch drawn across the column under everything on it, with its word at its top (TeamDay's Away band for time
   * off). Decoration: the column's `label` says it in words.
   */
  readonly band?: { readonly label: string; readonly startMinute: number; readonly endMinute: number };
  /**
   * False keeps this column from drawing (a colleague the reader may only See on TeamDay): no crosshair, no span, no
   * Enter to draw, so the cue matches what it does. Absent, it draws whenever `onDraw` is given.
   */
  readonly canDraw?: boolean;
}

/** One block on the grid: a booking, one of the member's own calendar events, or time they closed. */
export interface WeekCalendarBlock {
  readonly id: string;
  readonly dayKey: string;
  /** Minutes from the day's midnight, clipped to the day. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly title: string;
  /** "9:00 – 9:30 AM". A block of half an hour or less shows its start alone (`minuteLabel`), but reads this. */
  readonly time: string;
  /** A third line when the block is tall enough (who it is with); read out in the block's name at any size. */
  readonly detail?: string;
  /**
   * `booking` is a soft fill in its `hue` (its booking link's colour) with a bar of it at the start, accent when it
   * has none; `event` quieter, neutral with a thin edge in its calendar's hue and its calendar's mark; `blocked` and
   * `held` are time the member closed (spec 0027), hatched and quiet, a solid
   * edge for a block and a dashed one for a hold; `busy` is the member's own
   * calendar time with nobody else invited (spec 0024), shown by its time
   * alone, plain and quiet.
   */
  readonly kind: 'booking' | 'event' | 'blocked' | 'held' | 'busy';
  /** A booking's link colour, or an event's calendar colour (each connection keeps one). */
  readonly hue?: Hue;
  /** Drawn struck through and quieter, and read out as cancelled. */
  readonly isCancelled?: boolean;
  /**
   * A short word for a state other than the usual one ("No show", "Needs a host"), shown before the time and read
   * in the block's name. Confirmed bookings carry none, so status shows only when it is news.
   */
  readonly status?: string;
  /** Where the block came from, as a small mark before its title: Timefix for a booking, the calendar's brand for an event. */
  readonly provider?: ProviderName;
}

/** A stretch of a day, in minutes from its midnight, the end exclusive. */
export interface WeekCalendarRange {
  readonly startMinute: number;
  readonly endMinute: number;
}

/** A span drawn on one day: minutes from its local midnight, the end exclusive (1440 is the next midnight). */
export interface WeekCalendarSpan {
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** Drawing snaps to the quarter hour: the finest span anybody drags on purpose. */
const SNAP = 15;

/**
 * How a block or span of `length` minutes lays out its words: under half an hour (a quarter hour, an
 * --hour/4 box shorter than a label's line) one line, centred and clipped; under 45 minutes the title over
 * its start, set flush; under 75 the title over the time; longer, the detail too.
 */
function sizeOf(length: number): 'tiny' | 'pair' | 'short' | 'tall' {
  if (length < 2 * SNAP) return 'tiny';
  if (length < 3 * SNAP) return 'pair';
  return length < 5 * SNAP ? 'short' : 'tall';
}

/** How far a finger may move, in CSS pixels, and still be a tap rather than a scroll. */
const TAP_SLOP = 8;

/** Time the member closed, or is busy: it sits under bookings and events rather than in their lanes, unless one would hide it. */
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
  /**
   * The zone the hours are in, over the hour axis: `short` shows ("GMT+5:30"), `name` is read out and shows on
   * hover ("Times in Kolkata time (GMT+5:30)"). Absent leaves the corner empty.
   */
  readonly zone?: { readonly short: string; readonly name: string };
  /** Today's column and the minute now, for the now line. */
  readonly now?: {
    readonly dayKey: string;
    readonly minute: number;
    /** The time now as the axis shows it, short enough for it ("10:15"); else `minuteLabel`'s. */
    readonly label?: string;
  };
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
  /** A minute of the day as a time ("10:15 AM"), for the drawn span's corners, a "+N" chip, and the start a block of half an hour or less shows. */
  readonly minuteLabel?: (minute: number) => string;
  /**
   * The week's blocks are still loading: the grid itself shows (the days, the hours, today), busy, so the week
   * arrives in place with nothing moving; a day says it is loading rather than "nothing on".
   */
  readonly isLoading?: boolean;
  /**
   * Fills the height its parent gives it, the hours scrolling inside (Bookings › Calendar, the owner, 22 October
   * 2026). Without it the hours show twelve at a time, for a grid that sits among other content.
   */
  readonly isFill?: boolean;
  /**
   * A new object puts focus on that block when it is still on the week, else on its day's column, once any closing
   * overlay has gone and only when focus fell to the page: how the screen hands focus on after a change made
   * through a dialog outside the block's card (a block removed, a booking cancelled), as the week does itself when
   * the screen closes a card whose block went.
   */
  readonly focusDay?: { readonly dayKey: string; readonly blockId?: string };
  /**
   * The member's open hours on a day (their availability). The hours outside them are shaded a step darker, as
   * Google Calendar shades outside working hours. Answering undefined shades nothing that day; an empty list shades
   * the whole day (a day off).
   */
  readonly openHours?: (dayKey: string) => readonly WeekCalendarRange[] | undefined;
  /** A quiet line in the middle of the grid when the week has nothing on it ("No meetings this week"). */
  readonly emptyHint?: string;
  /**
   * A way on from an empty week, under `emptyHint`, as Attio's "Next day with meetings": "Next booking: Tue 3 Nov",
   * which jumps to it. The button goes with the week it leaves, so focus moves to the new chosen day.
   */
  readonly emptyAction?: { readonly label: string; readonly onPress: () => void };
  /**
   * `week` (the default) draws the seven days; `day` draws only the selected one across the width, its head still
   * the week's days to pick from, as a phone's narrow week does. In `day`, `emptyHint` shows while that day is empty.
   * `team` (TeamDay) draws any number of columns (each a person, its `head` drawn in place of a date), at least
   * `size-column-narrow` plus `space-32` and `space-8` wide each, scrolling sideways under a head and an hour axis that stay put;
   * the now line shows in every column, and below 480px one column shows at a time, with Previous and Next.
   */
  readonly view?: 'week' | 'day' | 'team';
}

/** The parts of a day outside its open hours, in order. */
function closedRanges(open: readonly WeekCalendarRange[]): readonly WeekCalendarRange[] {
  const sorted = [...open].sort((a, b) => a.startMinute - b.startMinute);
  const closed: WeekCalendarRange[] = [];
  let at = 0;
  for (const range of sorted) {
    if (range.startMinute > at) closed.push({ startMinute: at, endMinute: range.startMinute });
    at = Math.max(at, range.endMinute);
  }
  if (at < 1440) closed.push({ startMinute: at, endMinute: 1440 });
  return closed;
}

/**
 * Marks a day focused after a pointer's span closed, so it shows no ring (`data-quiet-focus`) until the next key
 * or press anywhere, or until it loses focus: the next Tab onto it rings it as usual. The listeners wait a tick,
 * so the Escape that closed the card doesn't count.
 */
function quietFocus(column: HTMLElement) {
  if (column.dataset.quietFocus !== undefined) return;
  column.dataset.quietFocus = '';
  const clear = () => {
    delete column.dataset.quietFocus;
    document.removeEventListener('keydown', clear, true);
    document.removeEventListener('pointerdown', clear, true);
    column.removeEventListener('blur', clear);
  };
  setTimeout(() => {
    if (column.dataset.quietFocus === undefined) return;
    document.addEventListener('keydown', clear, true);
    document.addEventListener('pointerdown', clear, true);
    column.addEventListener('blur', clear);
  }, 0);
}

/** Whether the week holding `element` is narrower than `bp-container-md`, so one day takes the width (a phone). */
function isNarrowWeek(element: HTMLElement): boolean {
  const week = element.closest('section');
  if (week === null) return false;
  const narrow = Number.parseFloat(getComputedStyle(week).getPropertyValue('--bp-container-md'));
  return Number.isFinite(narrow) && week.clientWidth < narrow;
}

/**
 * Where a block's card opens: beside it while the week shows seven days, under it once its container is narrower
 * than `bp-container-md` and one day takes the width (where the screen draws it as a sheet instead).
 */
function placementBeside(block: HTMLElement): PopoverPlacement {
  return isNarrowWeek(block) ? 'bottom start' : 'end top';
}

/** A block with its slot: overlapping blocks side by side, or a later start indented over an earlier one. */
type Placed = PlacedSlot<WeekCalendarBlock>;

/** The fewest minutes a block is drawn as: one line (`size-chip`, 20px) of an hour (`size-toolbar` plus `space-16`, 64px), rounded up. */
const DRAWN_MINUTES = 19;

/** Closed time's slot: the whole column, under bookings and events. */
const WHOLE: Slot = { left: 0, width: 1, indent: 0, lane: 0, lanes: 1, span: 1 };

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
  zone,
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
  isFill = false,
  focusDay,
  openHours,
  emptyHint,
  emptyAction,
  view = 'week',
}: WeekCalendarProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const isTeam = view === 'team';
  const columns = useRef(new Map<string, HTMLDivElement>());
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());
  // The open card's anchor: the block that was pressed.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  // Beside the block on a week of seven days; under it on one day, whose block takes the width.
  const [cardPlacement, setCardPlacement] = useState<PopoverPlacement>('end top');
  // Decided as a card opens (a phone's sheet or a popover), so a resize while it is open never remounts it.
  const [isCardSheet, setCardSheet] = useState(false);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  // The span being dragged, before it is drawn; and the drawn span's ghost, the draft card's anchor.
  // The drag lives in a ref as well: pointer events can come faster than renders, and each must see the last.
  const [dragging, setDraggingState] = useState<(WeekCalendarSpan & { readonly from: number }) | null>(null);
  const drag = useRef<(WeekCalendarSpan & { readonly from: number }) | null>(null);
  const setDragging = (next: (WeekCalendarSpan & { readonly from: number }) | null) => {
    drag.current = next;
    setDraggingState(next);
  };
  // The "+N" list that is open: the items folded there, and its chip, which the list and then an item's card anchor to.
  const [moreList, setMoreList] = useState<{
    readonly id: string;
    readonly dayKey: string;
    readonly hidden: readonly { readonly id: string; readonly title: string; readonly time?: string }[];
    readonly anchor: HTMLButtonElement;
  } | null>(null);
  const moreRef = useMemo(() => ({ current: moreList?.anchor ?? null }), [moreList]);
  const [ghost, setGhost] = useState<HTMLDivElement | null>(null);
  const ghostRef = useMemo(() => ({ current: ghost }), [ghost]);
  // A span drawn out of view (from the keyboard, or moved with From and To) scrolls into it, its card beside it.
  useLayoutEffect(() => {
    ghost?.scrollIntoView({ block: 'nearest' });
  }, [ghost, draft?.dayKey, draft?.startMinute, draft?.endMinute]);
  // A finger's touch until it lifts: a tap draws, a scroll doesn't.
  const tap = useRef<{ readonly dayKey: string; readonly minute: number; readonly y: number } | null>(null);
  // How the open span was drawn: a pointer's hands focus back to its day without a ring.
  const drawnBy = useRef<'pointer' | 'keyboard'>('keyboard');
  // The open block's day, so focus has somewhere to go when the block is gone (removed from its card).
  const anchorDay = useRef(selectedDay);
  /**
   * After a card closes and its exit has played, when focus fell to the page: its block, as Escape's return does
   * (a card the screen opened again has no trigger of its own to go back to), else its day when what it was
   * anchored to is gone (a drawn span, a removed block).
   */
  const focusDayLater = (dayKey: string, from: HTMLElement | null) => {
    // A span drawn with the pointer hands its day focus back without the column's ring: the ring is for a
    // keyboard on the grid, and around a whole day it read as a stray highlight once Escape closed the card. The
    // ring comes back with the next key on the day.
    const isQuiet = from === null && drawnBy.current === 'pointer';
    focusLater(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return undefined;
      if (from?.isConnected === true) return from;
      const column = columns.current.get(dayKey);
      if (column !== undefined && isQuiet) quietFocus(column);
      return column;
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
    if (card === null && closed !== null) {
      // A drawn span's dialog (New meeting) closing hands focus back to the day too: quiet after a pointer.
      const column = columns.current.get(closed.day);
      if (closed.from === null && column !== undefined && drawnBy.current === 'pointer') quietFocus(column);
      focusDayLater(closed.day, closed.from);
    }
  });
  // Pressed "Next booking": its button leaves with the empty week, so once the new week (or day) is in, focus goes
  // to its chosen day rather than falling to the page.
  const jumped = useRef(false);
  const firstDayKey = days[0]?.key;
  useEffect(() => {
    if (!jumped.current) return;
    jumped.current = false;
    focusLater(() => columns.current.get(selectedDay));
  }, [firstDayKey, selectedDay]);
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
      // The body's own height: in the team view the head scrolls inside too, over it.
      const hour = (bodyRef.current?.offsetHeight ?? box.scrollHeight) / 24;
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

  /** Left and Right: the day before or after `from` (the one the key was pressed on), selected and focused. */
  const moveDay = (from: string, delta: number) => {
    const next = days[days.findIndex((day) => day.key === from) + delta];
    if (next === undefined) return;
    onSelectDay(next.key);
    requestAnimationFrame(() => columns.current.get(next.key)?.focus());
  };
  const onColumnKey = (
    event: KeyboardEvent<HTMLElement>,
    day: WeekCalendarDay,
    /** What Up and Down walk, in order: the day's blocks and "+N" chips by start. */
    order: readonly string[],
  ) => {
    if (
      onDraw !== undefined &&
      day.canDraw !== false &&
      event.target === event.currentTarget &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      drawnBy.current = 'keyboard';
      onDraw(defaultSpan(day.key, drawStartMinute?.(day.key) ?? 9 * 60));
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveDay(day.key, event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = order.findIndex((id) => blockRefs.current.get(id) === document.activeElement);
    const next =
      order[at === -1 ? (event.key === 'ArrowDown' ? 0 : order.length - 1) : at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next !== undefined) blockRefs.current.get(next)?.focus();
    else if (day.key !== selectedDay) onSelectDay(day.key);
  };

  const zoneId = useId();
  /** A day's timed blocks as laid out: closed time full width under the rest, then bookings and events in lanes. */
  const layoutOf = (dayKey: string) => {
    const ofDay = blocks.filter((block) => block.dayKey === dayKey);
    // Laid out as tall as they are drawn: a short block is never under one line (`size-chip`), so two back to back
    // quarter hours overlap on screen and must share the width or cascade, not paint over each other.
    const drawn = (block: WeekCalendarBlock) => ({
      ...block,
      endMinute: Math.max(block.endMinute, block.startMinute + DRAWN_MINUTES),
    });
    // Closed time sits under bookings and events, full width, out of their lanes (AC-705), later over earlier;
    // where a block would cover its title (a booking at the same time as Busy, even a cancelled one) it takes a
    // lane beside it instead, so it never hides.
    const lifted = liftClosed(
      ofDay.filter((block) => isClosed(block)).map(drawn),
      ofDay.filter((block) => !isClosed(block)).map(drawn),
    );
    const closed: Placed[] = ofDay
      .filter((block) => isClosed(block) && !lifted.has(block.id))
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((block) => ({ ...block, ...WHOLE }));
    const timed = ofDay.filter((block) => !isClosed(block) || lifted.has(block.id));
    const ends = new Map(timed.map((block) => [block.id, block.endMinute]));
    const layout = placeBlocks(timed.map(drawn));
    const placed = layout.blocks.map((block) => ({ ...block, endMinute: ends.get(block.id) ?? block.endMinute }));
    const dayBlocks = [...closed, ...placed];
    // Up and Down walk what shows, "+N" chips among the blocks, by start.
    const stops = [...dayBlocks, ...layout.more].sort(
      (a, b) => a.startMinute - b.startMinute || a.indent - b.indent || a.lane - b.lane,
    );
    return { ofDay, dayBlocks, more: layout.more, stops };
  };
  /** What Up and Down walk on a day: its blocks and "+N" chips by start, as they read down the screen. */
  const orderOf = (dayKey: string): readonly string[] => layoutOf(dayKey).stops.map((stop) => stop.id);

  const at = days.findIndex((day) => day.key === selectedDay);
  /** The heads over the columns, the zone in the corner: above the hours, or (team) inside them, pinned to the top. */
  const headRow = (
    <div className={styles.head}>
      {isTeam && (
        // One person at a time on a phone: Previous and Next walk the columns (the arrow keys do too).
        <span className={styles.stepper}>
          <Button
            variant="ghost"
            size="sm"
            icon="chevron-left"
            label={strings.previousColumn}
            isDisabled={at <= 0}
            onPress={() => moveDay(selectedDay, -1)}
          />
          <Button
            variant="ghost"
            size="sm"
            icon="chevron-right"
            label={strings.nextColumn}
            isDisabled={at < 0 || at >= days.length - 1}
            onPress={() => moveDay(selectedDay, 1)}
          />
        </span>
      )}
      {zone === undefined ? (
        <span className={styles.corner} aria-hidden="true" />
      ) : (
        <span className={styles.corner}>
          <span className={styles.zone} aria-hidden="true" title={zone.name}>
            {/* "GMT+5:30" is wider than the axis: it may break before its sign, "GMT" over "+5:30". */}
            {zone.short.split(/(?=[+\-\u2212])/).map((part, index) => (
              <Fragment key={part}>
                {index > 0 && <wbr />}
                {part}
              </Fragment>
            ))}
          </span>
          <VisuallyHidden id={zoneId}>{zone.name}</VisuallyHidden>
        </span>
      )}
      {isTeam
        ? days.map((day) => (
            <div key={day.key} className={styles.personHead} data-selected={day.key === selectedDay || undefined}>
              {day.head ?? day.label}
            </div>
          ))
        : days.map((day) => (
            <button
              key={day.key}
              type="button"
              className={styles.dayButton}
              data-today={day.isToday || undefined}
              data-past={day.isPast || undefined}
              data-busy={blocks.some((block) => block.dayKey === day.key) || undefined}
              aria-pressed={day.key === selectedDay}
              aria-label={day.isToday ? strings.today(day.label) : day.label}
              onClick={() => onSelectDay(day.key)}
            >
              <span className={styles.weekday}>{day.weekday}</span>
              <span className={styles.dayNumber}>{day.dayNumber}</span>
            </button>
          ))}
    </div>
  );
  return (
    <section
      className={styles.root}
      aria-label={label}
      // The zone is read as focus enters the week, not only in reading order: blocks name times without it.
      {...(zone === undefined ? {} : { 'aria-describedby': zoneId })}
      aria-busy={isLoading || undefined}
      data-fill={isFill || undefined}
      data-view={view}
      {...(isTeam ? { style: { '--columns': String(Math.max(days.length, 1)) } } : {})}
    >
      {!isTeam && headRow}
      <div ref={scroller} className={styles.scroller}>
        {isTeam && headRow}
        <div ref={bodyRef} className={styles.body}>
          <div className={styles.axis} aria-hidden="true">
            {HOURS.map((hour) => (
              <span key={hour} className={styles.hour}>
                {hour === 0 ? '' : hourLabel(hour)}
              </span>
            ))}
            {/* The time now on the axis, level with the now line, while today is on the week. */}
            {now !== undefined &&
              (now.label !== undefined || minuteLabel !== undefined) &&
              (isTeam || days.some((day) => day.key === now.dayKey)) && (
                <span
                  className={styles.nowLabel}
                  // One day across (a phone), it shows only on today, where its line is; every column is today in
                  // the team view.
                  data-on-day={isTeam || now.dayKey === selectedDay || undefined}
                  style={{ '--start': String(now.minute) }}
                >
                  {now.label ?? minuteLabel?.(now.minute)}
                </span>
              )}
          </div>
          {days.map((day) => {
            const { ofDay, dayBlocks, more: dayMore } = layoutOf(day.key);
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
                aria-label={isLoading ? strings.dayLoading(day.label) : strings.dayBlocks(day.label, ofDay.length)}
                {...(onDraw === undefined || day.canDraw === false
                  ? {}
                  : { 'aria-description': strings.drawHint, 'aria-keyshortcuts': 'Enter' })}
                tabIndex={day.key === selectedDay ? 0 : -1}
                className={styles.column}
                data-selected={day.key === selectedDay || undefined}
                data-today={day.isToday || undefined}
                data-past={day.isPast || undefined}
                data-drawable={onDraw === undefined || day.canDraw === false ? undefined : true}
                onKeyDown={(event) => onColumnKey(event, day, orderOf(day.key))}
                {...(onDraw === undefined || day.canDraw === false
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
                          drawnBy.current = 'pointer';
                          onDraw(defaultSpan(day.key, tapped.minute));
                          return;
                        }
                        const current = drag.current;
                        if (current?.dayKey !== day.key) return;
                        const at = minuteAt(event.currentTarget, event.clientY);
                        const startMinute = Math.min(current.from, at);
                        const endMinute = Math.max(current.from, at);
                        setDragging(null);
                        drawnBy.current = 'pointer';
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
                {/* Outside the member's hours: a step darker, under everything else. */}
                {(() => {
                  const open = openHours?.(day.key);
                  return open === undefined
                    ? null
                    : closedRanges(open).map((range) => (
                        <span
                          key={range.startMinute}
                          className={styles.offHours}
                          data-off-hours=""
                          aria-hidden="true"
                          style={{
                            '--start': String(range.startMinute),
                            '--length': String(range.endMinute - range.startMinute),
                          }}
                        />
                      ));
                })()}
                {/* A band across the column (time off), under everything drawn on it; the column's name says it. */}
                {day.band !== undefined && (
                  <span
                    className={styles.band}
                    aria-hidden="true"
                    style={{
                      '--start': String(day.band.startMinute),
                      '--length': String(Math.max(day.band.endMinute - day.band.startMinute, 15)),
                    }}
                  >
                    <span className={styles.bandLabel}>{day.band.label}</span>
                  </span>
                )}
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
                  const size = sizeOf(length);
                  // Half an hour or less shows the start alone, as Google Calendar and Klaviyo write it, so
                  // the title keeps its room; "10:00 AM – 10:30 AM" was cut to "10:00 A…".
                  const shownTime =
                    (size === 'tiny' || size === 'pair') && minuteLabel !== undefined
                      ? minuteLabel(block.startMinute)
                      : block.time;
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
                      data-nested={block.indent > 0 || undefined}
                      data-narrow={(block.span / block.lanes) * block.width < 0.5 || undefined}
                      data-open={block.id === openId || undefined}
                      data-size={size}
                      aria-haspopup="dialog"
                      aria-expanded={block.id === openId}
                      aria-label={strings.blockName(
                        block.title,
                        block.time,
                        block.detail,
                        block.isCancelled,
                        block.status,
                      )}
                      style={{
                        '--start': String(block.startMinute),
                        '--length': String(Math.max(block.endMinute - block.startMinute, 15)),
                        '--left': String(block.left),
                        '--width': String(block.width),
                        '--indent': String(block.indent),
                        '--lane': String(block.lane),
                        '--lanes': String(block.lanes),
                        '--span': String(block.span),
                      }}
                      onClick={(event) => {
                        if (block.id === openId) {
                          onClose();
                          return;
                        }
                        setAnchor(event.currentTarget);
                        setCardPlacement(placementBeside(event.currentTarget));
                        setCardSheet(isNarrowWeek(event.currentTarget));
                        anchorDay.current = block.dayKey;
                        onOpen(block.id);
                      }}
                    >
                      <span className={styles.blockHead}>
                        {block.provider !== undefined && (
                          <span className={styles.blockMark}>
                            <ProviderMark provider={block.provider} size="sm" />
                          </span>
                        )}
                        <span className={styles.blockTitle}>{block.title}</span>
                      </span>
                      <span className={styles.blockTime}>
                        {block.status !== undefined && <span className={styles.blockStatus}>{block.status}</span>}
                        {shownTime}
                      </span>
                      {block.detail !== undefined && <span className={styles.blockDetail}>{block.detail}</span>}
                    </button>
                  );
                })}
                {dayMore.map((more) => (
                  <MoreChip
                    key={more.id}
                    more={more}
                    isOpen={more.id === moreList?.id || more.hidden.some((block) => block.id === openId)}
                    at={minuteLabel?.(more.startMinute) ?? more.hidden[0]?.time ?? ''}
                    ref={(element) => {
                      if (element === null) blockRefs.current.delete(more.id);
                      else blockRefs.current.set(more.id, element);
                    }}
                    onPress={(element) =>
                      setMoreList(
                        more.id === moreList?.id
                          ? null
                          : {
                              id: more.id,
                              dayKey: day.key,
                              hidden: more.hidden,
                              anchor: element,
                            },
                      )
                    }
                  />
                ))}
                {now !== undefined && (isTeam || now.dayKey === day.key) && (
                  <span className={styles.now} style={{ '--start': String(now.minute) }} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {emptyHint !== undefined &&
        !isLoading &&
        !blocks.some((block) => view !== 'day' || block.dayKey === selectedDay) && (
          <div className={styles.empty} data-action={emptyAction === undefined ? undefined : ''}>
            <p className={styles.emptyHint}>{emptyHint}</p>
            {emptyAction !== undefined && (
              <span className={styles.emptyAction}>
                <Button
                  variant="ghost"
                  iconRight="arrow-right"
                  onPress={() => {
                    jumped.current = true;
                    emptyAction.onPress();
                  }}
                >
                  {emptyAction.label}
                </Button>
              </span>
            )}
          </div>
        )}
      {draft !== undefined && dragging === null && draftCard !== undefined && ghost !== null && (
        <Popover
          triggerRef={ghostRef}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              // The popover gives focus back to the day itself, so it is marked quiet before that happens.
              const column = columns.current.get(draft.dayKey);
              if (column !== undefined && drawnBy.current === 'pointer') quietFocus(column);
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
      {moreList !== null && (
        <Popover
          triggerRef={moreRef}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setMoreList(null);
          }}
          placement="end top"
          width="menu"
        >
          {/* The Menu is the popover's content (no dialog around it), focused on its first item: a list it opened. */}
          <Menu
            isInline
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the list the chip just opened, as a MenuTrigger's would
            autoFocus="first"
            label={strings.moreList}
            onAction={(key) => {
              const chosen = moreList.hidden.find((block) => block.id === key);
              if (chosen === undefined) return;
              // The block's card opens where its list did, on the chip.
              setAnchor(moreList.anchor);
              setCardSheet(isNarrowWeek(moreList.anchor));
              setCardPlacement(placementBeside(moreList.anchor));
              anchorDay.current = moreList.dayKey;
              setMoreList(null);
              onOpen(chosen.id);
            }}
          >
            {moreList.hidden.map((block) => (
              <MenuItem key={block.id} id={block.id} {...(block.time === undefined ? {} : { description: block.time })}>
                {block.title}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      {openId !== undefined &&
        detail !== undefined &&
        anchor !== null &&
        // One day across (a phone), the card is a sheet at the window's foot, as Google Calendar's is, rather than
        // a popover over the day it is about; seven days across, a popover beside the block.
        (isCardSheet ? (
          <Modal
            variant="sheet"
            title={strings.details}
            isOpen
            isDismissable
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                onClose();
                focusDayLater(anchorDay.current, anchor);
              }
            }}
          >
            {detail}
          </Modal>
        ) : (
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
        ))}
    </section>
  );
}

/** "+N": blocks folded where a lane would be too narrow, a quiet chip in the last lane that fits; it opens their list. */
function MoreChip({
  more,
  isOpen,
  at,
  ref,
  onPress,
}: {
  readonly more: More<WeekCalendarBlock>;
  /** Its list or one of its blocks' cards is open. */
  readonly isOpen: boolean;
  /** When its first block starts ("9:30 AM"), for its name. */
  readonly at: string;
  readonly ref: Ref<HTMLButtonElement>;
  readonly onPress: (element: HTMLButtonElement) => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      className={styles.block}
      data-kind="more"
      data-nested={more.indent > 0 || undefined}
      data-size="compact"
      data-open={isOpen || undefined}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-label={strings.moreName(more.hidden.length, at)}
      style={{
        '--start': String(more.startMinute),
        '--length': String(Math.max(more.endMinute - more.startMinute, 15)),
        '--left': String(more.left),
        '--width': String(more.width),
        '--indent': String(more.indent),
        '--lane': String(more.lane),
        '--lanes': String(more.lanes),
        '--span': String(more.span),
      }}
      onClick={(event) => onPress(event.currentTarget)}
    >
      <span className={styles.blockTitle}>{strings.more(more.hidden.length)}</span>
    </button>
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
      data-size={sizeOf(length)}
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
