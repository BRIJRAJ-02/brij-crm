import { useMemo, type Ref } from 'react';
import { countriesIn, flagOf, matchesCountry, type Country } from '../../lib/countries.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { Select, type SelectItem } from '../Select/Select.tsx';
import styles from './CountryPicker.module.css';
import { strings } from './strings.ts';

/** Props for CountryPicker. */
export interface CountryPickerProps {
  /** What is asked ("Country"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** The chosen country's ISO code ("IN"), or `null` for none. */
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onChange?: (code: string | null) => void;
  /** The visitor's own country, guessed by the page: pinned first in the list. */
  readonly guess?: string;
  /** Shown when nothing is chosen. Defaults to "Choose a country…". */
  readonly placeholder?: string;
  readonly hint?: string;
  /** What's wrong, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly isRequired?: boolean;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly isDisabled?: boolean;
  /**
   * `prefix` is the compact code button joined to the start of a Field's box,
   * showing the flag and "+91" (PhoneField uses it). `default` is a question
   * of its own, showing the flag and the country's name.
   */
  readonly variant?: 'default' | 'prefix';
  readonly autoFocus?: boolean;
  readonly defaultOpen?: boolean;
  readonly triggerRef?: Ref<HTMLButtonElement>;
  /** The search field's name, in the page's language. Defaults to "Search country or code". */
  readonly searchLabel?: string;
}

/** A country as one of Select's options: the flag, the name, the code muted, and the code as the prefix's face. */
function itemOf(country: Country): SelectItem {
  return {
    id: country.code,
    label: country.name,
    leading: (
      <span className={styles.flag} aria-hidden="true">
        {flagOf(country.code)}
      </span>
    ),
    description: strings.dial(country.dial),
    short: strings.dial(country.dial),
  };
}

/**
 * Choose a country: a trigger with the chosen country's flag, and a list
 * with a search at its top that has focus as it opens and narrows by name,
 * ISO code or dial code ("ind", "IN", "+91"). The guessed country is pinned
 * first. Built on Select's searchable list, so it is the same trigger, the
 * same popover and the same keys as every other choice in the CRM.
 */
export function CountryPicker({
  label,
  isLabelHidden = false,
  value,
  defaultValue,
  onChange,
  guess,
  placeholder = strings.choose,
  hint,
  error,
  isRequired = false,
  isReadOnly = false,
  readOnlyReason,
  isDisabled = false,
  variant = 'default',
  autoFocus = false,
  defaultOpen,
  triggerRef,
  searchLabel = strings.search,
}: CountryPickerProps) {
  const { locale } = useFormatSettings();
  const countries = useMemo(() => countriesIn(locale), [locale]);
  const items = useMemo(() => {
    const all = countries.map(itemOf);
    const pinned = all.find((item) => item.id === guess);
    return pinned === undefined ? all : [pinned, ...all.filter((item) => item !== pinned)];
  }, [countries, guess]);
  const byCode = useMemo(() => new Map(countries.map((country) => [country.code, country])), [countries]);
  return (
    <Select
      label={label}
      isLabelHidden={isLabelHidden || variant === 'prefix'}
      items={items}
      placeholder={placeholder}
      isSearchable
      searchLabel={searchLabel}
      filter={(item, query) => {
        const country = byCode.get(item.id);
        return country !== undefined && matchesCountry(country, query);
      }}
      isRequired={isRequired}
      isReadOnly={isReadOnly}
      isDisabled={isDisabled}
      variant={variant}
      {...(autoFocus ? { autoFocus: true } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(triggerRef === undefined ? {} : { triggerRef })}
    />
  );
}
