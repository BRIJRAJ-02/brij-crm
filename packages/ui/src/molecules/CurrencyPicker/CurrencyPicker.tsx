import { CURRENCY_CODES } from '@crm/contracts/values';
import { useMemo } from 'react';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { Select, type SelectItem } from '../Select/Select.tsx';
import { strings } from './strings.ts';

/** Props for CurrencyPicker. */
export interface CurrencyPickerProps {
  /** What is asked ("Currency"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** The chosen currency's ISO 4217 code ("INR"), or `null` for none. */
  readonly value?: string | null;
  readonly onChange?: (code: string | null) => void;
  /** Shown when nothing is chosen. Defaults to "Choose a currency…". */
  readonly placeholder?: string;
  readonly hint?: string;
  /** What's wrong, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly isDisabled?: boolean;
  /** Adds "Clear" while a currency is chosen; leave it off for a required one. */
  readonly isClearable?: boolean;
  /** The search field's name, in the page's language. Defaults to "Search currencies". */
  readonly searchLabel?: string;
}

/**
 * Choose a currency: a trigger with the chosen currency's name and code, and a list with a search at its top that
 * narrows by name or code ("rupee", "INR"). Select's searchable list, so it is the same trigger, popover and keys as
 * every other choice in the CRM, as CountryPicker is for countries.
 */
export function CurrencyPicker({
  label,
  isLabelHidden = false,
  value,
  onChange,
  placeholder = strings.choose,
  hint,
  error,
  isReadOnly = false,
  readOnlyReason,
  isDisabled = false,
  isClearable = false,
  searchLabel = strings.search,
}: CurrencyPickerProps) {
  const { locale } = useFormatSettings();
  const items = useMemo<readonly SelectItem[]>(() => {
    const names = memoIntl(`currency-names:${locale}`, () => new Intl.DisplayNames(locale, { type: 'currency' }));
    return CURRENCY_CODES.map((code) => ({ id: code, label: names.of(code) ?? code, description: code }));
  }, [locale]);
  return (
    <Select
      label={label}
      isLabelHidden={isLabelHidden}
      items={items}
      placeholder={placeholder}
      isSearchable
      searchLabel={searchLabel}
      isClearable={isClearable}
      // The code is part of what the person types for: "inr" finds the rupee.
      filter={(item, query) => {
        const needle = query.trim().toLowerCase();
        return item.label.toLowerCase().includes(needle) || item.id.toLowerCase().startsWith(needle);
      }}
      isReadOnly={isReadOnly}
      isDisabled={isDisabled}
      {...(value === undefined ? {} : { value })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
    />
  );
}
