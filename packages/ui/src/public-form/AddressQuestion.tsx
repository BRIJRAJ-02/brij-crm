import type { FormStrings } from '@crm/contracts/forms';
import { useId } from 'react';
import { FieldLabel } from '../atoms/FieldLabel/FieldLabel.tsx';
import { CountryPicker } from '../molecules/CountryPicker/CountryPicker.tsx';
import { Field } from '../molecules/Field/Field.tsx';
import styles from './AddressQuestion.module.css';

/** An address as the page holds it while it is typed: each part's text, the country as its two letter code. */
export interface AddressDraft {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postcode?: string;
  readonly country?: string;
}

/** Props for AddressQuestion. */
export interface AddressQuestionProps {
  readonly questionKey: string;
  readonly label: string;
  readonly aside: string | undefined;
  readonly isLabelHidden: boolean;
  readonly words: FormStrings;
  readonly value: AddressDraft | undefined;
  readonly error: string | undefined;
  readonly countryGuess: string | undefined;
  readonly onChange: (value: AddressDraft) => void;
}

/**
 * A hosted form's Address question (spec 0063, AC-6307): one group of the library's own fields, named by the
 * question, in the order an address is written: the street, the apartment, then the city beside the region and
 * the postcode beside the country, which stack on a phone. The problem with it shows under the street, the field
 * a visitor fixes first. No lookup: any provider would add an origin to the page. Not FieldGroup, which heads
 * read only values and has no question's strong label with its "(optional)".
 */
export function AddressQuestion({
  questionKey,
  label,
  aside,
  isLabelHidden,
  words,
  value,
  error,
  countryGuess,
  onChange,
}: AddressQuestionProps) {
  const draft = value ?? (countryGuess === undefined ? {} : { country: countryGuess });
  const set = (part: keyof AddressDraft) => (text: string) => {
    onChange({ ...draft, [part]: text });
  };
  const labelId = useId();
  return (
    <div
      role="group"
      className={styles.root}
      {...(isLabelHidden
        ? { 'aria-label': aside === undefined ? label : `${label} ${aside}` }
        : { 'aria-labelledby': labelId })}
    >
      {!isLabelHidden && <FieldLabel as="text" id={labelId} label={label} aside={aside} tone="strong" />}
      <Field
        label={words.addressLine1}
        name={`${questionKey}.line1`}
        autoComplete="address-line1"
        value={draft.line1 ?? ''}
        onChange={set('line1')}
        {...(error === undefined ? {} : { error })}
      />
      <Field
        label={words.addressLine2}
        labelAside={words.optional}
        name={`${questionKey}.line2`}
        autoComplete="address-line2"
        value={draft.line2 ?? ''}
        onChange={set('line2')}
      />
      <div className={styles.pair}>
        <Field
          label={words.addressCity}
          name={`${questionKey}.city`}
          autoComplete="address-level2"
          value={draft.city ?? ''}
          onChange={set('city')}
        />
        <Field
          label={words.addressRegion}
          labelAside={words.optional}
          name={`${questionKey}.region`}
          autoComplete="address-level1"
          value={draft.region ?? ''}
          onChange={set('region')}
        />
      </div>
      <div className={styles.pair}>
        <Field
          label={words.addressPostcode}
          name={`${questionKey}.postcode`}
          autoComplete="postal-code"
          value={draft.postcode ?? ''}
          onChange={set('postcode')}
        />
        <CountryPicker
          label={words.addressCountry}
          value={draft.country ?? null}
          onChange={(code) => {
            onChange({ ...draft, country: code ?? '' });
          }}
          searchLabel={words.searchCountries}
          placeholder={words.chooseOne}
          {...(countryGuess === undefined ? {} : { guess: countryGuess })}
        />
      </div>
    </div>
  );
}
