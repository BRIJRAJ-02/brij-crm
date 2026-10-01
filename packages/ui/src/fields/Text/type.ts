import { TextValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { TextDisplay } from './TextDisplay.tsx';
import { TextEditor } from './TextEditor.tsx';

/** The text type: one line, up to 500 characters. */
export const textType: AttributeTypeDef<'text'> = {
  type: 'text',
  icon: 'type',
  Display: TextDisplay,
  Editor: TextEditor,
  operators: () => withEmpty(['is', 'is_not', 'contains', 'does_not_contain']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: (text) => {
    const parsed = TextValue.safeParse(text);
    return parsed.success ? parsed.data : refuse(parsed.error.issues[0]?.message ?? 'This text doesn’t fit.');
  },
  align: 'start',
  editIn: 'cell',
  width: 'default',
};
