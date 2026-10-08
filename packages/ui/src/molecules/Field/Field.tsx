import type { ReactNode, Ref } from 'react';
import { FieldError, Input, Label, Text, TextArea, TextField } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './Field.module.css';
import { strings } from './strings.ts';

/** `md` (the default) is the 30px input of forms and panels; `sm` is the 26px of a cell editor or a toolbar. */
export type FieldSize = 'md' | 'sm';

/** `default` is the boxed field; `search` the rounded search field; `cell` the bare input a grid cell edits in. */
export type FieldVariant = 'default' | 'search' | 'cell';

/** Props for Field. */
export interface FieldProps {
  /** What the field is ("Domain"). Always given; `isLabelHidden` keeps it for screen readers only (cell editors). */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly onBlur?: () => void;
  /** Enter in a single line field (a cell commits on it). */
  readonly onSubmit?: () => void;
  /** Esc (a cell or a popover cancels on it). */
  readonly onEscape?: () => void;
  /** Hint text in the empty field: "Set Domain…". Never the only place an instruction lives; use `hint`. */
  readonly placeholder?: string;
  /** A line under the field that helps: the expected format, what it's for. */
  readonly hint?: string;
  /** What's wrong, as a sentence that says how to fix it. Marks the field invalid. */
  readonly error?: string;
  /** A unit or a picker at the start of the box: `USD`, `%`, a currency Select. */
  readonly prefix?: ReactNode;
  /** Something at the end of the box: a clear button, a picker trigger. */
  readonly suffix?: ReactNode;
  /** A leading icon (the search variant shows `search`). */
  readonly icon?: IconName;
  /** A textarea that grows with its content (long text). */
  readonly isMultiline?: boolean;
  /** Shows "12/500" and stops typing at `maxLength`. */
  readonly maxLength?: number;
  readonly showCounter?: boolean;
  readonly isReadOnly?: boolean;
  /** Why it is read only, shown as the hint ("Set by the system when the record is created."). */
  readonly readOnlyReason?: string;
  readonly isDisabled?: boolean;
  /** Who can change it, shown as the hint. */
  readonly disabledReason?: string;
  /** The `id` of the line under the field (its hint or reason), so a control nearby can name it in `aria-describedby`. */
  readonly descriptionId?: string;
  readonly isRequired?: boolean;
  readonly type?: 'text' | 'email' | 'url' | 'tel' | 'search' | 'password';
  readonly inputMode?: 'text' | 'decimal' | 'numeric' | 'email' | 'tel' | 'url' | 'search';
  readonly autoComplete?: string;
  readonly name?: string;
  readonly size?: FieldSize;
  /**
   * `search` is the rounded field with a search icon, for filtering a list.
   * `cell` is the input a grid cell becomes while it edits: no box of its own,
   * the cell's height and padding, and no focus ring, since the cell draws the
   * one ring (and the danger edge while the value is refused).
   */
  readonly variant?: FieldVariant;
  /** Where the typed text sits: `end` for numbers, which a cell aligns to its end. */
  readonly align?: 'start' | 'end';
  /** The error floats under the input, over what follows: in a grid cell, which is one line tall. */
  readonly isErrorFloating?: boolean;
  /** Takes focus as it mounts: a search field at the top of a list that just opened. */
  readonly autoFocus?: boolean;
  readonly ref?: Ref<HTMLInputElement & HTMLTextAreaElement>;
}

/**
 * The one field design: an 11px label above a 30px input with a hairline
 * outline, a hint or an error below. Every text, number and link attribute is
 * typed through it, in a form, the record panel, a cell or a filter. Built on
 * React Aria's TextField, so the label, hint and error are wired for screen
 * readers.
 */
