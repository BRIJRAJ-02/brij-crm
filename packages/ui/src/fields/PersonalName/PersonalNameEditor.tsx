import type { PersonalNameValue } from '@crm/contracts/values';
import { useState } from 'react';
import { useFocusWithin } from 'react-aria';
import { Field } from '../../molecules/Field/Field.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';
import styles from './PersonalNameEditor.module.css';
import { strings } from './strings.ts';

/** Personal name: first and last name Fields; the full name is made from them. Leaving both commits once. */
export function PersonalNameEditor({ attribute, value, onCommit, error }: EditorProps<'personal_name'>) {
  const current = value === null || Array.isArray(value) ? undefined : (value as PersonalNameValue);
  const [first, setFirst] = useState(current?.firstName ?? '');
  const [last, setLast] = useState(current?.lastName ?? '');
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
        <Field label={strings.first} value={first} onChange={setFirst} onSubmit={commit} autoComplete="given-name" />
        <Field
          label={strings.last}
          value={last}
          onChange={setLast}
          onSubmit={commit}
          autoComplete="family-name"
          {...(shown === undefined ? {} : { error: shown })}
        />
      </span>
    </fieldset>
  );
}
