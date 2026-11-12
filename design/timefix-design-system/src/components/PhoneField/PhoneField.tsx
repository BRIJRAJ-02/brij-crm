import {
  TextField,
  Input,
  Select,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  Autocomplete,
  SearchField as AriaSearchField,
  Input as SearchInput,
  useFilter,
  type Key,
} from 'react-aria-components';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { FieldBox, FieldDescription, FieldErrorText, FieldLabel, useShake, type FieldSize } from '../Field/Field.tsx';
import './PhoneField.css';

/** A country a phone can be dialled from, and how its national numbers group (`#` is a digit). */
export interface PhoneCountry {
  /** ISO 3166-1 alpha 2 ("IN"). */
  readonly code: string;
  readonly name: string;
  /** Calling code without the plus ("91"). */
  readonly dial: string;
  readonly pattern: string;
}

/** The countries offered, most used first; pass your own list to `countries` for more. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: 'US', name: 'United States', dial: '1', pattern: '(###) ###-####' },
  { code: 'GB', name: 'United Kingdom', dial: '44', pattern: '#### ######' },
  { code: 'IN', name: 'India', dial: '91', pattern: '##### #####' },
  { code: 'CA', name: 'Canada', dial: '1', pattern: '(###) ###-####' },
  { code: 'AU', name: 'Australia', dial: '61', pattern: '### ### ###' },
  { code: 'DE', name: 'Germany', dial: '49', pattern: '#### #######' },
  { code: 'FR', name: 'France', dial: '33', pattern: '# ## ## ## ##' },
  { code: 'ES', name: 'Spain', dial: '34', pattern: '### ### ###' },
  { code: 'NL', name: 'Netherlands', dial: '31', pattern: '# ########' },
  { code: 'IE', name: 'Ireland', dial: '353', pattern: '## ### ####' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', pattern: '## ### ####' },
  { code: 'SG', name: 'Singapore', dial: '65', pattern: '#### ####' },
  { code: 'JP', name: 'Japan', dial: '81', pattern: '##-####-####' },
  { code: 'BR', name: 'Brazil', dial: '55', pattern: '(##) #####-####' },
  { code: 'MX', name: 'Mexico', dial: '52', pattern: '## #### ####' },
  { code: 'ZA', name: 'South Africa', dial: '27', pattern: '## ### ####' },
  { code: 'NZ', name: 'New Zealand', dial: '64', pattern: '## ### ####' },
];

/** A phone number as PhoneField holds it: the country it is dialled from and the national digits. */
export interface PhoneValue {
  readonly country: string;
  /** Digits only ("9876543210"). */
  readonly national: string;
}

/** Lays national digits into a country's pattern as they are typed; digits beyond the pattern follow as typed. */
export function formatPhone(digits: string, pattern: string): string {
  let out = '';
  let i = 0;
  for (const p of pattern) {
    if (i >= digits.length) break;
    if (p === '#') out += digits[i++];
    else out += p;
  }
  return out + digits.slice(i);
}

/** The number in international form ("+91 98765 43210"), for display and links. */
export function phoneToString(value: PhoneValue, countries: readonly PhoneCountry[] = PHONE_COUNTRIES): string {
  const c = countries.find((x) => x.code === value.country);
  return c ? `+${c.dial} ${formatPhone(value.national, c.pattern)}` : value.national;
}

/** Props for PhoneField. */
export interface PhoneFieldProps {
  readonly label: string;
  readonly aside?: string;
  readonly description?: ReactNode;
  readonly errorMessage?: string;
  readonly value?: PhoneValue;
  readonly defaultValue?: PhoneValue;
  readonly onChange?: (value: PhoneValue) => void;
  readonly countries?: readonly PhoneCountry[];
  readonly isRequired?: boolean;
  readonly isInvalid?: boolean;
  readonly isDisabled?: boolean;
  readonly size?: FieldSize;
  readonly name?: string;
  readonly className?: string;
  /** Says the country names in this locale (Intl.DisplayNames, "España" for es-ES); the dial codes stay. Left out, the list's own names. */
  readonly locale?: string;
  /** The picker's own words in the page's language: the chip's name, the search's name and placeholder, and the empty line. */
  readonly words?: Partial<PhoneWords>;
}

/** The country picker's words; English unless `words` says otherwise. */
export interface PhoneWords { readonly countryCode: string; readonly searchCountries: string; readonly countryOrCode: string; readonly noCountry: string }
const ENGLISH: PhoneWords = { countryCode: 'Country code', searchCountries: 'Search countries', countryOrCode: 'Country or code', noCountry: 'No country matches.' };
/** A country's name in a locale, falling back to the list's own name. */
const nameIn = (c: PhoneCountry, locale: string | undefined): string => {
  if (!locale) return c.name;
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(c.code) ?? c.name; } catch { return c.name; }
};

