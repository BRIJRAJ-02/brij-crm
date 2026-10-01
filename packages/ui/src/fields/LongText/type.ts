import { LongTextValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { LongTextDisplay } from './LongTextDisplay.tsx';
import { LongTextEditor } from './LongTextEditor.tsx';

/** The long text type: plain text with its line breaks, up to 10,000 characters. */
export const longTextType: AttributeTypeDef<'long_text'> = {
  type: 'long_text',
  icon: 'file-text',
  Display: LongTextDisplay,
  Editor: LongTextEditor,
  operators: () => withEmpty(['contains', 'does_not_contain']),
  toText: (value) => (typeof value === 'string' ? value : value.join('\n')),
  fromText: (text) => {
    const parsed = LongTextValue.safeParse(text);
    return parsed.success ? parsed.data : refuse(parsed.error.issues[0]?.message ?? 'This text doesn’t fit.');
  },
  align: 'start',
  editIn: 'popover',
};
