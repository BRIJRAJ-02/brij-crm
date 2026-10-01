import type { PhoneValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef, TextContext } from '../types.ts';
import { asList, listFromText, refuse } from '../values.ts';
import { PhoneDisplay } from './PhoneDisplay.tsx';
import { PhoneEditor } from './PhoneEditor.tsx';
import { strings } from './strings.ts';

function one(text: string, context: TextContext) {
  if (context.phone === undefined) return refuse(strings.loading);
  return (
    context.phone.parse(text, context.defaultCountry ?? context.attribute.defaultCountry) ?? refuse(strings.invalid)
  );
}

/** The phone type: a number in E.164 and its country. Paste and imports pass a loaded `TextContext.phone`. */
export const phoneType: AttributeTypeDef<'phone'> = {
  type: 'phone',
  icon: 'phone',
  Display: PhoneDisplay,
  Editor: PhoneEditor,
  operators: () => withEmpty(['is', 'contains', 'country_is']),
  toText: (value) =>
    asList<PhoneValue>(value)
      .map((phone) => phone.number)
      .join(', '),
  fromText: (text, context) =>
    context.attribute.allowMultiple ? listFromText(text, (part) => one(part, context)) : one(text, context),
  align: 'start',
  editIn: 'cell',
};
