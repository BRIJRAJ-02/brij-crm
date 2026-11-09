import { Radio, RadioGroup } from 'react-aria-components';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../Button/Button.tsx';
import { useSlidingIndicator } from '../Tabs/useSlidingIndicator.ts';
import { cx } from '../../lib/cx.ts';
import './DayStrip.css';

/** One day in the strip. `count` is how many meetings it holds (up to three dots draw). */
export interface StripDay { readonly id: string; readonly weekday: string; readonly date: number; readonly label: string; readonly count: number; readonly isToday?: boolean }

/** Props for DayStrip. */
export interface DayStripProps {
  readonly days: ReadonlyArray<StripDay>;
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Shown as arrows either side when given: move the strip a week. */
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  readonly label?: string;
}

/** A row of days (Mon 10 …) with meeting dots; the selected day's pill slides to it (transitions.dev tabs sliding). */
export function DayStrip({ days, value, onChange, onPrevious, onNext, label = 'Day' }: DayStripProps) {
  // Tabs' measured pill (16 tabs sliding); a new week re-measures too.
  const bar = useSlidingIndicator(`${value}|${days.map((d) => d.id).join(',')}`);
  return (
    <div className="tf-daystrip">
      {onPrevious && <IconButton label="Previous week" size="sm" onPress={onPrevious}><ChevronLeft size={16} strokeWidth={1.75} /></IconButton>}
      <RadioGroup aria-label={label} orientation="horizontal" value={value} onChange={onChange} className="tf-daystrip__group">
        <div ref={bar} className="tf-daystrip__bar">
          <span className="tf-daystrip__pill" aria-hidden="true" />
          {days.map((d) => (
            <Radio key={d.id} value={d.id} aria-label={`${d.label}, ${d.count === 0 ? 'no meetings' : `${d.count} meeting${d.count === 1 ? '' : 's'}`}`}
              className={cx('tf-daystrip__day', d.isToday && 'tf-daystrip__day--today')}>
              <span className="tf-daystrip__weekday">{d.isToday ? 'Today' : d.weekday}</span>
              <span className="tf-daystrip__date tf-num">{d.date}</span>
              <span className="tf-daystrip__dots" aria-hidden="true">
                {Array.from({ length: Math.min(d.count, 3) }, (_, n) => <span key={n} className="tf-daystrip__dot" />)}
              </span>
            </Radio>
          ))}
        </div>
      </RadioGroup>
      {onNext && <IconButton label="Next week" size="sm" onPress={onNext}><ChevronRight size={16} strokeWidth={1.75} /></IconButton>}
    </div>
  );
}
