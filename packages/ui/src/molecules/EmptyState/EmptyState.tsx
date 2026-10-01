import type { ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './EmptyState.module.css';
import { strings } from './strings.ts';

/** `empty` when there is nothing yet, `error` when it failed to load, `locked` when the viewer may not see it. */
export type EmptyStateTone = 'empty' | 'error' | 'locked';

/** Props for EmptyState. */
export interface EmptyStateProps {
  /** One line that says what is (or isn't) here: "No deals yet", "Couldn't load deals". */
  readonly title: string;
  /** A sentence or two more: what to do next, or why. */
  readonly children?: ReactNode;
  readonly tone?: EmptyStateTone;
  /** The icon in its tile. Defaults to one for the tone. */
  readonly icon?: IconName;
  /** Buttons for the next step ("Add deal", "Import"). */
  readonly actions?: ReactNode;
  /** For `error`: shows "Try again", which calls it. */
  readonly onRetry?: () => void;
}

const TONE_ICONS: Readonly<Record<EmptyStateTone, IconName>> = {
  empty: 'inbox',
  error: 'triangle-alert',
  locked: 'lock',
};

/**
 * What a list, a panel or a view shows when it has nothing to show: empty, a
 * load that failed (with a retry), or no access. Every component's empty,
 * error and locked states are made from it, with Skeleton for loading.
 */
export function EmptyState({ title, children, tone = 'empty', icon, actions, onRetry }: EmptyStateProps) {
  return (
    <div className={styles.root} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={styles.icon}>
        <Icon name={icon ?? TONE_ICONS[tone]} size="md" />
      </span>
      <span className={styles.title}>{title}</span>
      {children !== undefined && <span className={styles.text}>{children}</span>}
      {(actions !== undefined || (tone === 'error' && onRetry !== undefined)) && (
        <span className={styles.actions}>
          {tone === 'error' && onRetry !== undefined && (
            <Button icon="refresh-cw" onPress={onRetry}>
              {strings.retry}
            </Button>
          )}
          {actions}
        </span>
      )}
    </div>
  );
}
