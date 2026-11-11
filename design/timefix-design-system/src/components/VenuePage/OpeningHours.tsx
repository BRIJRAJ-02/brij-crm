import { useEffect, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { formatClock, formatClockRange } from '../WeekCalendar/clock.ts';

/** One day of the week: its name and the times it's open, in minutes from midnight (empty is closed). */
export interface OpeningDay { readonly day: string; readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }> }

/** Whether a place is open at a moment, and the words for the pill: "Open · closes 8:00 PM", "Closed · opens 10:00 AM", "Closed · opens Tue 10:00 AM". */
export function openStatus(week: ReadonlyArray<OpeningDay>, now: Date): { readonly isOpen: boolean; readonly label: string; readonly todayIndex: number } {
  const todayIndex = (now.getDay() + 6) % 7; // Monday first
  const m = now.getHours() * 60 + now.getMinutes();
  const today = week[todayIndex]?.ranges ?? [];
  const open = today.find((r) => r.start <= m && m < r.end);
  if (open) return { isOpen: true, label: `Open · closes ${formatClock(open.end % 1440)}`, todayIndex };
  const later = today.find((r) => r.start > m);
  if (later) return { isOpen: false, label: `Closed · opens ${formatClock(later.start)}`, todayIndex };
  for (let n = 1; n <= 7; n++) {
    const i = (todayIndex + n) % 7; const r = week[i]?.ranges[0];
    if (r) return { isOpen: false, label: `Closed · opens ${n === 1 ? 'tomorrow' : (week[i]?.day ?? '').slice(0, 3)} ${formatClock(r.start)}`, todayIndex };
  }
  return { isOpen: false, label: 'Closed', todayIndex };
}

/** Props for OpeningHours. */
export interface OpeningHoursProps {
  /** Monday first, seven days. */
  readonly week: ReadonlyArray<OpeningDay>;
  readonly title?: string;
  /** A fixed moment (a preview or a test); without it the card follows the clock, checking again each minute and when the tab comes back. */
  readonly now?: Date;
}

/** A place's week at a glance: a live Open or Closed pill with when that changes, today's row picked out, closed days quiet. */
export function OpeningHours({ week, title = 'Opening times', now: fixed }: OpeningHoursProps) {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    if (fixed) return undefined;
    const t = window.setInterval(() => setTick(new Date()), 60_000);
    const back = () => { if (!document.hidden) setTick(new Date()); };
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [fixed]);
  const s = openStatus(week, fixed ?? tick);
  return (
    <section className="tf-ophours" aria-label={title}>
      <div className="tf-ophours__top">
        <h3 className="tf-ophours__title">{title}</h3>
        <span className={cx('tf-ophours__status', s.isOpen && 'is-open')} role="status"><span className="tf-ophours__dot" aria-hidden="true" />{s.label}</span>
      </div>
      <ul className="tf-ophours__rows">
        {week.map((d, i) => (
          <li key={d.day} className={cx('tf-ophours__row', i === s.todayIndex && 'is-today', d.ranges.length === 0 && 'is-closed')} aria-current={i === s.todayIndex ? 'date' : undefined}>
            <span>{d.day}</span>
            <span className="tf-ophours__times tf-num">{d.ranges.length ? d.ranges.map((r) => <span key={r.start}>{formatClockRange(r.start, r.end % 1440)}</span>) : 'Closed'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
