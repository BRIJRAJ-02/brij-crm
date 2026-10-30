import { parseAmount } from '../../lib/parse-input.ts';
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
  // A spreadsheet's "1,200", "1.2k", "(300)" or "12%" reads as the editor reads it (`parseAmount`).
  fromText: (text, context) =>
    parseAmount(text, { locale: context.locale })?.amount ?? refuse(`“${text.trim()}” isn’t a number.`),
  align: 'end',
  editIn: 'cell',
  width: 'narrow',
};
