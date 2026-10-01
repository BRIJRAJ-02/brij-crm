import type { ReactNode } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './Callout.module.css';

/** `info` to explain, `success` to confirm in place, `warning` before a risky step, `danger` for what failed. */
export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

/** Props for Callout. */
export interface CalloutProps {
  readonly tone?: CalloutTone;
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
 * stays until what it describes changes. A danger callout is announced.
 */
export function Callout({ tone = 'info', title, children, actions }: CalloutProps) {
  return (
    <div className={styles.root} data-tone={tone} role={tone === 'danger' ? 'alert' : 'note'}>
      <span className={styles.icon}>
        <Icon name={TONE_ICONS[tone]} size="sm" />
      </span>
      <span className={styles.body}>
        {title !== undefined && <span className={styles.title}>{title}</span>}
        <span className={styles.text}>{children}</span>
        {actions !== undefined && <span className={styles.actions}>{actions}</span>}
      </span>
    </div>
  );
}
