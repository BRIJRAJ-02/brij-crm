import type { PersonalNameValue } from '@crm/contracts/values';
import { PersonalNameValue as PersonalNameSchema } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { PersonalNameDisplay } from './PersonalNameDisplay.tsx';
import { PersonalNameEditor } from './PersonalNameEditor.tsx';

/** "Lovelace, Ada" or "Ada Lovelace" as a name: a comma means last name first; otherwise split at the first space. */
export function nameFromText(text: string): PersonalNameValue | undefined {
  const trimmed = text.trim();
  const [lastPart, firstPart] = trimmed.includes(',') ? trimmed.split(',', 2).map((part) => part.trim()) : [];
  const [firstName, ...rest] = trimmed.includes(',') ? [firstPart ?? ''] : trimmed.split(/\s+/);
  const lastName = trimmed.includes(',') ? lastPart : rest.join(' ');
  const parsed = PersonalNameSchema.safeParse({
    ...(firstName === undefined || firstName === '' ? {} : { firstName }),
    ...(lastName === undefined || lastName === '' ? {} : { lastName }),
  });
  return parsed.success ? parsed.data : undefined;
}

/** The personal name type: first, last and full name. */
export const personalNameType: AttributeTypeDef<'personal_name'> = {
  type: 'personal_name',
  icon: 'contact',
  Display: PersonalNameDisplay,
  Editor: PersonalNameEditor,
  operators: () => withEmpty(['contains', 'first_name_is', 'last_name_is']),
  toText: (value) => (value as PersonalNameValue).fullName,
  fromText: (text) => nameFromText(text) ?? refuse('Type a name, such as Ada Lovelace.'),
  align: 'start',
  editIn: 'popover',
};
