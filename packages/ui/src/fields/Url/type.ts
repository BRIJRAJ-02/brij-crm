import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef, FieldAttribute } from '../types.ts';
import { listFromText, refuse } from '../values.ts';
import { UrlDisplay } from './UrlDisplay.tsx';
import { checkUrl, UrlEditor } from './UrlEditor.tsx';

/** One typed value (paste, CSV, the import preview) checked as the editor checks it: a network's attribute takes a handle. */
function one(text: string, attribute: FieldAttribute) {
  const checked = checkUrl(text, attribute);
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
  fromText: (text, context) =>
    context.attribute.allowMultiple
      ? listFromText(text, (item) => one(item, context.attribute))
      : one(text, context.attribute),
  align: 'start',
  editIn: 'cell',
  width: 'default',
};
