import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { listFromText, refuse } from '../values.ts';
import { DomainDisplay } from './DomainDisplay.tsx';
import { checkDomain, DomainEditor } from './DomainEditor.tsx';

function one(text: string) {
  const checked = checkDomain(text);
  return checked.ok ? checked.value : refuse(checked.message);
}

/** The domain type. */
export const domainType: AttributeTypeDef<'domain'> = {
  type: 'domain',
  icon: 'globe',
  Display: DomainDisplay,
  Editor: DomainEditor,
  operators: () => withEmpty(['is', 'contains']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: (text, context) => (context.attribute.allowMultiple ? listFromText(text, one) : one(text)),
  align: 'start',
  editIn: 'cell',
  width: 'default',
};
