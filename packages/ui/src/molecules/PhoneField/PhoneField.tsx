import { useRef, useState } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import {
  examplePhone,
  phoneProblemOf,
  usePhoneExamples,
  usePhoneLibrary,
  type PhoneLibrary,
  type PhoneProblem,
} from '../../fields/Phone/phone-library.ts';
import { countryOfNumber, withoutDialCode } from '../../lib/countries.ts';
import { focusLater } from '../../lib/focus-later.ts';
import { CountryPicker } from '../CountryPicker/CountryPicker.tsx';
import { Field, type FieldProps } from '../Field/Field.tsx';
import styles from './PhoneField.module.css';
import { strings } from './strings.ts';

/** A phone number as PhoneField holds it: the country it is dialled from, and the number as typed there. */
export interface PhoneFieldValue {
  /** ISO 3166-1 alpha 2 ("IN"). */
  readonly country: string;
  /** The national number, formatted for the country as it was typed ("98765 43210"). */
  readonly national: string;
}

/** Props for PhoneField. */
export interface PhoneFieldProps {
  /** What is asked ("Phone or WhatsApp"). */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly value?: PhoneFieldValue;
  readonly defaultValue?: PhoneFieldValue;
  readonly onChange?: (value: PhoneFieldValue) => void;
  /** The visitor's own country: chosen first when there is no value, and pinned first in the list. */
  readonly guess?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  /** What's wrong, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly isRequired?: boolean;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly isDisabled?: boolean;
  readonly name?: string;
  /** Opens the country list on first render: stories and previews. */
  readonly defaultOpen?: boolean;
  /** The code button's name and the search's, in the page's language. */
  readonly codeLabel?: string;
  readonly searchLabel?: string;
  /**
   * For a record's phone attribute (the field set's editor): the field's
   * size and variant (`cell` in a grid cell), its keys and focus, the error
   * floating under a cell, and autocomplete. A hosted form passes none of
   * these and keeps its look.
   */
  readonly size?: FieldProps['size'];
  readonly variant?: 'default' | 'cell';
  readonly onBlur?: () => void;
  readonly onSubmit?: () => void;
  readonly onEscape?: () => void;
  readonly autoFocus?: boolean;
  readonly isErrorFloating?: boolean;
  readonly autoComplete?: string;
  /**
   * With no `placeholder`, the chosen country's example number, written the
   * national way ("081234 56789" for +91), loaded with the phone library.
   */
  readonly showsExample?: boolean;
  /**
   * Checks the number for the chosen country: a quiet check at the end of the
   * box while it is a valid number, and, once focus leaves or Enter is
   * pressed, a plain sentence when it is too short, too long or not a number
   * there (unless `error` already says something).
   */
  readonly checksNumber?: boolean;
}

/** The sentence for what is wrong with a number. */
const PROBLEMS: Readonly<Record<PhoneProblem, string>> = {
  'too-short': strings.tooShort,
  'too-long': strings.tooLong,
  invalid: strings.invalid,
};

/** The number laid out for its country as it is typed, once the phone library has loaded; as typed until then. */
function formatted(library: PhoneLibrary | undefined, country: string, national: string): string {
  if (library === undefined || national.trim() === '') return national;
  return new library.AsYouType(country as Parameters<PhoneLibrary['getCountryCallingCode']>[0]).input(national);
}

/**
 * A phone number: the country code button joined to the start of the number's
 * Field, showing the flag and "+91". The button opens CountryPicker's search;
 * choosing moves focus to the number. The number is laid out for its country
 * as it is typed, and a number pasted with its "+" code switches the country
 * to match.
 */
export function PhoneField({
  label,
  isLabelHidden = false,
  value,
  defaultValue,
  onChange,
  guess,
  placeholder,
  hint,
  error,
  isRequired = false,
  isReadOnly = false,
  readOnlyReason,
  isDisabled = false,
  name,
  defaultOpen,
  codeLabel = strings.code,
  searchLabel,
  size = 'md',
  variant = 'default',
  onBlur,
  onSubmit,
  onEscape,
  autoFocus = false,
  isErrorFloating = false,
  autoComplete = 'tel-national',
  showsExample = false,
  checksNumber = false,
}: PhoneFieldProps) {
  const library = usePhoneLibrary();
  const examples = usePhoneExamples(showsExample && placeholder === undefined);
  // What the checker found when the person last left the field or pressed Enter; typing clears it.
  const [problem, setProblem] = useState<PhoneProblem | undefined>(undefined);
  const [own, setOwn] = useState<PhoneFieldValue>(defaultValue ?? { country: guess ?? 'US', national: '' });
  const current = value ?? own;
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const change = (next: PhoneFieldValue) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };
  const type = (text: string) => {
    const pasted = countryOfNumber(text, current.country);
    const country = pasted ?? current.country;
    const national = pasted === undefined ? text : withoutDialCode(text, country);
    // Laid out only while the caret is at the end, so an edit in the middle keeps its place.
    const atEnd = input.current === null || input.current.selectionStart === text.length;
    change({ country, national: atEnd ? formatted(library, country, national) : national });
    setProblem(undefined);
  };
  const check = () => {
    if (checksNumber) setProblem(phoneProblemOf(library, current.national, current.country));
  };
  const isValid =
    checksNumber &&
    library !== undefined &&
    current.national.trim() !== '' &&
    phoneProblemOf(library, current.national, current.country) === undefined;
  const shownPlaceholder = placeholder ?? (showsExample ? examplePhone(library, examples, current.country) : undefined);
  const shownError = error ?? (problem === undefined ? undefined : PROBLEMS[problem]);
  return (
    <Field
      label={label}
      isLabelHidden={isLabelHidden}
      type="tel"
      inputMode="tel"
      autoComplete={autoComplete}
      size={size}
      variant={variant}
      isErrorFloating={isErrorFloating}
      // eslint-disable-next-line jsx-a11y-x/no-autofocus -- a record's editor opened on purpose, from its value
      autoFocus={autoFocus}
      {...(onBlur === undefined && !checksNumber
        ? {}
        : {
            onBlur: () => {
              check();
              onBlur?.();
            },
          })}
      {...(onSubmit === undefined && !checksNumber
        ? {}
        : {
            onSubmit: () => {
              check();
              onSubmit?.();
            },
          })}
      {...(isValid
        ? {
            suffix: (
              <span className={styles.valid}>
                <Icon name="circle-check" size="sm" label={strings.valid} />
              </span>
            ),
          }
        : {})}
      {...(onEscape === undefined ? {} : { onEscape })}
      value={current.national}
      onChange={type}
      ref={input}
      isRequired={isRequired}
      isReadOnly={isReadOnly}
      isDisabled={isDisabled}
      prefix={
        <CountryPicker
          label={codeLabel}
          variant="prefix"
          {...(searchLabel === undefined ? {} : { searchLabel })}
          value={current.country}
          onChange={(code) => {
            if (code === null) return;
            change({ country: code, national: formatted(library, code, current.national.replace(/\D/g, '')) });
            focusLater(() => input.current);
          }}
          isReadOnly={isReadOnly}
          isDisabled={isDisabled}
          {...(guess === undefined ? {} : { guess })}
          {...(defaultOpen === undefined ? {} : { defaultOpen })}
        />
      }
      {...(shownPlaceholder === undefined ? {} : { placeholder: shownPlaceholder })}
      {...(hint === undefined ? {} : { hint })}
      {...(shownError === undefined ? {} : { error: shownError })}
      {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
      {...(name === undefined ? {} : { name })}
    />
  );
}
