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
}

/** The next open day from `from` in a direction, within the open days given. */
function step(open: readonly string[], from: string, delta: number): string | undefined {
  const index = open.indexOf(from);
  return index === -1 ? open[0] : open[Math.min(Math.max(index + delta, 0), open.length - 1)];
}

/**
 * A booking page's month (spec 0025, AC-665): every day a square tile, the
 * open ones filled and the chosen one in the accent; only a Best day carries a dot (today is said, not marked). One day is
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
}: MonthTilesProps) {
  const { locale } = useFormatSettings();
  const grid = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | undefined>(undefined);
  // Which way the month moved, so the new grid slides in from that side (none on first paint).
  const [shown, setShown] = useState<{ readonly month: string; readonly direction: 'none' | 'forward' | 'back' }>({
    month,
    direction: 'none',
  });
  if (shown.month !== month) setShown({ month, direction: month > shown.month ? 'forward' : 'back' });
  const cells = monthCells(month, locale);
  const open = cells.filter((key): key is string => key !== undefined && openDays.has(key));
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
    <div className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {name.month} <span className={styles.year}>{name.year}</span>
        </h2>
        <div className={styles.arrows}>
          <Button
            variant="ghost"
            icon="chevron-left"
            label={strings.previousMonth}
            isDisabled={!canPrevious}
            onPress={() => onMonthChange(shiftMonth(month, -1))}
          />
          <Button
            variant="ghost"
            icon="chevron-right"
            label={strings.nextMonth}
            isDisabled={!canNext}
            onPress={() => onMonthChange(shiftMonth(month, 1))}
          />
        </div>
      </div>
      <div className={styles.weekdays} aria-hidden="true">
        {weekdayNames(locale).map((weekday) => (
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
        role="group"
        aria-label={monthName(month, locale)}
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
          if (key === undefined) return <span key={`blank-${String(index)}`} aria-hidden="true" />;
          const labels = dayLabels(key, locale);
          const isOpen = openDays.has(key);
          const isToday = key === today;
          const isBest = isOpen && bestDays?.has(key) === true;
          const label = [labels.label, isToday ? strings.today : undefined, isOpen ? undefined : strings.noTimes]
            .filter((part) => part !== undefined)
            .join(', ');
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              className={styles.day}
              data-best={isBest ? '' : undefined}
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
              {labels.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
