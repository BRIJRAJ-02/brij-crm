import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './Callout.module.css';

const classes = (own: string | undefined, added: string | undefined) =>
  added === undefined ? own : `${own ?? ''} ${added}`;

/**
 * `info` for a passing state, quiet and never a permanent explanation; `success` to confirm a result in place;
 * `warning` when someone must act or is about to take a risk; `danger` for what failed.
 */
export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * `inline` (the default): a bordered box inside a padded region. `banner`: full
 * width under a view's bars, for a state of the whole view: square, with only
 * a hairline below, its content in line with the bars'. `CalloutBar`: one short line
 * inside a bar, a control's height, for a state that must not push the view
 * down when it comes and goes (live updates paused, in the view bar).
 */
export type CalloutPlacement = 'inline' | 'banner';

/** Props for Callout. */
export interface CalloutProps {
  /**
   * Required: every caller decides what the message is. `info` draws a plain grey line (no fill, no edge) for a
   * state that comes and goes; colour and a box are kept for `warning` and `danger`, which ask for action.
   */
  readonly tone: CalloutTone;
  readonly placement?: CalloutPlacement;
  /** `CalloutBar` passes its stylesheet here. */
  readonly barStyles?: Readonly<Record<string, string | undefined>>;
  /**
   * Said politely by screen readers when it appears (a state that changed
   * under the person, not one they caused). A danger callout is always
   * announced, as an alert.
   */
  readonly isAnnounced?: boolean;
  /**
   * A danger callout the person caused by their own action (a form's list of
   * answers to fix after Send): said politely, as a status, rather than as an
   * alert, since focus already went to the first problem.
   */
  readonly isPolite?: boolean;
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
 * stays until what it describes changes. Never a permanent explanation of how
 * a screen works. A danger callout is announced, and so is one marked
 * `isAnnounced`.
 */
export function Callout({
  tone,
  placement = 'inline',
  barStyles,
  isAnnounced = false,
  isPolite = false,
  title,
  children,
  actions,
}: CalloutProps) {
  const role = tone === 'danger' && !isPolite ? 'alert' : isAnnounced || isPolite ? 'status' : 'note';
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
    <div
      className={classes(styles.root, barStyles?.root)}
      data-tone={tone}
      data-placement={barStyles === undefined ? placement : 'bar'}
      role={role}
    >
      <span className={classes(styles.icon, barStyles?.icon)}>
        <Icon name={TONE_ICONS[tone]} size="sm" />
      </span>
      <span className={styles.body}>
        {title !== undefined && <span className={styles.title}>{isFilled ? title : null}</span>}
        <span className={classes(styles.text, barStyles?.text)}>{isFilled ? children : null}</span>
        {actions !== undefined && <span className={styles.actions}>{actions}</span>}
      </span>
    </div>
  );
}
