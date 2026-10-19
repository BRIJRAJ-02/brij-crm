import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

/** One block on the grid: a booking, or one of the member's own calendar events (quieter, in its calendar's hue). */
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
  readonly kind: 'booking' | 'event';
  /** An event's calendar hue (each connection keeps one). */
  readonly hue?: Hue;
  readonly isCancelled?: boolean;
}

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
}: WeekCalendarProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLDivElement>());
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());
  // The open card's anchor: the block that was pressed.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);

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
                onKeyDown={(event) => onColumnKey(event, day, dayBlocks)}
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
                      <span className={styles.blockTitle}>{block.title}</span>
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
