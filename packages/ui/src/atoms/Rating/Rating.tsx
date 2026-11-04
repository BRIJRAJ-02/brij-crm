import { useId, type KeyboardEvent, type MouseEvent } from 'react';
import { RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { FieldError } from '../FieldError/FieldError.tsx';
import { FieldLabel } from '../FieldLabel/FieldLabel.tsx';
import { Icon } from '../Icon/Icon.tsx';
import { strings } from './strings.ts';
import styles from './Rating.module.css';

/** The number of stars. */
export const RATING_MAX = 5;

/** The stars, 1 to `count`. */
const starsOf = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

/** Props for Rating. */
export interface RatingProps {
  /** The attribute's name, read with the stars ("Fit"). */
  readonly label: string;
  /** From 1 to 5, or `null` for no rating. */
  readonly value?: number | null;
  readonly defaultValue?: number | null;
  /** Called with the new rating, or `null` when the chosen star is chosen again (clearing it). */
  readonly onChange?: (value: number | null) => void;
  /** Shows the stars only, as the rating attribute's display. */
  readonly isReadOnly?: boolean;
  readonly isDisabled?: boolean;
  /**
   * `cell` is the rating a grid cell edits: the cell draws the one focus
   * ring, so the chosen star draws none when focused (the lit stars already
   * show the draft the arrows move). With nothing chosen, the focused star
   * keeps its ring.
   */
  readonly variant?: 'default' | 'cell';
  /**
   * A form's question (a hosted form's Rating, spec 0063): the label shown over the stars as a radio group's
   * question is (with its "(optional)"), the stars a size up for a visitor's finger, and an error under them that
   * the group is described by. Left out, the label names the stars only, as in a cell or a panel.
   */
  readonly field?: {
    readonly aside?: string | undefined;
    readonly error?: string | undefined;
    readonly isLabelHidden?: boolean;
    /**
     * What the first and last star mean, under the row at its two ends ("Poor", "Excellent"), read with the
     * group: a form's Rating, as a Scale's end words are.
     */
    readonly ends?: { readonly start?: string | undefined; readonly end?: string | undefined };
  };
  /** How many stars, 3 to 10 (a form's Rating sets it); 5 when left out, the rating attribute's. */
  readonly count?: number;
}

/**
 * One to five stars: the rating attribute's display (read only) and its editor
 * (a radio group). Choosing the chosen star again, or Delete, clears it.
 */
export function Rating({
  label,
  value,
  defaultValue,
  onChange,
  isReadOnly = false,
  isDisabled = false,
  variant = 'default',
  field,
  count = RATING_MAX,
}: RatingProps) {
  const current = value ?? defaultValue ?? null;
  const all = starsOf(Math.min(10, Math.max(3, Math.round(count))));
  const endsId = useId();
  const ends = field?.ends;
  const hasEnds = ends !== undefined && (ends.start !== undefined || ends.end !== undefined);
  if (isReadOnly) {
    return (
      <span className={styles.root} role="img" aria-label={strings.rated(label, current, all.length)}>
        {all.map((star) => (
          <span key={star} className={styles.star} data-on={current !== null && star <= current ? '' : undefined}>
            <Icon name="star" size="sm" isFilled />
          </span>
        ))}
      </span>
    );
  }

  const clearIfCurrent = (event: MouseEvent<HTMLElement>) => {
    const input = (event.target as Element).closest('label')?.querySelector('input');
    if (input?.checked === true && Number(input.value) === current) {
      event.preventDefault();
      onChange?.(null);
    }
  };
  const clearOnDelete = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') onChange?.(null);
  };

  const stars = all.map((star) => (
    <RadioField key={star} value={String(star)} aria-label={strings.stars(star)} className={styles.field}>
      <RadioButton className={styles.choice} data-on={current !== null && star <= current ? '' : undefined}>
        <Icon name="star" size={field === undefined ? 'sm' : 'lg'} isFilled />
      </RadioButton>
    </RadioField>
  ));

  return (
    // Clicks and keys bubble here from the stars; the group itself stays the radio group.
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions
    <span className={styles.wrap} onClickCapture={clearIfCurrent} onKeyDown={clearOnDelete}>
      <RadioGroup
        className={field === undefined ? styles.root : styles.form}
        data-variant={variant}
        {...(field === undefined || field.isLabelHidden === true ? { 'aria-label': label } : {})}
        {...(hasEnds ? { 'aria-describedby': endsId } : {})}
        orientation="horizontal"
        isDisabled={isDisabled}
        isInvalid={field?.error !== undefined}
        value={current === null ? null : String(current)}
        onChange={(next) => {
          onChange?.(Number(next));
        }}
      >
        {field === undefined ? (
          stars
        ) : (
          <>
            {field.isLabelHidden !== true && <FieldLabel label={label} aside={field.aside} tone="strong" />}
            <span className={styles.root}>{stars}</span>
            {hasEnds && (
              <span id={endsId} className={styles.ends}>
                <span>{ends.start}</span>
                <span>{ends.end}</span>
              </span>
            )}
            {field.error !== undefined && <FieldError>{field.error}</FieldError>}
          </>
        )}
      </RadioGroup>
    </span>
  );
}
