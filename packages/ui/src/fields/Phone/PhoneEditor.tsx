import type { PhoneValue } from '@crm/contracts/values';
import { useState } from 'react';
import { countryOfNumber, withoutDialCode } from '../../lib/countries.ts';
import { PHONE_PROBLEMS, PhoneField, type PhoneFieldValue } from '../../molecules/PhoneField/PhoneField.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { ListEditor, type CheckedOne } from '../ListEditor.tsx';
import type { EditorProps } from '../types.ts';
import { asList, isCompactSurface, toCommittable } from '../values.ts';
import { formatPhone } from './PhoneDisplay.tsx';
import {
  createPhoneParser,
  defaultCountryFor,
  phoneProblemOf,
  usePhoneLibrary,
  type PhoneLibrary,
} from './phone-library.ts';
import { strings } from './strings.ts';

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
  return { ok: false, message: PHONE_PROBLEMS[problem ?? 'invalid'] };
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
  return (
    <PhoneField
      label={attribute.name}
      isLabelHidden={isCompact}
      size={isCompact ? 'sm' : 'md'}
      variant={surface === 'cell' ? 'cell' : 'default'}
      isErrorFloating={surface === 'cell'}
      // A contact's number, never the viewer's own: no browser autofill, and (through Field) the password managers'
      // own opt outs, so none draws its login icon here (the owner, 21 October 2026).
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
      // Leaving the whole field commits, not moving from the number to its country code (or the code's list).
      onLeave={commit}
      onEscape={cancel}
      codeLabel={strings.code}
      {...(shownError === undefined ? {} : { error: shownError })}
    />
  );
}

/**
 * Several numbers: removable chips, and the same PhoneField to add one more
 * (its country code, example number and check); a number typed with its "+"
 * code moves the code to the picker.
 */
function SeveralPhones(props: EditorProps<'phone'>) {
  const library = usePhoneLibrary();
  const start = useStartCountry(props.attribute.defaultCountry);
  const [country, setCountry] = useState(start);
  const phones = asList<PhoneValue>(props.value);
  return (
    <ListEditor<'phone', PhoneValue>
      {...props}
      {...(props.startText === undefined ? {} : { startText: fromTyped(props.startText, country).national })}
      values={phones}
      labelOf={(phone) => formatPhone(phone, library)}
      hrefOf={(phone) => `tel:${phone.number}`}
      checkOne={(draft) => checkPhone(draft, library, country)}
      renderAdd={(field) => (
        <PhoneField
          label={field.label}
          isLabelHidden={field.isLabelHidden}
          size={field.size}
          value={{ country, national: field.value }}
          onChange={(next) => {
            setCountry(next.country);
            field.onChange(next.national);
          }}
          onSubmit={field.onAdd}
          onLeave={field.onAdd}
          // A contact's number, never the viewer's own: no browser autofill, and (through Field) the password managers'
          // own opt outs, so none draws its login icon here (the owner, 21 October 2026).
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y-x/no-autofocus -- opened from a grid cell: keys go to the add field
          autoFocus={field.autoFocus}
          guess={start}
          codeLabel={strings.code}
          showsExample
          checksNumber
          {...(field.onEscape === undefined ? {} : { onEscape: field.onEscape })}
          {...(field.error === undefined ? {} : { error: field.error })}
        />
      )}
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
