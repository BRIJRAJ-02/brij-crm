import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { addDays, dayLabels, monthCells, monthName, monthParts, shiftMonth, weekdayNames } from '../../lib/month.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './MonthTiles.module.css';
import { strings } from './strings.ts';

/** Props for MonthTiles. */
export interface MonthTilesProps {
  /** The month shown, `YYYY-MM`. */
  readonly month: string;
  /** Today in the visitor's zone, `YYYY-MM-DD`: it gets a dot. */
  readonly today: string;
  /** The days with times; every other day is closed. */
  readonly openDays: ReadonlySet<string>;
  /** Open days holding a time marked Best (both free, a good hour). */
  readonly bestDays?: ReadonlySet<string>;
  /** The chosen day. */
  readonly value: string | undefined;
  readonly onChange: (day: string) => void;
  readonly onMonthChange: (month: string) => void;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  /** Focuses the chosen day once it's drawn: coming back from the details step. */
  readonly focusesValue?: boolean;
  /**
   * The month is drawn but no day's times are known yet: the tiles stand in their places quietly, and no day
   * says it has no times, which while the times are still coming would not be true.
   */
  readonly isLoading?: boolean;
  /**
   * `tiles` (the default): every day a square tile, open days tinted (the booking page). `plain`: a compact month of
   * plain numbers in 36px rows, as checklabs' reservation calendar draws it: an open day is plain text that fills under
   * the pointer, today has a hairline ring, and the chosen day fills with the accent (a restaurant's reservation page).
   */
  readonly tone?: 'tiles' | 'plain';
}

/**
 * A day's number as a plain figure, whatever the language (critic B-13): a day cell in Japanese read "5日", beside
 * English words on the same page.
 */
const dayNumber = (key: string) => String(Number(key.slice(8)));

/** The next open day from `from` in a direction, within the open days given. */
function step(open: readonly string[], from: string, delta: number): string | undefined {
  const index = open.indexOf(from);
  return index === -1 ? open[0] : open[Math.min(Math.max(index + delta, 0), open.length - 1)];
}

/**
 * A booking page's month (spec 0025, AC-665): every day a square tile, the
 * open ones filled and the chosen one in the accent; a Best day carries a dot in its corner, and today a dot under its number. One day is
 * in the tab order; arrows move between open days, Up and Down a week, Home
 * and End to the first and last, and a swipe turns the month on touch.
 */
