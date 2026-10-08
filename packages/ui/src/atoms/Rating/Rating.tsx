import type { KeyboardEvent, MouseEvent } from 'react';
import { RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import { strings } from './strings.ts';
import styles from './Rating.module.css';

/** The number of stars. */
export const RATING_MAX = 5;

const STARS = Array.from({ length: RATING_MAX }, (_, index) => index + 1);

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
   * ring, so the focused star draws none (the lit stars already show the
   * draft the arrows move).
   */
  readonly variant?: 'default' | 'cell';
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
}: RatingProps) {
  const current = value ?? defaultValue ?? null;
  if (isReadOnly) {
    return (
      <span className={styles.root} role="img" aria-label={strings.rated(label, current)}>
        {STARS.map((star) => (
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

  return (
    // Clicks and keys bubble here from the stars; the group itself stays the radio group.
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions
    <span className={styles.wrap} onClickCapture={clearIfCurrent} onKeyDown={clearOnDelete}>
      <RadioGroup
        className={styles.root}
        data-variant={variant}
        aria-label={label}
        orientation="horizontal"
        isDisabled={isDisabled}
        value={current === null ? null : String(current)}
        onChange={(next) => {
          onChange?.(Number(next));
        }}
      >
        {STARS.map((star) => (
          <RadioField key={star} value={String(star)} aria-label={strings.stars(star)} className={styles.field}>
            <RadioButton className={styles.choice} data-on={current !== null && star <= current ? '' : undefined}>
              <Icon name="star" size="sm" isFilled />
            </RadioButton>
          </RadioField>
        ))}
      </RadioGroup>
    </span>
  );
}
