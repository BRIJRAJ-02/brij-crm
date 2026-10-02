import type { LocationValue } from '@crm/contracts/values';
import { useState } from 'react';
import { useFocusWithin } from 'react-aria';
import { Field } from '../../molecules/Field/Field.tsx';
import type { EditorProps } from '../types.ts';
import { CountryPicker } from './CountryPicker.tsx';
import { toCommittable } from '../values.ts';
import styles from './LocationEditor.module.css';
import { strings } from './strings.ts';

type Part = 'line1' | 'line2' | 'locality' | 'region' | 'postcode' | 'countryCode';
const PARTS: readonly Part[] = ['line1', 'line2', 'locality', 'region', 'postcode', 'countryCode'];
const TYPED_PARTS = PARTS.filter((part) => part !== 'countryCode');

/**
 * Location: a Field per typed part (address lines, city, region, postcode)
 * and the country picker; leaving the parts commits the address once.
 */
export function LocationEditor({ attribute, value, onCommit, error }: EditorProps<'location'>) {
  const current = value === null || Array.isArray(value) ? {} : (value as LocationValue);
  const [draft, setDraft] = useState<Partial<Record<Part, string>>>(() => {
    const start: Partial<Record<Part, string>> = {};
    for (const part of PARTS) start[part] = current[part] ?? '';
    return start;
  });
  const [message, setMessage] = useState<string | undefined>(undefined);
  const commit = () => {
    const candidate: Partial<Record<Part, string>> = {};
    for (const part of PARTS) {
      const text = draft[part]?.trim() ?? '';
      if (text !== '') candidate[part] = part === 'countryCode' ? text.toUpperCase() : text;
    }
    const result = toCommittable<'location'>(attribute, Object.keys(candidate).length === 0 ? null : candidate);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    onCommit(result.value);
  };
  // One commit when focus leaves the whole group, not one per part.
  const { focusWithinProps } = useFocusWithin({ onBlurWithin: commit });
  return (
    <fieldset className={styles.root} {...focusWithinProps}>
      <legend className={styles.legend}>{attribute.name}</legend>
      {TYPED_PARTS.map((part) => (
        <Field
          key={part}
          label={strings[part]}
          value={draft[part] ?? ''}
          onChange={(next) => {
            setDraft((previous) => ({ ...previous, [part]: next }));
          }}
        />
      ))}
      <CountryPicker
        label={strings.countryCode}
        value={draft.countryCode === undefined || draft.countryCode === '' ? null : draft.countryCode}
        onChange={(code) => {
          setDraft((previous) => ({ ...previous, countryCode: code ?? '' }));
        }}
      />
      {(message ?? error) !== undefined && (
        <span className={styles.error} role="alert">
          {message ?? error}
        </span>
      )}
    </fieldset>
  );
}
