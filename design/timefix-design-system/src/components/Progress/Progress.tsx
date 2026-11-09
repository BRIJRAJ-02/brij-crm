import { Meter as AriaMeter, ProgressBar as AriaProgressBar, Label } from 'react-aria-components';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import './Progress.css';

/** Props for ProgressBar. */
export interface ProgressBarProps {
  /** What is in progress ("Importing contacts.csv"). Without it, pass `aria-label`. */
  readonly label?: string;
  readonly 'aria-label'?: string;
  readonly value?: number;
  readonly maxValue?: number;
  /** Work of unknown length: a segment sweeps the track. */
  readonly isIndeterminate?: boolean;
  /** Shows the value on the right; a string replaces the percentage ("2 of 6"). */
  readonly showValue?: boolean | string;
  /** `sm` is the 4px bar inside cards and checklists; `md` is 6px. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** Progress of a task the user is waiting on: a thin blue fill that eases to each new value, or a sweeping segment when the length is unknown. */
export function ProgressBar({ label, value = 0, maxValue = 100, isIndeterminate = false, showValue = false, size = 'md', className, 'aria-label': ariaLabel }: ProgressBarProps) {
  return (
    <AriaProgressBar value={value} maxValue={maxValue} isIndeterminate={isIndeterminate} aria-label={ariaLabel} className={cx('tf-progress', `tf-progress--${size}`, className)}>
      {({ percentage, valueText }) => (
        <>
          {(label !== undefined || showValue !== false) && (
            <div className="tf-progress__head">
              {label !== undefined && <Label className="tf-progress__label">{label}</Label>}
              {showValue !== false && !isIndeterminate && <span className="tf-progress__value tf-num">{typeof showValue === 'string' ? showValue : valueText}</span>}
            </div>
          )}
          <div className="tf-progress__track"><div className="tf-progress__fill" style={isIndeterminate ? undefined : { width: `${percentage ?? 0}%` }} /></div>
        </>
      )}
    </AriaProgressBar>
  );
}

/** Props for Meter. */
export interface MeterProps {
  readonly label: string;
  readonly value: number;
  readonly maxValue: number;
  /** The used/limit line on the right ("820 of 1,000"). */
  readonly valueLabel?: string;
  /** Share of the limit (0–1) where the fill turns amber. Default 0.8. */
  readonly warnAt?: number;
  /** Share where it turns red. Default 0.95. */
  readonly dangerAt?: number;
  /** One quiet line under the bar, shown once a threshold is crossed ("Upgrade before you reach the limit"). */
  readonly hint?: ReactNode;
}

/** A quantity against a limit (plan usage, seats, storage). Blue while there is room, amber near the limit, red at it. */
export function Meter({ label, value, maxValue, valueLabel, warnAt = 0.8, dangerAt = 0.95, hint }: MeterProps) {
  const share = maxValue > 0 ? value / maxValue : 0;
  const tone = share >= dangerAt ? 'danger' : share >= warnAt ? 'warning' : 'normal';
  return (
    <AriaMeter value={value} maxValue={maxValue} valueLabel={valueLabel} className={cx('tf-progress', 'tf-meter', `tf-meter--${tone}`)}>
      {({ percentage, valueText }) => (
        <>
          <div className="tf-progress__head">
            <Label className="tf-progress__label">{label}</Label>
            <span className="tf-progress__value tf-num">{valueText}</span>
          </div>
          <div className="tf-progress__track"><div className="tf-progress__fill" style={{ width: `${Math.min(100, percentage)}%` }} /></div>
          {tone !== 'normal' && hint !== undefined && <p className="tf-meter__hint">{hint}</p>}
        </>
      )}
    </AriaMeter>
  );
}
