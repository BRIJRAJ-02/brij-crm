import { toCanonicalDecimal } from '@crm/contracts/values';
import { parseLocaleDecimal } from '../../lib/decimal.ts';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { NumberDisplay } from './NumberDisplay.tsx';
import { NumberEditor } from './NumberEditor.tsx';

/** The number type: an exact decimal, up to 14 digits and 4 decimals. */
export const numberType: AttributeTypeDef<'number'> = {
  type: 'number',
  icon: 'hash',
  Display: NumberDisplay,
  Editor: NumberEditor,
  operators: () => withEmpty(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: (text, context) => {
    const value = parseLocaleDecimal(text, context.locale) ?? toCanonicalDecimal(text);
    return value ?? refuse(`“${text.trim()}” isn’t a number.`);
  },
  align: 'end',
  editIn: 'cell',
  width: 'narrow',
};
