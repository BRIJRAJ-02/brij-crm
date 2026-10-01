import type { ReactNode } from 'react';
import { FieldError, Label, RadioButton, RadioField, RadioGroup as AriaRadioGroup, Text } from 'react-aria-components';
import styles from './Radio.module.css';

/** Props for Radio. */
export interface RadioProps {
  /** The value it picks. */
  readonly value: string;
  /** Its label. */
  readonly children: string;
  /** A line under the label that says more. */
  readonly description?: string;
  readonly isDisabled?: boolean;
}

/** One choice in a RadioGroup. */
export function Radio({ value, children, description, isDisabled = false }: RadioProps) {
  return (
    <RadioField className={styles.field} value={value} isDisabled={isDisabled}>
      <RadioButton className={styles.radio}>
        <span className={styles.circle} aria-hidden="true">
          <span className={styles.dot} />
        </span>
        <span className={styles.label} data-described={description === undefined ? undefined : ''}>
          {children}
        </span>
      </RadioButton>
      {description !== undefined && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
    </RadioField>
  );
}

/** Props for RadioGroup. */
export interface RadioGroupProps {
  /** The question the choices answer. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** The Radio choices. */
  readonly children: ReactNode;
  readonly value?: string | null;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  /** `vertical` (the default) stacks them; `horizontal` puts a few short ones in a row. */
  readonly orientation?: 'vertical' | 'horizontal';
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  /** Why the choice is invalid, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly name?: string;
}

/** One of a few choices, all shown at once: a role, a plan, an export format. Arrow keys move between them. */
export function RadioGroup({
  label,
  isLabelHidden = false,
  children,
  value,
  defaultValue,
  onChange,
  orientation = 'vertical',
  isDisabled = false,
  isReadOnly = false,
  error,
  name,
}: RadioGroupProps) {
  return (
    <AriaRadioGroup
      className={styles.group}
      orientation={orientation}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isInvalid={error !== undefined}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(name === undefined ? {} : { name })}
    >
      {!isLabelHidden && <Label className={styles.legend}>{label}</Label>}
      <span className={styles.choices} data-orientation={orientation}>
        {children}
      </span>
      <FieldError className={styles.error}>{error}</FieldError>
    </AriaRadioGroup>
  );
}
