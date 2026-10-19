// Step 1, Choose a time (spec 0025 experience, AC-665 to AC-669): Month or
// List, the chosen day's times, and the commit bar. Picking a time never
// moves on; only the bar does, and it names the time. Times arrive grouped by
// day in the visitor's zone, so a new zone or clock regroups them at once.
import { useEffect, useRef, useState } from 'react';
import styles from './booking.module.css';
import type { SlotView } from './prefs.ts';
import { strings } from './strings.ts';
import { dayLabels, monthCells, monthLabel, monthOf, shiftMonth, timeLabel, weekdayNames } from './time.ts';

/** What the picker shows: the times grouped by day, and the choices. */
export interface PickerProps {
  readonly byDay: ReadonlyMap<string, readonly string[]>;
  readonly today: string;
  /** The last month the page can be booked in. */
  readonly lastMonth: string;
  readonly zone: string;
  readonly locale: string;
  readonly hour12: boolean;
  readonly onHour12: (hour12: boolean) => void;
  readonly view: SlotView;
  readonly onView: (view: SlotView) => void;
  readonly duration: number;
  readonly day: string | undefined;
  readonly onDay: (day: string) => void;
  readonly month: string;
  readonly onMonth: (month: string) => void;
  readonly time: string | undefined;
  readonly onTime: (time: string) => void;
  readonly onCommit: () => void;
  /** The day button to focus when the picker comes back (Change time). */
  readonly focusDay?: boolean;
}

/** The next open day from `from` in a direction, within the open days given. */
function step(open: readonly string[], from: string, delta: number): string | undefined {
  const index = open.indexOf(from);
  return index === -1 ? open[0] : open[Math.min(Math.max(index + delta, 0), open.length - 1)];
}

