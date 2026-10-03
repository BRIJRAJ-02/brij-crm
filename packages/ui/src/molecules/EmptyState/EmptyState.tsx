import type { ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
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
  /**
   * What will show here is still loading: the tile, then skeleton lines where
   * the title and text go, so the empty, failed or loaded page that follows
   * lands in the same place. The region is busy at once, and the tile and
   * lines come only after the loading delay, so a fast load never flashes
   * them. `title` ("Loading") is read by screen readers.
   */
  readonly isLoading?: boolean;
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
export function EmptyState({
  title,
  children,
  tone = 'empty',
  icon,
  actions,
  onRetry,
  isLoading = false,
}: EmptyStateProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  if (isLoading) {
    // Busy from the start, so screen readers hear the title at once; the
    // marks wait for the delay.
    return (
      <div className={styles.root} role="status" aria-busy="true">
        {showSkeleton && (
          <>
            <span className={styles.icon} />
            <span className={styles.lines}>
              <Skeleton lines={2} align="center" />
            </span>
          </>
        )}
        <VisuallyHidden>{title}</VisuallyHidden>
      </div>
    );
  }
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
