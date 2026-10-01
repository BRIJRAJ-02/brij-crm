import type { PhoneValue } from '@crm/contracts/values';
import { useFormatSettings } from '../../provider/context.ts';
import { ListEditor, type CheckedOne } from '../ListEditor.tsx';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { formatPhone } from './PhoneDisplay.tsx';
import { createPhoneParser, defaultCountryFor, usePhoneLibrary, type PhoneLibrary } from './phone-library.ts';
import { strings } from './strings.ts';

/** Typed text to a phone value: parsed and checked for that country by libphonenumber-js, or why not. */
export function checkPhone(
  draft: string,
  library: PhoneLibrary | undefined,
  country: string | undefined,
): CheckedOne<PhoneValue> {
  if (library === undefined) return { ok: false, message: strings.loading };
  const parsed = createPhoneParser(library).parse(draft, country);
  return parsed === undefined ? { ok: false, message: strings.invalid } : { ok: true, value: parsed };
}

/**
 * Phone: a Field read by libphonenumber-js (loaded when the field shows) in
 * the viewer's or the attribute's country, and checked for that country.
 * Several numbers are removable chips with a field to add one.
 */
export function PhoneEditor(props: EditorProps<'phone'>) {
  const { locale } = useFormatSettings();
  const library = usePhoneLibrary();
  const country = defaultCountryFor(locale, props.attribute.defaultCountry);
  const phones = asList<PhoneValue>(props.value);
  const check = (draft: string) => checkPhone(draft, library, country);
  if (props.attribute.allowMultiple) {
    return (
      <ListEditor<'phone', PhoneValue>
        {...props}
        values={phones}
        labelOf={(phone) => formatPhone(phone, library)}
        hrefOf={(phone) => `tel:${phone.number}`}
        checkOne={check}
        type="tel"
        inputMode="tel"
        hint={strings.hint}
      />
    );
  }
  return (
    <TextLikeEditor<'phone'>
      {...props}
      initial={phones[0] === undefined ? '' : formatPhone(phones[0], library)}
      type="tel"
      inputMode="tel"
      {...(props.surface === 'cell' ? {} : { hint: strings.hint })}
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'phone'>(props.attribute, null);
        const one = check(draft);
        return one.ok ? toCommittable<'phone'>(props.attribute, one.value) : one;
      }}
    />
  );
}