export function MonthTiles({
  month,
  today,
  openDays,
  bestDays,
  value,
  onChange,
  onMonthChange,
  canPrevious,
  canNext,
  focusesValue = false,
  isLoading = false,
  tone = 'tiles',
}: MonthTilesProps) {
  const { locale, weekStart } = useFormatSettings();
  const grid = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | undefined>(undefined);
  // Which way the month moved, so the new grid slides in from that side (none on first paint).
  const [shown, setShown] = useState<{ readonly month: string; readonly direction: 'none' | 'forward' | 'back' }>({
    month,
    direction: 'none',
  });
  if (shown.month !== month) setShown({ month, direction: month > shown.month ? 'forward' : 'back' });
  // The month whose times just arrived: its days settle from their loading shade a row at a time, top to bottom.
  // Only that month and only that once; moving to another month shows its days as they are.
  const [wasLoading, setWasLoading] = useState(isLoading);
  const [settled, setSettled] = useState<string | undefined>(undefined);
  if (wasLoading !== isLoading) {
    setWasLoading(isLoading);
    if (!isLoading) setSettled(month);
  }
  // Only the weeks the month needs (critic B-21): six weeks always drew a row of the next month's days under most.
  const weeks = monthCells(month, locale, weekStart);
  const cells = weeks.slice(0, Math.ceil((weeks.findLastIndex((key) => key !== undefined) + 1) / 7) * 7);
  const open = cells.filter((key): key is string => key !== undefined && openDays.has(key));
  // The month's first day and its place, so a cell outside the month can name its neighbour's date.
  const lead = cells.findIndex((key) => key !== undefined);
  const first = cells[lead] ?? `${month}-01`;
  const tabbable =
    (focused !== undefined && open.includes(focused) ? focused : undefined) ??
    (value !== undefined && open.includes(value) ? value : undefined) ??
    open[0];
  const dayButton = (key: string) => grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${key}"]`);
  useEffect(() => {
    if (focusesValue && value !== undefined) dayButton(value)?.focus();
  }, [focusesValue, value]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const from = event.currentTarget.dataset.day;
    if (from === undefined) return;
    const moves: Readonly<Record<string, () => string | undefined>> = {
      ArrowLeft: () => step(open, from, -1),
      ArrowRight: () => step(open, from, 1),
      ArrowUp: () => [...open].reverse().find((key) => key <= addDays(from, -7)) ?? open[0],
      ArrowDown: () => open.find((key) => key >= addDays(from, 7)) ?? open.at(-1),
      Home: () => open[0],
      End: () => open.at(-1),
    };
    const to = moves[event.key]?.();
    if (to === undefined) return;
    event.preventDefault();
    setFocused(to);
    dayButton(to)?.focus();
  };
  const touch = useRef<number | undefined>(undefined);
  const name = monthParts(month, locale);
  return (
    <div className={styles.root} data-tone={tone === 'plain' ? 'plain' : undefined}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {/* Keyed by the month, so a new month's name rolls in the way the arrows went, with the days. */}
          <span key={month} className={styles.name} data-direction={shown.direction}>
            {name.month} <span className={styles.year}>{name.year}</span>
          </span>
        </h2>
        <div className={styles.arrows}>
          <Button
            variant="ghost"
            icon="chevron-left"
            label={strings.previousMonth}
            // A guest's thumb: the plain month's arrows press across 44px, drawn as before.
            isTouchTarget={tone === 'plain'}
            isDisabled={!canPrevious}
            onPress={() => onMonthChange(shiftMonth(month, -1))}
          />
          <Button
            variant="ghost"
            icon="chevron-right"
            label={strings.nextMonth}
            isTouchTarget={tone === 'plain'}
            isDisabled={!canNext}
            onPress={() => onMonthChange(shiftMonth(month, 1))}
          />
        </div>
      </div>
      <div className={styles.weekdays} aria-hidden="true">
        {weekdayNames(locale, weekStart).map((weekday) => (
          <span key={weekday.long} className={styles.weekday}>
            {weekday.short}
          </span>
        ))}
      </div>
      <div
        ref={grid}
        key={month}
        className={styles.grid}
        data-direction={shown.direction}
        data-settle={settled === month ? '' : undefined}
        role="group"
        aria-label={monthName(month, locale)}
        aria-busy={isLoading || undefined}
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX;
        }}
        onTouchEnd={(event) => {
          const startX = touch.current;
          const endX = event.changedTouches[0]?.clientX;
          if (startX === undefined || endX === undefined) return;
          if (endX - startX < -48 && canNext) onMonthChange(shiftMonth(month, 1));
          if (endX - startX > 48 && canPrevious) onMonthChange(shiftMonth(month, -1));
        }}
      >
        {cells.map((key, index) => {
          // Outside the month: the neighbour's date, drawn by CSS from data-date (decoration, not text), quiet and out
          // of reach, so the six weeks that hold every month at one height never leave an empty row over the times
          // (spec 0058).
          if (key === undefined)
            return (
              <span
                key={`outside-${String(index)}`}
                className={styles.outside}
                data-date={dayNumber(addDays(first, index - lead))}
                aria-hidden="true"
              />
            );
          const labels = dayLabels(key, locale);
          const isOpen = openDays.has(key);
          const isToday = key === today;
          const isBest = isOpen && bestDays?.has(key) === true;
          const label = [
            labels.label,
            isToday ? strings.today : undefined,
            // While the times are still coming, no day has been found closed yet.
            isOpen || isLoading ? undefined : strings.noTimes,
          ]
            .filter((part) => part !== undefined)
            .join(', ');
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              className={styles.day}
              data-loading={isLoading ? '' : undefined}
              data-best={isBest ? '' : undefined}
              data-today={isToday ? '' : undefined}
              style={{ '--day-row': String(Math.floor(index / 7)) }}
              disabled={!isOpen}
              aria-pressed={isOpen ? key === value : undefined}
              aria-label={isBest ? `${label}, ${strings.best}` : label}
              tabIndex={key === tabbable ? 0 : -1}
              onKeyDown={onKey}
              onClick={() => {
                setFocused(undefined);
                onChange(key);
              }}
            >
              {dayNumber(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
