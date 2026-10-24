import { useEffect, useRef, type KeyboardEvent } from 'react';
import { dayLabels } from '../../lib/month.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './DayStrip.module.css';
import { strings } from './strings.ts';

/** Props for DayStrip. */
export interface DayStripProps {
  /** The open days, `YYYY-MM-DD`, in order. */
  readonly days: readonly string[];
  /** Days holding a Best time. */
  readonly bestDays?: ReadonlySet<string>;
  readonly value: string | undefined;
  readonly onChange: (day: string) => void;
  /** Focuses the chosen day once drawn: coming back from the details step. */
  readonly focusesValue?: boolean;
  /** Draws a day's tile in each place while the days load, so the times under them never move. */
  readonly isLoading?: boolean;
}

/** How many day tiles the loading strip holds: a week, which is about what fits before it scrolls. */
const GHOST_DAYS = 7;

/**
 * A booking page's List view (spec 0025, AC-666): only the days with times,
 * sideways, each its weekday over its date. The chosen day slides into view.
 * One day is in the tab order and the arrows move along them.
 */
export function DayStrip({ days, bestDays, value, onChange, focusesValue = false, isLoading = false }: DayStripProps) {
  const { locale } = useFormatSettings();
  const strip = useRef<HTMLDivElement>(null);
  const button = (key: string) => strip.current?.querySelector<HTMLButtonElement>(`button[data-day="${key}"]`);
  useEffect(() => {
    if (value === undefined) return;
    const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const chosen = button(value);
    chosen?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (focusesValue) chosen?.focus({ preventScroll: true });
  }, [value, focusesValue]);
  const tabbable = value !== undefined && days.includes(value) ? value : days[0];
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = days.indexOf(event.currentTarget.dataset.day ?? '');
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? days[Math.min(index + 1, days.length - 1)]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? days[Math.max(index - 1, 0)]
          : event.key === 'Home'
            ? days[0]
            : event.key === 'End'
              ? days.at(-1)
              : undefined;
    if (to === undefined) return;
    event.preventDefault();
    button(to)?.focus();
  };
  if (isLoading) {
    return (
      <div className={styles.root} aria-busy="true">
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
        {Array.from({ length: GHOST_DAYS }, (_, index) => (
          <span key={index} className={styles.day} data-loading="" aria-hidden="true" />
        ))}
      </div>
    );
  }
  return (
    <div ref={strip} className={styles.root} role="group" aria-label={strings.days}>
      {days.map((key) => {
        const labels = dayLabels(key, locale);
        const isBest = bestDays?.has(key) === true;
        return (
          <button
            key={key}
            type="button"
            data-day={key}
            data-best={isBest ? '' : undefined}
            className={styles.day}
            aria-pressed={key === value}
            aria-label={isBest ? `${labels.label}, ${strings.best}` : labels.label}
            tabIndex={key === tabbable ? 0 : -1}
            onKeyDown={onKey}
            onClick={() => onChange(key)}
          >
            <span className={styles.weekday}>{labels.weekday}</span>
            <span className={styles.date}>{labels.day}</span>
          </button>
        );
      })}
    </div>
  );
}
