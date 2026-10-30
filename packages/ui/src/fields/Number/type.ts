import { formatDecimal } from '../../lib/format.ts';
import { ambiguousAmount, parseAmount, unambiguousDecimal } from '../../lib/parse-input.ts';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { strings } from '../strings.ts';
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
  // Three decimals gain a trailing 0, so a copied 1.234 pastes back as itself in any language.
  toText: (value) => (typeof value === 'string' ? unambiguousDecimal(value) : value.join(', ')),
  // A spreadsheet's "1,200", "1.2k", "(300)" or "12%" reads as the editor reads it (`parseAmount`); "1.200" could be
  // 1.2 or 1,200, so it is refused with both, never guessed.
  fromText: (text, context) => {
    const twoWays = ambiguousAmount(text, context.locale);
    if (twoWays !== undefined) {
      return refuse(
        strings.ambiguousNumber(
          formatDecimal(twoWays.asDecimal, context.locale),
          formatDecimal(twoWays.asGrouped, context.locale),
        ),
      );
    }
    return parseAmount(text, { locale: context.locale })?.amount ?? refuse(`“${text.trim()}” isn’t a number.`);
  },
  align: 'end',
  editIn: 'cell',
  width: 'narrow',
};
