import { use, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { FieldError, Input, Label, Text, TextArea, TextField } from 'react-aria-components';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { keepInside } from '../../lib/float-inside.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { InPopover } from '../Popover/Popover.tsx';
import styles from './Field.module.css';
import { strings } from './strings.ts';

/** How far toward `maxLength` the text goes before the counter shows: until then a count is only noise. */
export const COUNTER_FROM = 0.9;

/** `md` (the default) is the 30px input of forms and panels; `sm` is the 26px of a cell editor or a toolbar. */
export type FieldSize = 'md' | 'sm';

/**
 * `default` is the boxed field; `search` the rounded search field; `cell` the bare input a grid cell edits in;
 * `copy` a value to copy, never to change: a public link, an embed code; `title` a page's own title (a note's),
 * with no box at all.
 */
export type FieldVariant = 'default' | 'search' | 'cell' | 'copy' | 'title';

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
  /**
   * A one line value that wraps as it grows (a task's title): one line tall
   * at rest, growing a line at a time; Enter calls `onSubmit` rather than
   * breaking the line, and a pasted line break becomes a space.
   */
  readonly isWrapping?: boolean;
  /** Stops typing at `maxLength`. */
  readonly maxLength?: number;
  /** Counts toward `maxLength` ("1,812/2,000"), shown once the text is near it (`COUNTER_FROM` of the way). */
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
   * `copy` shows a value to copy and never to change (a public link): read
   * only, but drawn as a live field with no lock, a Copy button at its end,
   * and the whole value selected when it takes focus.
   * `title` is a page's own title, such as a note's: no box, border, fill or
   * ring, in the note title type, so it reads as the page's heading; the caret
   * marks focus, as in a document. Read only, it stays plain text (no lock).
   */
  readonly variant?: FieldVariant;
  /** The `copy` variant's button name ("Copy link"); "Copy" when left out. */
  readonly copyLabel?: string;
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
  isWrapping = false,
  maxLength,
  showCounter = false,
  isReadOnly: isReadOnlyGiven = false,
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
  copyLabel,
  align = 'start',
  isErrorFloating = false,
  autoFocus = false,
  ref,
}: FieldProps) {
  const { locale } = useFormatSettings();
  // In a popover the popover's edge frames the field, so its focus is the accent edge alone.
  const isInPopover = use(InPopover);
  const isCopy = variant === 'copy';
  // A value to copy is never typed over.
  const isReadOnly = isReadOnlyGiven || isCopy;
  const reason = (isReadOnly ? readOnlyReason : undefined) ?? (isDisabled ? disabledReason : undefined);
  const length = (value ?? defaultValue ?? '').length;
  const leading = variant === 'search' ? 'search' : icon;
  // A floating error stays inside what would clip it: in from the grid's end
  // edge in its last column, no wider than a phone's grid, over the cell when
  // the rows below run out. Placed again as the error or the window changes.
  const errorRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = errorRef.current;
    const anchor = element?.parentElement;
    const view = element?.ownerDocument.defaultView;
    if (!isErrorFloating || element === null || !anchor || !view) return;
    const place = () => {
      keepInside(element, anchor);
    };
    place();
    view.addEventListener('resize', place);
    return () => {
      view.removeEventListener('resize', place);
    };
  }, [isErrorFloating, error]);
  const isTextArea = isMultiline || isWrapping;
  // The limit, once the text is near enough to it that a count helps.
  const countedMax =
    showCounter && maxLength !== undefined && length >= maxLength * COUNTER_FROM ? maxLength : undefined;
  const inputProps = {
    className: styles.input,
    // A multiline value to copy is code: it takes the Code atom's face.
    ...(isCopy && isMultiline ? { 'data-code': true } : {}),
    // Autofill off (a contact's phone, a search): password managers leave the field alone too, as browsers do.
    ...(autoComplete === 'off'
      ? { 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-bwignore': true, 'data-form-type': 'other' }
      : {}),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(ref === undefined ? {} : { ref }),
    // A list's search field takes focus as the list opens, the pattern React Aria expects.
    ...(autoFocus ? { autoFocus: true } : {}),
    // A value to copy is taken whole: focusing it selects all of it, ready for ⌘C.
    ...(isCopy
      ? {
          // After the press that focused it, whose mouseup would otherwise drop the selection.
          onFocus: (event: { readonly currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          },
        }
      : {}),
    // A wrapping field starts one line tall; its CSS grows it with its text.
    ...(isWrapping ? { rows: 1 } : {}),
  };
  return (
    <TextField
      className={styles.root}
      data-size={size}
      data-variant={variant}
      data-align={align === 'end' ? 'end' : undefined}
      data-error-floats={isErrorFloating || undefined}
      data-in-popover={isInPopover || undefined}
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
      {...(onChange === undefined
        ? {}
        : {
            // A wrapping field holds one line: a pasted line break joins the lines with a space.
            onChange: isWrapping
              ? (next: string) => {
                  onChange(next.replace(/\s*[\r\n]+\s*/g, ' '));
                }
              : onChange,
          })}
      {...(onBlur === undefined ? {} : { onBlur })}
      {...(onSubmit === undefined && onEscape === undefined && !isWrapping
        ? {}
        : {
            onKeyDown: (event) => {
              // Enter or Esc that ends an input method's composition (a CJK word) is neither a submit nor a cancel
              // (Safari sends the last key as 229).
              if (
                (event.key === 'Enter' || event.key === 'Escape') &&
                // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari marks the composition's last key only by keyCode 229
                (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
              ) {
                event.continuePropagation();
              } else if (event.key === 'Enter' && isWrapping) {
                // Never a line break in a one line value: Enter submits, as in a single line field.
                event.preventDefault();
                onSubmit?.();
              } else if (event.key === 'Enter' && !isMultiline && onSubmit !== undefined) onSubmit();
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
            <span
              className={styles.box}
              data-multiline={isMultiline || undefined}
              data-wrapping={(isWrapping && !isMultiline) || undefined}
            >
              {leading !== undefined && <Icon name={leading} size="sm" tone="muted" />}
              {prefix !== undefined && <span className={styles.prefix}>{prefix}</span>}
              {isTextArea ? <TextArea {...inputProps} /> : <Input {...inputProps} />}
              {isReadOnly && !isCopy && variant !== 'title' && (
                <span className={styles.lock}>
                  <Icon name="lock" size="xs" label={strings.readOnly} />
                </span>
              )}
              {suffix !== undefined && <span className={styles.suffix}>{suffix}</span>}
              {isCopy && (
                <span className={styles.copy}>
                  <CopyButton
                    value={value ?? defaultValue ?? ''}
                    isIconOnly
                    variant="ghost"
                    {...(copyLabel === undefined ? {} : { label: copyLabel })}
                  />
                </span>
              )}
            </span>
            {(description !== undefined || countedMax !== undefined) && (
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
                {countedMax !== undefined && (
                  <span className={styles.counter} aria-hidden="true">
                    {strings.counter(
                      new Intl.NumberFormat(locale).format(length),
                      new Intl.NumberFormat(locale).format(countedMax),
                    )}
                  </span>
                )}
              </span>
            )}
            <FieldError ref={errorRef} className={styles.error}>
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
