import type { PersonalNameValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { nameFromText } from './name.ts';
import { PersonalNameDisplay } from './PersonalNameDisplay.tsx';
import { PersonalNameEditor } from './PersonalNameEditor.tsx';

export { nameFromText } from './name.ts';

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
  width: 'default',
};
