import type { FormLayout } from '@crm/contracts/forms';
import styles from './FormLayoutThumbnail.module.css';

/** Props for FormLayoutThumbnail. */
export interface FormLayoutThumbnailProps {
  /** The layout to draw. */
  readonly layout: FormLayout;
}

/**
 * A form's layout in miniature (spec 0063, AC-6302), for TileGrid's choice tiles: Classic as a card of three fields
 * over its button, Steps as a card with a progress line, two fields and Back beside Continue, and One at a time as
 * one large question with its OK and no card. Drawn in the form's own tokens, it never moves, takes no focus and is
 * hidden from screen readers: the tile's name says which layout it is.
 */
export function FormLayoutThumbnail({ layout }: FormLayoutThumbnailProps) {
  const fields = layout === 'classic' ? 3 : layout === 'steps' ? 2 : 1;
  return (
    <span className={styles.root} data-layout={layout} aria-hidden="true">
      {layout !== 'classic' && (
        <span className={styles.track}>
          <span className={styles.fill} />
        </span>
      )}
      {Array.from({ length: fields }, (_, index) => (
        <span key={index} className={styles.field}>
          <span className={styles.label} />
          <span className={styles.input} />
        </span>
      ))}
      <span className={styles.buttons}>
        {layout === 'steps' && <span className={styles.back} />}
        <span className={styles.button} />
      </span>
    </span>
  );
}
