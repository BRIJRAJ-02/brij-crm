import type { Ref } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import styles from './CodeInput.module.css';

/** Props for CodeInput. */
export interface CodeInputProps {
  /** What the code is ("Code from your authenticator app"). */
  readonly label: string;
  /** How many characters the code has. */
  readonly length?: number;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  /** Called once every character is in. */
  readonly onComplete?: (code: string) => void;
  /** Why the code was refused, as a sentence that says what to do. */
  readonly error?: string;
  readonly isDisabled?: boolean;
  /** The one real input under the boxes, for moving focus to it (after a new code is sent). */
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * A one time code as separate boxes: two factor setup and sign in (#25). It is
 * one field underneath (`autocomplete="one-time-code"`), so pasting or the
 * phone's code suggestion fills every box at once.
 */
export function CodeInput({
  label,
  length = 6,
  value = '',
  onChange,
  onComplete,
  error,
  isDisabled = false,
  ref,
}: CodeInputProps) {
  const boxes = Array.from({ length }, (_, index) => value[index] ?? '');
  return (
    <TextField
      className={styles.root}
      value={value}
      maxLength={length}
      inputMode="numeric"
      autoComplete="one-time-code"
      isDisabled={isDisabled}
      isInvalid={error !== undefined}
      onChange={(next) => {
        const digits = next.replaceAll(/\D/g, '').slice(0, length);
        onChange?.(digits);
        if (digits.length === length) onComplete?.(digits);
      }}
    >
      <Label className={styles.label}>{label}</Label>
      <span className={styles.boxes}>
        <Input ref={ref} className={styles.input} />
        {boxes.map((character, index) => (
          <span
            key={index}
            className={styles.box}
            data-filled={character === '' ? undefined : ''}
            data-next={index === Math.min(value.length, length - 1) ? '' : undefined}
            aria-hidden="true"
          >
            {character}
          </span>
        ))}
      </span>
      <FieldError className={styles.error}>
        <Icon name="circle-alert" size="xs" />
        {error}
      </FieldError>
    </TextField>
  );
}
