import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import styles from './SpotIllustration.module.css';

/** What a spot illustration draws: a booking page, a form or a link page. */
export type SpotIllustrationKind = 'booking' | 'form' | 'link-page';

/** Props for SpotIllustration. */
export interface SpotIllustrationProps {
  readonly kind: SpotIllustrationKind;
}

/**
 * A small still drawing of what a screen holds once it has something: a booking page with one time picked, a form
 * with its button, or a link page with its rows. Made for EmptyState's `illustration` slot (spec 0058, AC-8). It is
 * decoration only, hidden from screen readers, never moves, and is drawn from Skeleton's still bars and the accent
 * tokens, so it follows the theme in light and dark.
 */
export function SpotIllustration({ kind }: SpotIllustrationProps) {
  return (
    <div className={styles.root} data-kind={kind} aria-hidden="true">
      {kind === 'booking' ? <BookingDrawing /> : kind === 'form' ? <FormDrawing /> : <LinkPageDrawing />}
    </div>
  );
}

function BookingDrawing() {
  return (
    <>
      <div className={styles.head}>
        <Skeleton shape="circle" size="xs" isStill />
        <Skeleton width="medium" isStill />
      </div>
      <div className={styles.slots}>
        <span className={styles.pill} />
        <span className={styles.pill} data-picked />
        <span className={styles.pill} />
      </div>
    </>
  );
}

function FormDrawing() {
  return (
    <>
      <Skeleton width="short" isStill />
      <span className={styles.field} />
      <span className={styles.field} />
      <span className={styles.button} />
    </>
  );
}

function LinkPageDrawing() {
  return (
    <>
      <div className={styles.profile}>
        <Skeleton shape="circle" size="sm" isStill />
        <Skeleton width="short" align="center" isStill />
      </div>
      <span className={styles.row} data-picked />
      <span className={styles.row} />
      <span className={styles.row} />
    </>
  );
}
