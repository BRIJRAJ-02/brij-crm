// NumberField (spec 0073, AC-7305): the prototype's NumberField as a thin wrapper over Field, so a count, an amount
// or a rate looks and reads like every other field and adds no CSS. It replaces the hand made numeric Fields
// (`inputMode="decimal"`, a unit suffix, parsing by hand) with one parser in the person's language and the keys a
// number field is expected to have.
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { Field } from '../Field/Field.tsx';
import {
  clampNumber,
  currencySymbol,
  formatNumber,
  parseNumber,
  roundToShown,
  stepNumber,
  type NumberFieldMode,
} from './number.ts';
import { strings } from './strings.ts';

/** Props for NumberField. */
export interface NumberFieldProps {
  readonly label: string;
  /** Keeps the label for screen readers only, where the row around it says what the number is. */
  readonly isLabelHidden?: boolean;
  /** The number, for a controlled field (`undefined` is an empty box); leave the prop out and the field keeps its own. */
  readonly value?: number | undefined;
  readonly defaultValue?: number;
  /** A committed value: on leaving the field, on Enter, on a step key or a step button. Never on each key typed. */
  readonly onChange?: (value: number | undefined) => void;
  readonly minValue?: number;
  readonly maxValue?: number;
  /** How far ↑, ↓ and the step buttons move it (Page Up and Page Down move ten). Defaults to 1. */
  readonly step?: number;
  /** `number` (the default), `currency` (its symbol in front, two decimals) or `percent` (0 to 100, "%" after). */
  readonly mode?: NumberFieldMode;
  /** The ISO 4217 code for `currency` ("USD", "EUR", "INR"); defaults to the workspace's. */
  readonly currency?: string;
  /** A unit after the value ("min", "seats"); `percent` always shows "%". */
  readonly unit?: string;
  /** The most decimals shown; the mode decides otherwise. */
  readonly maximumFractionDigits?: number;
  /** Minus and plus buttons at the end of the box, for a small count changed one at a time (guests, seats). */
  readonly showSteppers?: boolean;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  /** Why it is off, said as its tooltip. */
  readonly disabledReason?: string;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly name?: string;
  readonly size?: 'md' | 'sm' | 'lg';
  readonly autoFocus?: boolean;
}

/**
 * A number typed or stepped: ↑ and ↓ step it, Page Up and Page Down by ten steps, Home and End go to its limits.
 * Typing is free; the value is read in the person's language and written back neatly when they leave the field or
 * press Enter, and a text that isn't a number goes back to the last good value. Built on Field.
 */
