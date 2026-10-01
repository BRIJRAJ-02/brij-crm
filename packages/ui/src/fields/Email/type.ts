import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { listFromText, refuse } from '../values.ts';
import { EmailDisplay } from './EmailDisplay.tsx';
import { checkEmail, EmailEditor } from './EmailEditor.tsx';

function one(text: string) {
  const checked = checkEmail(text);
  return checked.ok ? checked.value : refuse(checked.message);
}

/** The email type. */
export const emailType: AttributeTypeDef<'email'> = {
  type: 'email',
  icon: 'at-sign',
  Display: EmailDisplay,
  Editor: EmailEditor,
  operators: () => withEmpty(['is', 'contains']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: (text, context) => (context.attribute.allowMultiple ? listFromText(text, one) : one(text)),
  align: 'start',
  editIn: 'cell',
};
