import type { PersonalNameValue } from '@crm/contracts/values';
import { useState } from 'react';
import { useFocusWithin } from 'react-aria';
import { cleanText } from '../../lib/parse-input.ts';
import { Field } from '../../molecules/Field/Field.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';
import styles from './PersonalNameEditor.module.css';
import { strings } from './strings.ts';
import { nameFromText } from './name.ts';

/**
 * Personal name: first and last name Fields; the full name is made from them.
 * Leaving both commits once. A whole name pasted into First while Last is
 * empty ("Ada Lovelace", "Lovelace, Ada") splits into both, as a grid paste
 * reads it (`nameFromText`). Typing from a grid cell starts in First.
 */
export function PersonalNameEditor({
  attribute,
  value,
  onCommit,
  error,
  startText,
  isDisabled = false,
}: EditorProps<'personal_name'>) {
  const current = value === null || Array.isArray(value) ? undefined : (value as PersonalNameValue);
  const [first, setFirst] = useState(startText ?? current?.firstName ?? '');
  const [last, setLast] = useState(startText === undefined ? (current?.lastName ?? '') : '');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const commit = () => {
    const candidate = {
      ...(first.trim() === '' ? {} : { firstName: first }),
      ...(last.trim() === '' ? {} : { lastName: last }),
    };
    const result = toCommittable<'personal_name'>(attribute, Object.keys(candidate).length === 0 ? null : candidate);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    onCommit(result.value);
  };
  const shown = message ?? error;
  // One commit when focus leaves the whole group, not one per part.
  const { focusWithinProps } = useFocusWithin({ onBlurWithin: commit });
  return (
    <fieldset className={styles.root} {...focusWithinProps}>
      <legend className={styles.legend}>{attribute.name}</legend>
      <span className={styles.row}>
        {/* A refusal is about the whole name: it marks the first field, where the name starts, in every layout. */}
        <Field
          label={strings.first}
          value={first}
          onChange={setFirst}
          onSubmit={commit}
          autoComplete="given-name"
          isDisabled={isDisabled}
          onPaste={(event) => {
            const pasted = cleanText(event.clipboardData.getData('text/plain'));
            if (last.trim() !== '' || !/[\s,]/u.test(pasted)) return;
            const split = nameFromText(pasted);
            if (split?.lastName === undefined) return;
            event.preventDefault();
            setFirst(split.firstName ?? '');
            setLast(split.lastName);
          }}
          {...(shown === undefined ? {} : { error: shown })}
        />
        <Field
          label={strings.last}
          value={last}
          onChange={setLast}
          onSubmit={commit}
          autoComplete="family-name"
          isDisabled={isDisabled}
        />
      </span>
    </fieldset>
  );
}
