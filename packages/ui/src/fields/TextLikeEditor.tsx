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
import { isCompactSurface } from './values.ts';

/** Props for TextLikeEditor. */
export interface TextLikeEditorProps<T extends AttributeType> extends EditorProps<T> {
  /** The value as it is typed. */
  readonly initial: string;
  /** Typed text to a committable value, or the sentence to show. */
  readonly check: (draft: string) => Committable<T>;
  readonly inputMode?: FieldProps['inputMode'];
  readonly type?: FieldProps['type'];
  readonly hint?: string;
  readonly prefix?: ReactNode;
  readonly isMultiline?: boolean;
  readonly maxLength?: number;
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
  prefix,
  isMultiline = false,
  maxLength,
  startText,
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
  return (
    <Field
      label={attribute.name}
      isLabelHidden={isCompact}
      size={isCompact ? 'sm' : 'md'}
      placeholder={fieldStrings.setAttribute(attribute.name)}
      isRequired={attribute.isRequired}
      isMultiline={isMultiline}
      showCounter={isMultiline && maxLength !== undefined}
      isErrorFloating={surface === 'cell'}
      onEscape={cancel}
      {...fieldProps}
      {...(inputMode === undefined ? {} : { inputMode })}
      {...(type === undefined ? {} : { type })}
      {...(hint === undefined ? {} : { hint })}
      {...(prefix === undefined ? {} : { prefix })}
      {...(maxLength === undefined ? {} : { maxLength })}
    />
  );
}
