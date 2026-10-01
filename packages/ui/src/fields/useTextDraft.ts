// The draft behind every typed editor (text, numbers, links, money): it holds
// what is being typed, checks it on commit, and commits on Enter in a single
// line, on blur, or never while invalid. Esc cancels.
import { useState } from 'react';
import type { AttributeType } from '@crm/contracts/values';
import type { Committable } from './values.ts';
import type { FieldValue } from './types.ts';

/** Options for useTextDraft. */
export interface TextDraftOptions<T extends AttributeType> {
  /** The text to start from: the current value as typed. */
  readonly initial: string;
  /** Turns the text into a committable value, or the sentence to show. */
  readonly check: (draft: string) => Committable<T>;
  readonly onCommit: (value: FieldValue<T> | null) => void;
  readonly onCancel?: () => void;
  /** A refusal from outside (the server), shown until the text changes. */
  readonly error?: string;
  /** The text already differs from the value (the grid opened it by typing), so leaving commits it. */
  readonly isChanged?: boolean;
}

/** A typed editor's draft: the Field's props, and commit and cancel. */
export function useTextDraft<T extends AttributeType>({
  initial,
  check,
  onCommit,
  onCancel,
  error,
  isChanged = false,
}: TextDraftOptions<T>) {
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [isDirty, setDirty] = useState(isChanged);

  const commit = () => {
    if (!isDirty) return;
    const result = check(draft);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    setDirty(false);
    onCommit(result.value);
  };

  return {
    draft,
    commit,
    cancel: () => {
      setDraft(initial);
      setMessage(undefined);
      setDirty(false);
      onCancel?.();
    },
    fieldProps: {
      value: draft,
      onChange: (next: string) => {
        setDraft(next);
        setDirty(true);
        setMessage(undefined);
      },
      onBlur: commit,
      onSubmit: commit,
      ...((message ?? (isDirty ? undefined : error)) === undefined ? {} : { error: message ?? error }),
    },
  };
}