export function Field({
  label,
  isLabelHidden = false,
  value,
  defaultValue,
  onChange,
  onBlur,
  onSubmit,
  onEscape,
  placeholder,
  hint,
  error,
  prefix,
  suffix,
  icon,
  isMultiline = false,
  maxLength,
  showCounter = false,
  isReadOnly = false,
  readOnlyReason,
  isDisabled = false,
  disabledReason,
  descriptionId,
  isRequired = false,
  type = 'text',
  inputMode,
  autoComplete,
  name,
  size = 'md',
  variant = 'default',
  align = 'start',
  isErrorFloating = false,
  autoFocus = false,
  ref,
}: FieldProps) {
  const { locale } = useFormatSettings();
  const reason = (isReadOnly ? readOnlyReason : undefined) ?? (isDisabled ? disabledReason : undefined);
  const length = (value ?? defaultValue ?? '').length;
  const leading = variant === 'search' ? 'search' : icon;
  const inputProps = {
    className: styles.input,
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(ref === undefined ? {} : { ref }),
    // A list's search field takes focus as the list opens, the pattern React Aria expects.
    ...(autoFocus ? { autoFocus: true } : {}),
  };
  return (
    <TextField
      className={styles.root}
      data-size={size}
      data-variant={variant}
      data-align={align === 'end' ? 'end' : undefined}
      data-error-floats={isErrorFloating || undefined}
      isReadOnly={isReadOnly}
      isDisabled={isDisabled}
      isRequired={isRequired}
      // The library shows its own copy, never the browser's: `error` here, or
      // a refusal a Form maps to this field's `name`. Only a given `error`
      // sets invalid, so a Form's refusal can still show.
      validationBehavior="aria"
      {...(error === undefined ? {} : { isInvalid: true })}
      type={type}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(onBlur === undefined ? {} : { onBlur })}
      {...(onSubmit === undefined && onEscape === undefined
        ? {}
        : {
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !isMultiline && onSubmit !== undefined) onSubmit();
              else if (event.key === 'Escape' && onEscape !== undefined) onEscape();
              else event.continuePropagation();
            },
          })}
      {...(maxLength === undefined ? {} : { maxLength })}
      {...(inputMode === undefined ? {} : { inputMode })}
      {...(autoComplete === undefined ? {} : { autoComplete })}
      {...(name === undefined ? {} : { name })}
    >
      {({ isInvalid }) => {
        // An error takes the hint's place, so the field never carries two
        // lines under it; a read only or disabled reason always shows.
        const description = reason ?? (isInvalid ? undefined : hint);
        return (
          <>
            {!isLabelHidden && <Label className={styles.label}>{label}</Label>}
            <span className={styles.box} data-multiline={isMultiline || undefined}>
              {leading !== undefined && <Icon name={leading} size="sm" tone="muted" />}
              {prefix !== undefined && <span className={styles.prefix}>{prefix}</span>}
              {isMultiline ? <TextArea {...inputProps} /> : <Input {...inputProps} />}
              {isReadOnly && (
                <span className={styles.lock}>
                  <Icon name="lock" size="xs" label={strings.readOnly} />
                </span>
              )}
              {suffix !== undefined && <span className={styles.suffix}>{suffix}</span>}
            </span>
            {(description !== undefined || (showCounter && maxLength !== undefined)) && (
              <span className={styles.foot}>
                {description !== undefined && (
                  <Text
                    slot="description"
                    className={styles.hint}
                    // React Aria takes a given id over its own, and the input's
                    // aria-describedby follows it.
                    {...(descriptionId === undefined ? {} : { id: descriptionId })}
                  >
                    {description}
                  </Text>
                )}
                {showCounter && maxLength !== undefined && (
                  <span className={styles.counter} aria-hidden="true">
                    {strings.counter(
                      new Intl.NumberFormat(locale).format(length),
                      new Intl.NumberFormat(locale).format(maxLength),
                    )}
                  </span>
                )}
              </span>
            )}
            <FieldError className={styles.error}>
              {({ validationErrors }) => (
                <>
                  <Icon name="circle-alert" size="xs" />
                  {error ?? validationErrors.join(' ')}
                </>
              )}
            </FieldError>
          </>
        );
      }}
    </TextField>
  );
}
