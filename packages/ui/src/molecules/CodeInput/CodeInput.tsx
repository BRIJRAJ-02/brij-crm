import { useState, type Ref } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import styles from './CodeInput.module.css';

/**
 * How big the boxes are: `md` (the default) `size-input` wide, in a dialog or
 * a settings card; `lg` sharing the row and taller, split three and three, on
 * a page whose task is the code (sign in).
 */
export type CodeInputSize = 'md' | 'lg';

/** Props for CodeInput. */
export interface CodeInputProps {
  /** What the code is ("Code from your authenticator app"). */
  readonly label: string;
  /** Keeps the label for screen readers only, when a sentence above the boxes already says what they are for. */
  readonly isLabelHidden?: boolean;
  /** How many characters the code has. */
  readonly length?: number;
  /** `md` (the default) or `lg`, the boxes sharing the row on a sign in page. */
  readonly size?: CodeInputSize;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  /** Called once every character is in. */
  readonly onComplete?: (code: string) => void;
  /** Why the code was refused, as a sentence that says what to do. */
  readonly error?: string;
  readonly isDisabled?: boolean;
  /** The one real input under the boxes, for moving focus to it (after a new code is sent). */
  readonly ref?: Ref<HTMLInputElement>;
  /**
   * The error's sentence, made focusable from code only (`tabIndex={-1}`), so
   * a screen can move focus to it when the boxes turn off with it (a spent
   * code) and focus would otherwise be lost.
   */
  readonly errorRef?: Ref<HTMLSpanElement>;
}

/**
 * A one time code as separate boxes: two factor setup and sign in (#25). It is
 * one field underneath (`autocomplete="one-time-code"`), so pasting or the
 * phone's code suggestion fills every box at once.
 */
export function CodeInput({
  label,
  isLabelHidden = false,
  length = 6,
  size = 'md',
  value = '',
  onChange,
  onComplete,
  error,
  isDisabled = false,
  ref,
  errorRef,
}: CodeInputProps) {
  const boxes = Array.from({ length }, (_, index) => value[index] ?? '');
  // The large boxes split in two even halves, as a code is read out (481 593).
  const half = size === 'lg' && length % 2 === 0 ? length / 2 : undefined;
  // React Aria's TextField says nothing of focus on its root, so the field tracks its one input itself.
  const [isFocused, setFocused] = useState(false);
  return (
    <TextField
      className={styles.root}
      data-size={size}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
      value={value}
      // No maxLength: a pasted "481 593" or "481-593" is longer than the code, and the browser would cut it
      // before the separator is dropped. Every change keeps the digits only, up to `length`.
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
      {!isLabelHidden && <Label className={styles.label}>{label}</Label>}
      <span className={styles.boxes} data-focused={isFocused || undefined}>
        <Input
          ref={ref}
          className={styles.input}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
        />
        {boxes.map((character, index) => (
          <span
            key={index}
            className={styles.box}
            data-filled={character === '' ? undefined : ''}
            data-half={index === half ? '' : undefined}
            data-next={index === Math.min(value.length, length - 1) ? '' : undefined}
            aria-hidden="true"
          >
            {character}
          </span>
        ))}
      </span>
      <FieldError className={styles.error}>
        <Icon name="circle-alert" size="xs" />
        {errorRef === undefined ? (
          error
        ) : (
          <span ref={errorRef} className={styles.message} tabIndex={-1}>
            {error}
          </span>
        )}
      </FieldError>
    </TextField>
  );
}
