// The editor every typed attribute shares: one Field, a draft checked on
// commit (Enter, blur), and Esc to cancel. Types pass how text becomes their
// value; nothing invalid ever leaves (AC-5).
import type { AttributeType } from '@crm/contracts/values';
import type { ReactNode } from 'react';
import { Field, type FieldProps } from '../molecules/Field/Field.tsx';
import { strings as fieldStrings } from '../molecules/Field/strings.ts';
import { useTextDraft } from './useTextDraft.ts';
import type { EditorProps } from './types.ts';
import type { Committable } from './values.ts';
import { escapesHere, isCompactSurface } from './values.ts';

/** Props for TextLikeEditor. */
export interface TextLikeEditorProps<T extends AttributeType> extends EditorProps<T> {
  /** The value as it is typed. */
  readonly initial: string;
  /** Typed text to a committable value, or the sentence to show. */
  readonly check: (draft: string) => Committable<T>;
  readonly inputMode?: FieldProps['inputMode'];
  readonly type?: FieldProps['type'];
  readonly hint?: string;
  /**
   * The hint for the text being typed, before it saves: a number shows what "1.2k" saves as. Undefined falls back
   * to `hint`. Only where a hint shows (outside a cell, a panel row and a filter).
   */
  readonly hintOf?: (draft: string) => string | undefined;
  /**
   * The type's example ("ada@example.com"), shown in the empty field of a
   * form or a preview. A cell, a panel row or a filter hides the label, so it
   * keeps "Set <Attribute>…" there, and the refusal names the example.
   */
  readonly placeholder?: string;
  readonly prefix?: ReactNode;
  /** A unit after the text: a percent number's sign. */
  readonly suffix?: ReactNode;
  readonly isMultiline?: boolean;
  readonly maxLength?: number;
  /** Where the typed text sits in a cell: `end` for numbers and amounts, as their display does. */
  readonly align?: 'start' | 'end';
}

/** One Field that commits a checked value: cells commit on Enter, forms and panels on blur. */
export function TextLikeEditor<T extends AttributeType>({
  attribute,
  surface,
  onCommit,
  onCancel,
  error,
  initial,
  check,
  inputMode,
  type,
  hint,
  hintOf,
  placeholder,
  prefix,
  suffix,
  isMultiline = false,
  maxLength,
  startText,
  align = 'start',
  isDisabled = false,
}: TextLikeEditorProps<T>) {
  const { fieldProps, cancel } = useTextDraft<T>({
    initial: startText ?? initial,
    isChanged: startText !== undefined,
    check,
    onCommit,
    ...(onCancel === undefined ? {} : { onCancel }),
    ...(error === undefined ? {} : { error }),
  });
  const isCompact = isCompactSurface(surface);
  const shownHint = isCompact ? hint : (hintOf?.(fieldProps.value) ?? hint);
  return (
    <Field
      label={attribute.name}
      isLabelHidden={isCompact}
      size={isCompact ? 'sm' : 'md'}
      // In a grid cell the cell becomes the input; elsewhere it is the boxed field.
      variant={surface === 'cell' && !isMultiline ? 'cell' : 'default'}
      align={surface === 'cell' ? align : 'start'}
      placeholder={isCompact || placeholder === undefined ? fieldStrings.setAttribute(attribute.name) : placeholder}
      isRequired={attribute.isRequired}
      isMultiline={isMultiline}
      showCounter={isMultiline && maxLength !== undefined}
      isErrorFloating={surface === 'cell'}
      isDisabled={isDisabled}
      // A record's value, never the viewer's own: no browser autofill, and no password manager taking it for a login.
      autoComplete="off"
      {...(escapesHere(surface, onCancel) ? { onEscape: cancel } : {})}
      {...fieldProps}
      {...(inputMode === undefined ? {} : { inputMode })}
      {...(type === undefined ? {} : { type })}
      {...(shownHint === undefined ? {} : { hint: shownHint })}
      {...(prefix === undefined ? {} : { prefix })}
      {...(suffix === undefined ? {} : { suffix })}
      {...(maxLength === undefined ? {} : { maxLength })}
    />
  );
}
