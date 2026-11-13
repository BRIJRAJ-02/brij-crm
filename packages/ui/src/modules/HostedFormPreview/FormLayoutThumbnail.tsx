import type { FormLayout, FormTemplatePreviewRow } from '@crm/contracts/forms';
import styles from './FormLayoutThumbnail.module.css';

/** Props for FormLayoutThumbnail. */
export interface FormLayoutThumbnailProps {
  /** The layout to draw. */
  readonly layout: FormLayout;
  /**
   * The answers to draw, in order, as shapes rather than controls (spec 0063, AC-6323): a one line box, a taller
   * box, stacked choices, stars, a row of numbers, a day, or a drop area. For a template's tile, where the point
   * is that a feedback form looks different from a signup one. Without it the layout itself decides, which is what
   * the three Layout tiles show.
   */
  readonly rows?: readonly FormTemplatePreviewRow[];
}

/** The shapes a layout draws on its own: Classic three one line answers, Steps two, One at a time one. */
function rowsOfLayout(layout: FormLayout): readonly FormTemplatePreviewRow[] {
  const fields = layout === 'classic' ? 3 : layout === 'steps' ? 2 : 1;
  return Array.from({ length: fields }, () => 'field' as const);
}

/** How many little marks a row draws: a rating's stars, a scale's numbers, a choice list's options. */
const MARKS: Partial<Record<FormTemplatePreviewRow, number>> = { rating: 5, scale: 7, choices: 3 };

/**
 * A form in miniature (spec 0063, AC-6302 and AC-6323), for TileGrid's picture slot: a small card of answers over
 * its button, with a progress line and a Back button when the layout has steps, and One at a time as one large
 * question on the slot's own ground. `rows` draws a particular form's answers (a template's tile); without it the
 * layout draws its own one line fields (the three Layout tiles). Shapes only, in the form's own tokens: it never
 * moves, takes no focus and is hidden from screen readers, because the tile's name and line say what it is.
 */
export function FormLayoutThumbnail({ layout, rows }: FormLayoutThumbnailProps) {
  const drawn = rows ?? rowsOfLayout(layout);
  return (
    <span className={styles.root} data-layout={layout} aria-hidden="true">
      {layout !== 'classic' && (
        <span className={styles.track}>
          <span className={styles.fill} />
        </span>
      )}
      {drawn.map((row, index) => (
        // A still drawing whose rows never reorder: their place is their key (AC-16).
        <span key={index} className={styles.field} data-row={row}>
          <span className={styles.label} />
          {MARKS[row] === undefined ? (
            <span className={styles.input} />
          ) : (
            <span className={styles.marks}>
              {Array.from({ length: MARKS[row] ?? 0 }, (_, mark) => (
                // Static marks: their place is their key (AC-16).
                <span key={mark} className={styles.mark} />
              ))}
            </span>
          )}
        </span>
      ))}
      <span className={styles.buttons}>
        {layout === 'steps' && <span className={styles.back} />}
        <span className={styles.button} />
      </span>
    </span>
  );
}
