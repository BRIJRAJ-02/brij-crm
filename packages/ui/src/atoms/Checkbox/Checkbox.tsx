import { CheckboxButton, CheckboxField, FieldError, Text } from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Checkbox.module.css';

/** Props for Checkbox. */
export interface CheckboxProps {
  /** What checking it means, in sentence case. Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** A line under the label that says more. */
  readonly description?: string;
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
  readonly value?: string;
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
  isSelected,
  defaultSelected,
  onChange,
  isIndeterminate = false,
  isDisabled = false,
  isReadOnly = false,
  error,
  name,
  value,
}: CheckboxProps) {
  return (
    <CheckboxField
      className={styles.field}
      isIndeterminate={isIndeterminate}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isInvalid={error !== undefined}
      {...(isSelected === undefined ? {} : { isSelected })}
      {...(defaultSelected === undefined ? {} : { defaultSelected })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(name === undefined ? {} : { name })}
      {...(value === undefined ? {} : { value })}
    >
      <CheckboxButton className={styles.root}>
        {({ isSelected: checked, isIndeterminate: partial }) => (
          <>
            <span className={styles.box} aria-hidden="true">
              {partial ? <Icon name="minus" size="xs" /> : checked && <Icon name="check" size="xs" />}
            </span>
            {isLabelHidden ? (
              <VisuallyHidden>{label}</VisuallyHidden>
            ) : (
              <span className={styles.label} data-described={description === undefined ? undefined : ''}>
                {label}
              </span>
            )}
          </>
        )}
      </CheckboxButton>
      {description !== undefined && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
      <FieldError className={styles.error}>{error}</FieldError>
    </CheckboxField>
  );
}
