import type { PhoneValue } from '@crm/contracts/values';
import { useState } from 'react';
import { useFocusWithin } from 'react-aria';
import { countryOfNumber, withoutDialCode } from '../../lib/countries.ts';
import { CountryPicker } from '../../molecules/CountryPicker/CountryPicker.tsx';
import { PhoneField, type PhoneFieldValue } from '../../molecules/PhoneField/PhoneField.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { ListEditor, type CheckedOne } from '../ListEditor.tsx';
import type { EditorProps } from '../types.ts';
import { asList, isCompactSurface, toCommittable } from '../values.ts';
import { formatPhone } from './PhoneDisplay.tsx';
import { strings as phoneFieldStrings } from '../../molecules/PhoneField/strings.ts';
import {
  createPhoneParser,
  defaultCountryFor,
  phoneProblemOf,
  usePhoneLibrary,
  type PhoneLibrary,
  type PhoneProblem,
} from './phone-library.ts';
import { strings } from './strings.ts';

/** The sentence for what is wrong with a number, as PhoneField's checker says it. */
const PROBLEMS: Readonly<Record<PhoneProblem, string>> = {
  'too-short': phoneFieldStrings.tooShort,
  'too-long': phoneFieldStrings.tooLong,
  invalid: phoneFieldStrings.invalid,
};

/** Typed text to a phone value: parsed and checked for that country by libphonenumber-js, or why not. */
export function checkPhone(
  draft: string,
  library: PhoneLibrary | undefined,
  country: string | undefined,
): CheckedOne<PhoneValue> {
  if (library === undefined) return { ok: false, message: strings.loading };
  const parsed = createPhoneParser(library).parse(draft, country);
  if (parsed !== undefined) return { ok: true, value: parsed };
  // Said as plainly as the checker says it: too short, too long, or not a number there.
  const problem = country === undefined ? undefined : phoneProblemOf(library, draft, country);
  return { ok: false, message: problem === undefined ? strings.invalid : PROBLEMS[problem] };
}

/** The national number laid out for its country as it is typed, once the library has loaded; as typed until then. */
function laidOut(library: PhoneLibrary | undefined, country: string, national: string): string {
  if (library === undefined || national.trim() === '' || !library.isSupportedCountry(country)) return national;
  return new library.AsYouType(country).input(national);
}

/** A stored number as the editor shows it: its country in the picker, its national number in the field. */
function shownOf(stored: PhoneValue | undefined, library: PhoneLibrary | undefined, fallback: string): PhoneFieldValue {
  if (stored === undefined) return { country: fallback, national: '' };
  const parsed = library?.parsePhoneNumberFromString(stored.number);
  if (parsed === undefined)
    return { country: stored.country, national: withoutDialCode(stored.number, stored.country) };
  const country = parsed.country ?? stored.country;
  // Written the national way, as people dial it in that country ("020 7123 4567").
  return { country, national: parsed.formatNational() };
}

/** Typed text with a "+" code: the country it names, and the rest as the national number. */
function fromTyped(text: string, country: string): PhoneFieldValue {
  const named = countryOfNumber(text, country);
  return named === undefined ? { country, national: text } : { country: named, national: withoutDialCode(text, named) };
}

/**
 * The country a new number starts in: the attribute's own default when it
 * has one, else the viewer's (their language's region), else the US.
 */
function useStartCountry(attributeDefault: string | undefined): string {
  const { locale } = useFormatSettings();
  return attributeDefault ?? defaultCountryFor(locale, undefined) ?? 'US';
}

/**
 * One number: the hosted form's PhoneField (the country code with its flag
 * and search, joined to the number), its draft checked by libphonenumber-js
 * for the country chosen and committed on Enter or blur, Esc cancelling.
 */
