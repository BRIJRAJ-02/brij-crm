import type { LocationValue } from '@crm/contracts/values';
import { useState } from 'react';
import { useFocusWithin } from 'react-aria';
import { CountryPicker } from '../../molecules/CountryPicker/CountryPicker.tsx';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { useFormatSettings, useRegionDefaults } from '../../provider/context.ts';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';
import styles from './LocationEditor.module.css';
import { locationFromText } from './parse.ts';
import { strings } from './strings.ts';

type Part = 'line1' | 'line2' | 'locality' | 'region' | 'postcode' | 'countryCode';
const PARTS: readonly Part[] = ['line1', 'line2', 'locality', 'region', 'postcode', 'countryCode'];
/** The parts behind More: most addresses are a street, a city and a country. */
const MORE_PARTS: readonly Part[] = ['line2', 'region', 'postcode'];

/**
 * Location: the address, the city and the country up front, and the second
 * line, region and postcode behind More (open when one holds something). A
 * whole address pasted into the first line ("10 Downing St, London, UK")
 * fills every part, as a grid paste reads it (`locationFromText`). A new
 * country list leads with the workspace's country. Leaving the parts commits once.
 */
export function LocationEditor({
  attribute,
  value,
  onCommit,
  error,
  startText,
  isDisabled = false,
}: EditorProps<'location'>) {
  const { locale } = useFormatSettings();
  const region = useRegionDefaults();
  const current = value === null || Array.isArray(value) ? undefined : (value as LocationValue);
  const [draft, setDraft] = useState<Partial<Record<Part, string>>>(() => {
    const start: Partial<Record<Part, string>> = {};
    for (const part of PARTS) start[part] = current?.[part] ?? '';
    if (startText !== undefined) start.line1 = startText;
    return start;
  });
  const [isMoreOpen, setMoreOpen] = useState(() => MORE_PARTS.some((part) => (current?.[part] ?? '') !== ''));
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
  const field = (part: Exclude<Part, 'countryCode'>, extra: { readonly placeholder?: string } = {}) => (
    <Field
      key={part}
      label={strings[part]}
      value={draft[part] ?? ''}
      isDisabled={isDisabled}
      {...extra}
      onChange={(next) => {
        setDraft((previous) => ({ ...previous, [part]: next }));
      }}
      {...(part === 'line1'
        ? {
            onPaste: (event) => {
              const pasted = event.clipboardData.getData('text/plain');
              if (!/[,\n]/u.test(pasted)) return;
              const read = locationFromText(pasted, locale);
              if (read === undefined) return;
              event.preventDefault();
              setDraft((previous) => {
                const next = { ...previous };
                for (const each of PARTS) {
                  const found = read[each];
                  if (found !== undefined) next[each] = found;
                }
                return next;
              });
              if (MORE_PARTS.some((each) => read[each] !== undefined)) setMoreOpen(true);
            },
          }
        : {})}
    />
  );
  const country = draft.countryCode === undefined || draft.countryCode === '' ? null : draft.countryCode;
  return (
    <fieldset className={styles.root} {...focusWithinProps}>
      <legend className={styles.legend}>{attribute.name}</legend>
      {field('line1', { placeholder: strings.pastePlaceholder })}
      {field('locality')}
      <CountryPicker
        label={strings.countryCode}
        list="all"
        isClearable
        isDisabled={isDisabled}
        placeholder={strings.chooseCountry}
        searchLabel={strings.searchCountries}
        // The workspace's country leads the list, so most addresses take one key.
        guess={region.country}
        value={country}
        onChange={(code) => {
          setDraft((previous) => ({ ...previous, countryCode: code ?? '' }));
        }}
      />
      <Disclosure variant="fields" title={strings.more} isExpanded={isMoreOpen} onExpandedChange={setMoreOpen}>
        {field('line2')}
        {field('region')}
        {field('postcode')}
      </Disclosure>
      {(message ?? error) !== undefined && (
        <span className={styles.error} role="alert">
          {message ?? error}
        </span>
      )}
    </fieldset>
  );
}