export function NumberField(props: NumberFieldProps) {
  const {
    label,
    isLabelHidden = false,
    value,
    defaultValue,
    onChange,
    minValue = Number.NEGATIVE_INFINITY,
    maxValue = Number.POSITIVE_INFINITY,
    step = 1,
    mode = 'number',
    currency,
    unit,
    maximumFractionDigits,
    showSteppers = false,
    placeholder,
    hint,
    error,
    isRequired = false,
    isDisabled = false,
    isReadOnly = false,
    readOnlyReason,
    name,
    size = 'md',
    autoFocus = false,
    disabledReason,
  } = props;
  const settings = useFormatSettings();
  const { locale } = settings;
  const min = mode === 'percent' ? Math.max(0, minValue) : minValue;
  const max = mode === 'percent' ? Math.min(100, maxValue) : maxValue;
  const [own, setOwn] = useState<number | undefined>(defaultValue);
  // Controlled when the caller passes `value` at all (even `undefined`, an empty box); otherwise the field keeps its own.
  const current = Object.hasOwn(props, 'value') ? value : own;
  // A step's new value, said politely: a screen reader hears nothing else when ↑ changes a plain text box.
  const [stepped, setStepped] = useState('');
  const write = (number: number | undefined) =>
    number === undefined ? '' : formatNumber(number, locale, mode, step, maximumFractionDigits);
  // What the box shows while someone types; undefined shows the value, written neatly.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const commit = (next: number | undefined) => {
    setDraft(undefined);
    if (next === current) return;
    setOwn(next);
    onChange?.(next);
  };

  // A typed number as the field will show it: rounded to the decimals it shows, so what is saved is what is seen.
  const shown = (typed: number) => roundToShown(typed, mode, step, maximumFractionDigits);

  // Reads the draft: a number is held inside the limits, an empty box is no value, and anything else goes back.
  const settle = () => {
    if (draft === undefined) return;
    const parsed = parseNumber(draft, locale);
    if (parsed.kind === 'invalid') setDraft(undefined);
    else commit(parsed.kind === 'empty' ? undefined : clampNumber(shown(parsed.value), min, max));
  };

  // Where a step starts: what is typed if it reads, else the value, else the lower limit or nothing.
  const base = (): number => {
    const parsed = draft === undefined ? undefined : parseNumber(draft, locale);
    if (parsed?.kind === 'number') return shown(parsed.value);
    if (current !== undefined) return current;
    return Number.isFinite(min) ? min : 0;
  };

  const commitStep = (next: number) => {
    commit(next);
    setStepped(write(next));
  };

  const move = (steps: number) => {
    commitStep(stepNumber(base(), step, steps, min, max));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isReadOnly || isDisabled || event.altKey || event.metaKey || event.ctrlKey) return;
    const moves: Partial<Record<string, () => void>> = {
      ArrowUp: () => {
        move(1);
      },
      ArrowDown: () => {
        move(-1);
      },
      PageUp: () => {
        move(10);
      },
      PageDown: () => {
        move(-10);
      },
      ...(Number.isFinite(min)
        ? {
            Home: () => {
              commitStep(min);
            },
          }
        : {}),
      ...(Number.isFinite(max)
        ? {
            End: () => {
              commitStep(max);
            },
          }
        : {}),
    };
    const action = moves[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  const prefix = mode === 'currency' ? currencySymbol(currency ?? settings.currency ?? 'USD', locale) : undefined;
  const after = mode === 'percent' ? strings.percent : unit;
  const isLocked = isDisabled || isReadOnly;
  const steppers = showSteppers ? (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon="minus"
        label={strings.decrease(label)}
        isDisabled={isLocked || (current !== undefined && current <= min)}
        onPress={() => {
          move(-1);
          input.current?.focus();
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        icon="plus"
        label={strings.increase(label)}
        isDisabled={isLocked || (current !== undefined && current >= max)}
        onPress={() => {
          move(1);
          input.current?.focus();
        }}
      />
    </>
  ) : undefined;
  const suffix =
    after === undefined && steppers === undefined ? undefined : (
      <>
        {after}
        {steppers}
      </>
    );
  return (
    <>
      <Field
        label={label}
        isLabelHidden={isLabelHidden}
        value={draft ?? write(current)}
        onChange={setDraft}
        onBlur={settle}
        onSubmit={settle}
        onKeyDown={onKeyDown}
        inputMode={mode === 'currency' || step % 1 !== 0 || maximumFractionDigits !== undefined ? 'decimal' : 'numeric'}
        autoComplete="off"
        size={size}
        isRequired={isRequired}
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
        // The caller's choice, handed to Field, which focuses as React Aria expects (a list's search as it opens).
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus={autoFocus}
        ref={input}
        {...(prefix === undefined ? {} : { prefix })}
        {...(suffix === undefined ? {} : { suffix })}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(hint === undefined ? {} : { hint })}
        {...(error === undefined ? {} : { error })}
        {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
        {...(name === undefined ? {} : { name })}
        {...(disabledReason === undefined ? {} : { disabledReason })}
      />
      <VisuallyHidden isInline>
        <output aria-live="polite">{stepped}</output>
      </VisuallyHidden>
    </>
  );
}