function OnePhone({ attribute, value, surface, onCommit, onCancel, error, startText }: EditorProps<'phone'>) {
  const library = usePhoneLibrary();
  const start = useStartCountry(attribute.defaultCountry);
  const stored = asList<PhoneValue>(value)[0];
  const initial = shownOf(stored, library, start);
  const [draft, setDraft] = useState<PhoneFieldValue>(() =>
    startText === undefined ? initial : fromTyped(startText, initial.country),
  );
  const [isDirty, setDirty] = useState(startText !== undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // The stored number shows laid out once the library loads, and follows a live change, until people type.
  const initialKey = `${initial.country}:${initial.national}`;
  const [shownKey, setShownKey] = useState(initialKey);
  if (shownKey !== initialKey) {
    setShownKey(initialKey);
    if (!isDirty) setDraft(initial);
  }
  const commit = () => {
    if (!isDirty) return;
    const national = draft.national.trim();
    let result;
    if (national === '') result = toCommittable<'phone'>(attribute, null);
    else {
      const one = checkPhone(national, library, draft.country);
      result = one.ok ? toCommittable<'phone'>(attribute, one.value) : one;
    }
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    setDirty(false);
    onCommit(result.value);
  };
  const cancel = () => {
    setDraft(initial);
    setDirty(false);
    setMessage(undefined);
    onCancel?.();
  };
  const isCompact = isCompactSurface(surface);
  const shownError = message ?? (isDirty ? undefined : error);
  // Leaving the whole field commits, not moving from the number to its country code (or the code's list).
  const { focusWithinProps } = useFocusWithin({ onBlurWithin: commit });
  return (
    <div {...focusWithinProps}>
      <PhoneField
        label={attribute.name}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        variant={surface === 'cell' ? 'cell' : 'default'}
        isErrorFloating={surface === 'cell'}
        // A record's number, never the viewer's own: no browser autofill, and no password manager taking it for a login.
        autoComplete="off"
        // Opened from its value (a cell, a details row): the number takes focus, not the code before it.
        autoFocus={surface === 'cell' || surface === 'panel'}
        guess={start}
        // The country's example number as the placeholder, and a quiet check while the number is valid there.
        showsExample
        checksNumber
        isRequired={attribute.isRequired}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setDirty(true);
          setMessage(undefined);
        }}
        onSubmit={commit}
        onEscape={cancel}
        codeLabel={strings.code}
        {...(shownError === undefined ? {} : { error: shownError })}
      />
    </div>
  );
}

/**
 * Several numbers: removable chips, and the add field with the same country
 * code picker before it; a number typed with its "+" code moves the code to
 * the picker.
 */
function SeveralPhones(props: EditorProps<'phone'>) {
  const library = usePhoneLibrary();
  const start = useStartCountry(props.attribute.defaultCountry);
  const [country, setCountry] = useState(start);
  const phones = asList<PhoneValue>(props.value);
  const transform = (typed: string) => {
    const next = fromTyped(typed, country);
    if (next.country !== country) setCountry(next.country);
    return laidOut(library, next.country, next.national);
  };
  return (
    <ListEditor<'phone', PhoneValue>
      {...props}
      {...(props.startText === undefined ? {} : { startText: fromTyped(props.startText, country).national })}
      values={phones}
      labelOf={(phone) => formatPhone(phone, library)}
      hrefOf={(phone) => `tel:${phone.number}`}
      checkOne={(draft) => checkPhone(draft, library, country)}
      type="tel"
      inputMode="tel"
      transformDraft={transform}
      prefix={
        <CountryPicker
          label={strings.code}
          variant="prefix"
          value={country}
          guess={start}
          onChange={(code) => {
            if (code !== null) setCountry(code);
          }}
        />
      }
    />
  );
}

/**
 * Phone: the hosted form's phone field (F38): the country code, with its
 * flag and a search by name, ISO code or dial code, joined to the number,
 * which libphonenumber-js (loaded when the field shows) checks for that
 * country. It starts in the attribute's default country, else the viewer's.
 * Several numbers are removable chips with the same field to add one.
 */
export function PhoneEditor(props: EditorProps<'phone'>) {
  return props.attribute.allowMultiple ? <SeveralPhones {...props} /> : <OnePhone {...props} />;
}