/**
 * A phone number: a country code chip ("+91") joined to the number. The chip opens a searchable list of
 * countries (by name, ISO code or "+91"); the number groups itself for the country as it is typed, and a pasted
 * "+44 …" switches the country to match.
 */
export function PhoneField({ label, aside, description, errorMessage, value, defaultValue, onChange, countries: given = PHONE_COUNTRIES, isRequired, isInvalid, isDisabled, size = 'md', name, className, locale, words }: PhoneFieldProps) {
  const w = { ...ENGLISH, ...words };
  const countries = useMemo(() => (locale ? given.map((c) => ({ ...c, name: nameIn(c, locale) })) : given), [given, locale]);
  const [own, setOwn] = useState<PhoneValue>(defaultValue ?? { country: countries[0]?.code ?? 'US', national: '' });
  const current = value ?? own;
  const country = countries.find((c) => c.code === current.country) ?? countries[0];
  const { ref, shake } = useShake<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const { contains } = useFilter({ sensitivity: 'base' });
  const change = (next: PhoneValue) => { setOwn(next); onChange?.(next); };
  // After a pick, focus moves on to the number once the list has closed (its close runs --duration-quick).
  const focusNumber = () => {
    const el = inputRef.current;
    const ms = el ? parseFloat(getComputedStyle(el).getPropertyValue('--duration-quick')) || 150 : 150;
    window.setTimeout(() => inputRef.current?.focus(), ms + 40);
  };

  const type = (text: string) => {
    if (text.trim().startsWith('+')) {
      const all = text.replace(/\D/g, '');
      const match = [...countries].sort((a, b) => b.dial.length - a.dial.length).find((c) => all.startsWith(c.dial));
      // Keep the chosen country when it shares the code (+1 for the US and Canada).
      if (match) {
        const keep = country && country.dial === match.dial ? country.code : match.code;
        change({ country: keep, national: all.slice(match.dial.length) });
        return;
      }
    }
    const digits = text.replace(/\D/g, '').slice(0, 15);
    const shown = country ? formatPhone(current.national, country.pattern) : current.national;
    // Backspace over a space or bracket removes the digit before it, so the grouping never traps the caret.
    const national = digits === current.national && text.length < shown.length ? digits.slice(0, -1) : digits;
    change({ ...current, national });
  };

  return (
    <TextField
      className={cx('tf-field', 'tf-phone', `tf-field--${size}`, className)}
      value={country ? formatPhone(current.national, country.pattern) : current.national}
      onChange={type}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      name={name}
      isRequired={isRequired}
      isInvalid={isInvalid}
      isDisabled={isDisabled}
    >
      <FieldLabel aside={aside}>{label}</FieldLabel>
      <FieldBox ref={ref} className="tf-phone__box">
        <Select
          aria-label={w.countryCode}
          selectedKey={current.country}
          onSelectionChange={(k: Key | null) => { if (k !== null) { change({ ...current, country: String(k) }); focusNumber(); } }}
          isDisabled={isDisabled}
          className="tf-phone__select"
        >
          <Button className="tf-phone__code">
            <span className="tf-phone__dial">+{country?.dial}</span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
          <Popover className="tf-phone__pop tf-overlay" placement="bottom start" offset={6}>
            <Autocomplete filter={contains}>
              <AriaSearchField aria-label={w.searchCountries} className="tf-phone__search" autoFocus>
                <Search size={14} strokeWidth={1.75} aria-hidden="true" />
                <SearchInput className="tf-phone__search-input" placeholder={w.countryOrCode} />
              </AriaSearchField>
              <ListBox className="tf-phone__list" items={countries} renderEmptyState={() => <p className="tf-phone__empty">{w.noCountry}</p>}>
                {(c) => (
                  <ListBoxItem id={c.code} textValue={`${c.name} +${c.dial} ${c.code}`} className="tf-phone__item">
                    <span className="tf-phone__name">{c.name}</span>
                    <span className="tf-phone__item-dial">+{c.dial}</span>
                    <svg className="tf-phone__tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" pathLength={1} /></svg>
                  </ListBoxItem>
                )}
              </ListBox>
            </Autocomplete>
          </Popover>
        </Select>
        <span className="tf-phone__rule" aria-hidden="true" />
        <Input ref={inputRef} className="tf-field__input tf-phone__input" placeholder={country ? formatPhone('12345678901234'.slice(0, country.pattern.split('#').length - 1), country.pattern) : ''} onInvalid={shake} />
      </FieldBox>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldErrorText>{errorMessage}</FieldErrorText>
    </TextField>
  );
}