/** The month grid: one tabbable day, arrows between open days, Up and Down a week, Home and End. */
function MonthGrid({
  byDay,
  today,
  lastMonth,
  locale,
  day,
  onDay,
  month,
  onMonth,
  focusDay,
}: Pick<PickerProps, 'byDay' | 'today' | 'lastMonth' | 'locale' | 'day' | 'onDay' | 'month' | 'onMonth' | 'focusDay'>) {
  const grid = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const cells = monthCells(month, locale);
  const open = cells.filter((key): key is string => key !== undefined && (byDay.get(key)?.length ?? 0) > 0);
  const tabbable =
    (focused !== undefined && open.includes(focused) ? focused : undefined) ??
    (day !== undefined && open.includes(day) ? day : undefined) ??
    open[0];
  const focusKey = (key: string) => {
    setFocused(key);
    grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${key}"]`)?.focus();
  };
  useEffect(() => {
    if (focusDay === true && day !== undefined) {
      grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${day}"]`)?.focus();
    }
  }, [focusDay, day]);
  const onKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const from = event.currentTarget.dataset.day;
    if (from === undefined) return;
    const moves: Record<string, () => string | undefined> = {
      ArrowLeft: () => step(open, from, -1),
      ArrowRight: () => step(open, from, 1),
      ArrowUp: () => [...open].reverse().find((key) => key <= addWeek(from, -1)) ?? open[0],
      ArrowDown: () => open.find((key) => key >= addWeek(from, 1)) ?? open.at(-1),
      Home: () => open[0],
      End: () => open.at(-1),
    };
    const move = moves[event.key];
    const to = move?.();
    if (to === undefined) return;
    event.preventDefault();
    focusKey(to);
  };
  const canBack = month > monthOf(today);
  const canForward = month < lastMonth;
  // Swipe between months on touch.
  const touch = useRef<number | undefined>(undefined);
  return (
    <div className={styles.monthView}>
      <div className={styles.monthHead}>
        <h3 className={styles.monthLabel}>{monthLabel(month, locale)}</h3>
        <div className={styles.arrows}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={strings.previousMonth}
            disabled={!canBack}
            onClick={() => onMonth(shiftMonth(month, -1))}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={strings.nextMonth}
            disabled={!canForward}
            onClick={() => onMonth(shiftMonth(month, 1))}
          >
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.weekdays} aria-hidden="true">
        {weekdayNames(locale).map((name) => (
          <span key={name.long} className={styles.weekday}>
            {name.short}
          </span>
        ))}
      </div>
      <div
        ref={grid}
        className={styles.monthGrid}
        role="group"
        aria-label={monthLabel(month, locale)}
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX;
        }}
        onTouchEnd={(event) => {
          const startX = touch.current;
          const endX = event.changedTouches[0]?.clientX;
          if (startX === undefined || endX === undefined) return;
          if (endX - startX < -48 && canForward) onMonth(shiftMonth(month, 1));
          if (endX - startX > 48 && canBack) onMonth(shiftMonth(month, -1));
        }}
      >
        {cells.map((key, index) => {
          if (key === undefined) return <span key={`blank-${String(index)}`} aria-hidden="true" />;
          const labels = dayLabels(key, locale);
          const isOpen = open.includes(key);
          const isToday = key === today;
          const name = `${labels.label}${isToday ? `, ${strings.today}` : ''}`;
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              className={styles.dayCell}
              disabled={!isOpen}
              aria-pressed={isOpen ? key === day : undefined}
              aria-label={isOpen ? name : `${name}, ${strings.noTimes}`}
              tabIndex={key === tabbable ? 0 : -1}
              onKeyDown={onKey}
              onClick={() => {
                setFocused(undefined);
                onDay(key);
              }}
            >
              {labels.day}
              {isToday && <span className={styles.todayDot} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A day key a week away. */
function addWeek(key: string, weeks: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 7 * weeks)).toISOString().slice(0, 10);
}

/** The picker: the view switch, the days, the times and the commit bar. */
export function Picker(props: PickerProps) {
  const { byDay, zone, locale, hour12, onHour12, view, onView, duration, day, time, onTime, onCommit } = props;
  const times = day === undefined ? [] : (byDay.get(day) ?? []);
  const dayLabel = day === undefined ? '' : dayLabels(day, locale).short;
  const commit = useRef<HTMLButtonElement>(null);
  const timesRef = useRef<HTMLDivElement>(null);
  const openDays = [...byDay.keys()].filter((key) => (byDay.get(key)?.length ?? 0) > 0).sort();
  // On a phone, a new day scrolls its times into view, and a picked time the bar.
  const isNarrow = () => globalThis.matchMedia('(width < 1024px)').matches;
  // Under reduced motion the page jumps rather than glides.
  const glide = (): ScrollBehavior =>
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  return (
    <div className={styles.picker}>
      <div className={styles.pickerHead}>
        <h2 className={styles.stepTitle}>{strings.chooseTime}</h2>
        <div className={styles.segmented} role="radiogroup" aria-label={strings.view}>
          {(['month', 'list'] as const).map((each) => (
            <button
              key={each}
              type="button"
              role="radio"
              aria-checked={view === each}
              className={styles.segment}
              onClick={() => onView(each)}
            >
              {each === 'month' ? strings.month : strings.list}
            </button>
          ))}
        </div>
      </div>
      <div className={view === 'month' ? styles.monthLayout : styles.listLayout}>
        {view === 'month' ? (
          <MonthGrid
            {...props}
            onDay={(key) => {
              props.onDay(key);
              if (isNarrow()) timesRef.current?.scrollIntoView({ block: 'nearest', behavior: glide() });
            }}
          />
        ) : (
          <div className={styles.chips} role="group" aria-label={strings.chooseTime}>
            {openDays.map((key) => {
              const labels = dayLabels(key, locale);
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.chip}
                  aria-pressed={key === day}
                  aria-label={labels.label}
                  onClick={() => {
                    props.onDay(key);
                    if (isNarrow()) timesRef.current?.scrollIntoView({ block: 'nearest', behavior: glide() });
                  }}
                >
                  <span className={styles.weekday}>{labels.weekday}</span>
                  <span className={styles.chipDate}>{labels.day}</span>
                </button>
              );
            })}
          </div>
        )}
        <div ref={timesRef} className={view === 'month' ? styles.timesColumn : styles.timesBlock}>
          <div className={styles.timesHead}>
            <span className={styles.timesDay}>{dayLabel}</span>
            <div className={styles.segmented} role="radiogroup" aria-label={strings.clock}>
              {[true, false].map((each) => (
                <button
                  key={String(each)}
                  type="button"
                  role="radio"
                  aria-checked={hour12 === each}
                  className={styles.segment}
                  onClick={() => onHour12(each)}
                >
                  {each ? strings.hours12 : strings.hours24}
                </button>
              ))}
            </div>
          </div>
          <ul key={`${day ?? ''}|${zone}`} className={view === 'month' ? styles.timesScroll : styles.timesGrid}>
            {times.map((start, index) => {
              const label = timeLabel(start, zone, locale, hour12);
              return (
                <li key={start} className={styles.timeItem} style={{ '--index': String(index) }}>
                  <button
                    type="button"
                    className={styles.time}
                    aria-pressed={start === time}
                    aria-label={strings.timeName(label, dayLabel, duration)}
                    onClick={() => {
                      onTime(start);
                      if (isNarrow()) commit.current?.scrollIntoView({ block: 'nearest', behavior: glide() });
                    }}
                  >
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className={styles.visuallyHidden} role="status">
        {day === undefined ? '' : strings.timesOn(times.length, dayLabel)}
      </p>
      <button ref={commit} type="button" className={styles.commit} disabled={time === undefined} onClick={onCommit}>
        <span key={time ?? 'none'} className={styles.commitLabel}>
          {time === undefined ? strings.book : strings.bookAt(timeLabel(time, zone, locale, hour12))}
        </span>
      </button>
    </div>
  );
}
