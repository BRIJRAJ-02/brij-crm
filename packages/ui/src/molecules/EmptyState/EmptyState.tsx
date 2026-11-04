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
  /** A sentence more, only when it names a step the actions don't, or says why there is none. */
  readonly children?: ReactNode;
  readonly tone?: EmptyStateTone;
  /**
   * A bare glyph over the title of a `block` or `fill` that is empty: what the surface is for, at a glance. Never
   * a tile, and never drawn in a `row`, which is one line of words. An error always draws its alert mark and a
   * locked state its lock, whatever this says.
   */
  readonly icon?: IconName;
  /**
   * A picture over the title, for a whole surface's first empty moment (Links, Forms, Link page): a drawing or
   * a mini preview of what will be here, centred over the title. It is decoration, hidden from screen readers (the
   * title says what is missing), so it never carries the only copy of anything. It takes `size-column` and no more;
   * the block, the title, the line and the action stay on one centre line. Ignored by `row` and while loading.
   */
  readonly illustration?: ReactNode;
  /** The next step: one button ("Add deal"), two at most. */
  readonly actions?: ReactNode;
  /**
   * For `error`: what "Try again" calls. An error always has Try again; with no `onRetry` it reloads the page,
   * the last resort, so a failure is never a dead end. Every screen that can load again passes its own.
   */
  readonly onRetry?: () => void;
  /**
   * What will show here is still loading: skeleton lines where the title and
   * text go, so the empty, failed or loaded page that follows lands in the
   * same place. The region is busy at once, and the lines come only after the
   * loading delay, so a fast load never flashes them. `title` ("Loading") is
   * read by screen readers.
   */
  readonly isLoading?: boolean;
  /**
   * `row` (the default) is one quiet line at a list row's height, at the start, in the list's place: the title in
   * secondary text and the action after it ("No matches", "Nothing sent yet"). Anything with content around it
   * takes a row: a list, a table, a card, a tab, a panel, a dialog. `block` is centred in its slot, for a whole
   * surface's true first run (a new object with no records) or a whole route's state (not found, deleted); `fill`
   * is the block grown to the height of its slot and centred in it (Bookings › List with nothing in it).
   */
  readonly layout?: 'row' | 'block' | 'fill';
}

const TONE_ICONS: Readonly<Record<Exclude<EmptyStateTone, 'empty'>, IconName>> = {
  error: 'circle-alert',
  locked: 'lock',
};

/** The last resort for a failure whose screen gave no retry: load the page again. */
function reloadPage() {
  window.location.reload();
}

/**
 * What a list, a panel or a view shows when it has nothing to show: empty, a
 * load that failed (always with Try again), or no access. By default one quiet
 * row in the list's place; a centred block only for a whole surface's first
 * run. An error looks different from emptiness: its mark and title in the
 * danger colour. Every component's empty, error and locked states are made
 * from it, with Skeleton for loading.
 */
export function EmptyState({
  title,
  children,
  tone = 'empty',
  icon,
  illustration,
  actions,
  onRetry,
  isLoading = false,
  layout = 'row',
}: EmptyStateProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  if (isLoading) {
    // Busy from the start, so screen readers hear the title at once; the
    // marks wait for the delay.
    return (
      <div className={styles.root} data-layout={layout} role="status" aria-busy="true">
        {showSkeleton &&
          (layout === 'row' ? (
            <span className={styles.lines}>
              <Skeleton width="medium" />
            </span>
          ) : (
            <span className={styles.lines}>
              <Skeleton lines={2} align="center" />
            </span>
          ))}
        <VisuallyHidden>{title}</VisuallyHidden>
      </div>
    );
  }
  const isRow = layout === 'row';
  // An error or a lock always shows its mark; an empty block shows its glyph only when given one, a row never.
  const mark = tone === 'empty' ? (isRow ? undefined : icon) : TONE_ICONS[tone];
  return (
    <div
      className={styles.root}
      data-tone={tone}
      data-layout={layout}
      // A row lays out by what it holds: a line of text drops under the title, and a mark takes a column of its own.
      data-has-text={children !== undefined || undefined}
      data-has-mark={mark !== undefined || undefined}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {illustration !== undefined && !isRow && tone === 'empty' ? (
        <span className={styles.illustration} aria-hidden="true">
          {illustration}
        </span>
      ) : (
        mark !== undefined && (
          <span className={styles.icon}>
            <Icon name={mark} size={isRow ? 'sm' : 'md'} />
          </span>
        )
      )}
      <span className={styles.title}>{title}</span>
      {children !== undefined && <span className={styles.text}>{children}</span>}
      {(actions !== undefined || tone === 'error') && (
        <span className={styles.actions}>
          {tone === 'error' && (
            <Button icon="refresh-cw" onPress={onRetry ?? reloadPage}>
              {strings.retry}
            </Button>
          )}
          {actions}
        </span>
      )}
    </div>
  );
}
