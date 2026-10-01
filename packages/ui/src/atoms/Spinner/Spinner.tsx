import { ProgressBar } from 'react-aria-components';
import { Icon, type IconSize } from '../Icon/Icon.tsx';
import styles from './Spinner.module.css';
import { strings } from './strings.ts';

/** Props for Spinner. */
export interface SpinnerProps {
  /** What is in progress, read by screen readers. Defaults to "In progress". */
  readonly label?: string;
  /** The icon size it matches: `sm` inside buttons (the default), `md` in rows and menus. */
  readonly size?: IconSize;
}

/**
 * Shows that something is under way, one turn per `duration-spin`. It is an
 * indeterminate progress bar to screen readers; under reduced motion it pulses
 * instead of turning.
 */
export function Spinner({ label = strings.inProgress, size = 'sm' }: SpinnerProps) {
  return (
    <ProgressBar isIndeterminate aria-label={label} className={styles.root}>
      <span className={styles.spin}>
        <Icon name="loader-circle" size={size} />
      </span>
    </ProgressBar>
  );
}
