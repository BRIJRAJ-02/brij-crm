import type { ReactNode } from 'react';
import { CheckboxButton, CheckboxField, Text } from 'react-aria-components';
import { FieldError } from '../FieldError/FieldError.tsx';
import { Icon } from '../Icon/Icon.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Checkbox.module.css';
import { strings } from './strings.ts';

const classes = (own: string | undefined, added: string | undefined) =>
  added === undefined ? own : `${own ?? ''} ${added}`;

/** Props for Checkbox. */
export interface CheckboxProps {
  /** What checking it means, in sentence case. Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** A line under the label that says more; at the row's end in `CheckboxRow` (an add-on's +£1.50). */
  readonly description?: string;
  /** A variant's classes, from its own stylesheet: `CheckboxRow` passes its row here. */
  readonly look?: Readonly<Record<string, string | undefined>>;
  readonly isSelected?: boolean;
  readonly defaultSelected?: boolean;
  readonly onChange?: (isSelected: boolean) => void;
  /** Some but not all of what it stands for are checked ("select all" in a table). */
  readonly isIndeterminate?: boolean;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  /** Why it is invalid, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly name?: string;
  /**
   * `selection` inside a selectable Table: the table then owns whether it is
   * checked (and indeterminate, in the header), so leave those props out.
   */
  readonly slot?: 'selection';
  readonly value?: string;
  /**
   * Something after the box, inside the control so pressing it toggles, hidden from screen readers (the label says
   * it): a calendar's colour dot and name (a StatusDot, with `isLabelHidden`), which shrinks and cuts its name with
   * an ellipsis when the row is narrow.
   */
  readonly leading?: ReactNode;
}

/**
 * A real checkbox: a 16px box with a drawn tick, an indeterminate dash, a
 * label and an optional description. It is also the checkbox attribute's one
 * display and editor, toggling in place.
 */
export function Checkbox({
  label,
  isLabelHidden = false,
  description,
  look,
  isSelected,
  defaultSelected,
  onChange,
  isIndeterminate,
  isDisabled = false,
  isReadOnly = false,
  error,
  name,
  value,
  slot,
  leading,
}: CheckboxProps) {
  return (
    <CheckboxField
      className={classes(styles.field, look?.field)}
      data-variant={look === undefined ? undefined : 'row'}
      {...(isIndeterminate === undefined ? {} : { isIndeterminate })}
      {...(slot === undefined ? {} : { slot })}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isInvalid={error !== undefined}
      {...(isSelected === undefined ? {} : { isSelected })}
      {...(defaultSelected === undefined ? {} : { defaultSelected })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(name === undefined ? {} : { name })}
      {...(value === undefined ? {} : { value })}
    >
      <CheckboxButton className={classes(styles.root, look?.root)}>
        {({ isIndeterminate: partial }) => (
          <>
            <span className={classes(styles.box, look?.box)} aria-hidden="true">
              {/* The tick is always there and drawn in by its clip when checked (transitions.dev 25), so it draws
                  on a change and never on the first paint. */}
              {partial ? (
                <Icon name="minus" size="sm" />
              ) : (
                <span className={styles.tick}>
                  <Icon name="check" size="sm" />
                </span>
              )}
            </span>
            {leading !== undefined && (
              <span className={styles.leading} aria-hidden="true">
                {leading}
              </span>
            )}
            {isLabelHidden ? (
              <VisuallyHidden>{label}</VisuallyHidden>
            ) : (
              <span
                className={classes(styles.label, look?.label)}
                data-described={description === undefined ? undefined : ''}
              >
                {label}
              </span>
            )}
          </>
        )}
      </CheckboxButton>
      {description !== undefined && (
        <Text slot="description" className={classes(styles.description, look?.description)}>
          {description}
        </Text>
      )}
      {error !== undefined && <FieldError inset="check">{error}</FieldError>}
    </CheckboxField>
  );
}

/** Props for CheckboxMark. */
export interface CheckboxMarkProps {
  /**
   * What the mark stands for; screen readers hear it with the state ("Is customer, checked"). Left out, the mark says
   * nothing: the row it sits in already names itself and its state (an option in a Select).
   */
  readonly label?: string;
  readonly isSelected: boolean;
  readonly isIndeterminate?: boolean;
  readonly isReadOnly?: boolean;
}

/**
 * Checkbox's look with no control of its own, for a grid of hundreds where the
 * cell is the control: Space and a click on the cell toggle it, so each row
 * needs no React Aria checkbox while it scrolls past.
 */
export function CheckboxMark({ label, isSelected, isIndeterminate = false, isReadOnly = false }: CheckboxMarkProps) {
  const state = isIndeterminate ? strings.mixed : isSelected ? strings.checked : strings.notChecked;
  return (
    <span
      className={styles.root}
      data-selected={isSelected || undefined}
      data-indeterminate={isIndeterminate || undefined}
      data-readonly={isReadOnly || undefined}
    >
      <span className={styles.box} aria-hidden="true">
        {isIndeterminate ? <Icon name="minus" size="sm" /> : isSelected && <Icon name="check" size="sm" />}
      </span>
      {label !== undefined && (
        <VisuallyHidden>
          {label}
          {state}
        </VisuallyHidden>
      )}
    </span>
  );
}
