import { useMemo, type Ref } from 'react';
import { allCountriesIn, countriesIn, flagOf, matchesCountry, type Country } from '../../lib/countries.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { Select, type SelectItem } from '../Select/Select.tsx';
import styles from './CountryPicker.module.css';
import { strings } from './strings.ts';

/** Props for CountryPicker. */
export interface CountryPickerProps {
  /** What is asked ("Country"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** A quiet word after the label, such as "(optional)" on a public form. */
  readonly labelAside?: string;
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
  /** The list opened or closed: PhoneField keeps focus in its list from counting as leaving. */
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly triggerRef?: Ref<HTMLButtonElement>;
  /** The search field's name, in the page's language. Defaults to "Search country or code". */
  readonly searchLabel?: string;
  /**
   * `dialing` (the default) lists the countries with a dialling code, each
   * showing it ("+91"), for a phone. `all` lists every country and territory
   * with no codes, for a place: an address's country, a filter's "country is".
   */
  readonly list?: 'dialing' | 'all';
  /** `sm` is a filter value's or a record panel row's 26px trigger. */
  readonly size?: 'md' | 'sm';
  /** Adds "Clear" while a country is chosen; leave it off for a required one. */
  readonly isClearable?: boolean;
}

/** A country as one of Select's options: the flag, the name, the code muted, and the code as the prefix's face. */
function itemOf(country: Country): SelectItem {
  if (country.dial === '') {
    return {
      id: country.code,
      label: country.name,
      leading: (
        <span className={styles.flag} aria-hidden="true">
          {flagOf(country.code)}
        </span>
      ),
    };
  }
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
  labelAside,
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
  onOpenChange,
  triggerRef,
  searchLabel = strings.search,
  list = 'dialing',
  size = 'md',
  isClearable = false,
}: CountryPickerProps) {
  const { locale } = useFormatSettings();
  const isPlace = list === 'all';
  const countries = useMemo(() => (isPlace ? allCountriesIn(locale) : countriesIn(locale)), [isPlace, locale]);
  const items = useMemo(() => {
    // A place's country never shows a dialling code.
    const all = countries.map((country) => itemOf(isPlace ? { ...country, dial: '' } : country));
    const pinned = all.find((item) => item.id === guess);
    return pinned === undefined ? all : [pinned, ...all.filter((item) => item !== pinned)];
  }, [countries, guess, isPlace]);
  const byCode = useMemo(() => new Map(countries.map((country) => [country.code, country])), [countries]);
  return (
    <Select
      label={label}
      {...(labelAside === undefined ? {} : { labelAside })}
      isLabelHidden={isLabelHidden || variant === 'prefix'}
      items={items}
      placeholder={placeholder}
      isSearchable
      searchLabel={searchLabel}
      size={size}
      isClearable={isClearable}
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
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      {...(triggerRef === undefined ? {} : { triggerRef })}
    />
  );
}
