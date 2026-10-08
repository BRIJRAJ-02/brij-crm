import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './Callout.module.css';

/** `info` to explain, `success` to confirm in place, `warning` before a risky step, `danger` for what failed. */
export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * `inline` (the default): a bordered box inside a padded region. `banner`: full
 * width under a view's bars, for a state of the whole view (live updates
 * paused): square, with only a hairline below, its content in line with the bars'.
 */
export type CalloutPlacement = 'inline' | 'banner';

/** Props for Callout. */
export interface CalloutProps {
  readonly tone?: CalloutTone;
  readonly placement?: CalloutPlacement;
  /**
   * Said politely by screen readers when it appears (a state that changed
   * under the person, not one they caused). A danger callout is always
   * announced, as an alert.
   */
  readonly isAnnounced?: boolean;
  /** One short line in bold. */
  readonly title?: string;
  /** The message: what it means and what to do. */
  readonly children: ReactNode;
  /** A button or link for the next step. */
  readonly actions?: ReactNode;
}

const TONE_ICONS: Readonly<Record<CalloutTone, IconName>> = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

/**
 * A message that stays in the page beside what it is about: an import that
 * skipped rows, a key shown once, a plan near its limit. Not a toast: it
 * stays until what it describes changes. A danger callout is announced, and
 * so is one marked `isAnnounced`.
 */
export function Callout({
  tone = 'info',
  placement = 'inline',
  isAnnounced = false,
  title,
  children,
  actions,
}: CalloutProps) {
  const role = tone === 'danger' ? 'alert' : isAnnounced ? 'status' : 'note';
  // A status region announces what changes inside it, not what it was born with: its words go in a frame later.
  const [isFilled, setFilled] = useState(role !== 'status');
  useEffect(() => {
    if (role !== 'status') return;
    const frame = requestAnimationFrame(() => {
      setFilled(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [role]);
  return (
    <div className={styles.root} data-tone={tone} data-placement={placement} role={role}>
      <span className={styles.icon}>
        <Icon name={TONE_ICONS[tone]} size="sm" />
      </span>
      <span className={styles.body}>
        {title !== undefined && <span className={styles.title}>{isFilled ? title : null}</span>}
        <span className={styles.text}>{isFilled ? children : null}</span>
        {actions !== undefined && <span className={styles.actions}>{actions}</span>}
      </span>
    </div>
  );
}
