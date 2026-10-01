import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { listFromText, refuse } from '../values.ts';
import { UrlDisplay } from './UrlDisplay.tsx';
import { checkUrl, UrlEditor } from './UrlEditor.tsx';

function one(text: string) {
  const checked = checkUrl(text);
  return checked.ok ? checked.value : refuse(checked.message);
}

/** The url type. */
export const urlType: AttributeTypeDef<'url'> = {
  type: 'url',
  icon: 'link',
  Display: UrlDisplay,
  Editor: UrlEditor,
  operators: () => withEmpty(['is', 'contains']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: (text, context) => (context.attribute.allowMultiple ? listFromText(text, one) : one(text)),
  align: 'start',
  editIn: 'cell',
  width: 'default',
};
