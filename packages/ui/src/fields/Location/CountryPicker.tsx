import { COUNTRY_CODES } from '@crm/contracts/values';
import { useMemo } from 'react';
import { memoIntl } from '../../lib/intl-memo.ts';
import { Select } from '../../molecules/Select/Select.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { strings } from './strings.ts';

/** Props for CountryPicker. */
export interface CountryPickerProps {
  readonly label: string;
  /** An ISO 3166 alpha 2 code, or `null` for none. */
  readonly value: string | null;
  readonly onChange: (code: string | null) => void;
  readonly isLabelHidden?: boolean;
  readonly size?: 'md' | 'sm';
  readonly error?: string;
}

/**
 * Every country, named in the provider's language and sorted by that name, in
 * a searchable Select: the location editor's country, and a filter's
 * "country is". It hands back the ISO code.
 */
export function CountryPicker({
  label,
  value,
  onChange,
  isLabelHidden = false,
  size = 'md',
  error,
}: CountryPickerProps) {
  const { locale } = useFormatSettings();
  const countries = useMemo(() => {
    const names = memoIntl(`region:${locale}`, () => new Intl.DisplayNames(locale, { type: 'region' }));
    return COUNTRY_CODES.map((code) => ({ id: code, label: names.of(code) ?? code })).sort((a, b) =>
      a.label.localeCompare(b.label, locale),
    );
  }, [locale]);
  return (
    <Select
      label={label}
      isLabelHidden={isLabelHidden}
      size={size}
      isSearchable
      searchLabel={strings.searchCountries}
      placeholder={strings.chooseCountry}
      isClearable
      items={countries}
      value={value}
      onChange={onChange}
      {...(error === undefined ? {} : { error })}
    />
  );
}
