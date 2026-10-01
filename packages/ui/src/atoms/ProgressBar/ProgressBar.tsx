import { Label, ProgressBar as AriaProgressBar } from 'react-aria-components';
import '../../lib/custom-properties.ts';
import styles from './ProgressBar.module.css';

/** Props for ProgressBar. */
export interface ProgressBarProps {
  /** What is in progress ("Importing 2,400 people"). */
  readonly label: string;
  /** How far along, from 0 to `maxValue`. Leave it out (or set `isIndeterminate`) when that isn't known. */
  readonly value?: number;
  readonly maxValue?: number;
  readonly isIndeterminate?: boolean;
  /** Keeps the label for screen readers only, when the text beside it already says. */
  readonly isLabelHidden?: boolean;
  /** Shows the percentage after the label. */
  readonly showValue?: boolean;
}

/** How far a long task has got: an import, an export, a bulk edit. Indeterminate when that isn't known. */
export function ProgressBar({
  label,
  value,
  maxValue = 100,
  isIndeterminate = value === undefined,
  isLabelHidden = false,
  showValue = false,
}: ProgressBarProps) {
  return (
    <AriaProgressBar
      className={styles.root}
      maxValue={maxValue}
      isIndeterminate={isIndeterminate}
      {...(value === undefined ? {} : { value })}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
    >
      {({ percentage, valueText }) => (
        <>
          {!isLabelHidden && (
            <span className={styles.head}>
              <Label className={styles.label}>{label}</Label>
              {showValue && !isIndeterminate && <span className={styles.value}>{valueText}</span>}
            </span>
          )}
          <span className={styles.track}>
            <span
              className={styles.fill}
              data-indeterminate={isIndeterminate || undefined}
              style={{ '--progress': `${String(percentage ?? 0)}%` }}
            />
          </span>
        </>
      )}
    </AriaProgressBar>
  );
}
