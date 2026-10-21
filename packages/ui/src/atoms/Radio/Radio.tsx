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
  /** A quiet word after the label, such as "(optional)" on a public form: muted, and part of the group's name. */
  readonly labelAside?: string;
  /** An InfoTip beside the question, when the choices need a word of help ("Who can see it"). */
  readonly info?: ReactNode;
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
  /** The `id` of the error line, so a control nearby can name it in `aria-describedby` (a submit it turns off). */
  readonly errorId?: string;
  readonly name?: string;
}

/** One of a few choices, all shown at once: a role, a plan, an export format. Arrow keys move between them. */
export function RadioGroup({
  label,
  isLabelHidden = false,
  labelAside,
  info,
  children,
  value,
  defaultValue,
  onChange,
  orientation = 'vertical',
  isDisabled = false,
  isReadOnly = false,
  error,
  errorId,
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
      {!isLabelHidden &&
        (info === undefined ? (
          <Label className={styles.legend}>
            {label}
            {labelAside !== undefined && (
              <>
                {' '}
                <span className={styles.aside}>{labelAside}</span>
              </>
            )}
          </Label>
        ) : (
          <span className={styles.legendRow}>
            <Label className={styles.legend}>
              {label}
              {labelAside !== undefined && (
                <>
                  {' '}
                  <span className={styles.aside}>{labelAside}</span>
                </>
              )}
            </Label>
            <span className={styles.info}>{info}</span>
          </span>
        ))}
      <span className={styles.choices} data-orientation={orientation}>
        {children}
      </span>
      {/* React Aria takes a given id over its own, and the group's aria-describedby follows it. */}
      <FieldError className={styles.error} {...(errorId === undefined ? {} : { id: errorId })}>
        {error}
      </FieldError>
    </AriaRadioGroup>
  );
}
