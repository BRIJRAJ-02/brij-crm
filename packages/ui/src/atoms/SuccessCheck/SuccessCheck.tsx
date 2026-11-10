import styles from './SuccessCheck.module.css';

/** Props for SuccessCheck. */
export interface SuccessCheckProps {
  /**
   * `sm` sits in a line of text or a button (an icon's size); `lg` leads a confirmation (a control's height); `xl` is a
   * public page's booked moment: a soft green disc with its ring that lands with a scale and a fade, then draws.
   */
  readonly size?: 'sm' | 'lg' | 'xl';
  /** What it confirms, for screen readers ("Published"); left out, it is decoration beside words that say it. */
  readonly label?: string;
}

/**
 * The moment something is done (spec 0068, AC-6806: booking confirmed, registration done, Published): a check in a
 * filled circle that fades in out of a blur with a small turn and drop, then draws its tick (transitions.dev's
 * success check). It plays once as it mounts, so a caller shows it when the thing is done and takes it away after.
 * Reduced motion shows it drawn at once.
 */
export function SuccessCheck({ size = 'sm', label }: SuccessCheckProps) {
  return (
    <span
      className={styles.root}
      data-size={size}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <svg viewBox="0 0 16 16" className={styles.mark} focusable="false">
        <circle cx="8" cy="8" r={size === 'xl' ? 7.5 : 8} className={styles.disc} />
        <path d="M4.5 8.25 7 10.5 11.5 5.75" pathLength={1} className={styles.tick} />
      </svg>
    </span>
  );
}
