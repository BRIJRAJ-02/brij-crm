import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { CheckboxDisplay } from './CheckboxDisplay.tsx';
import { CheckboxEditor } from './CheckboxEditor.tsx';

const TRUE = new Set(['true', 'yes', '1', 'x', 'y', '✓']);
const FALSE = new Set(['false', 'no', '0', 'n', '']);

/** The checkbox type: true or false, never empty. */
export const checkboxType: AttributeTypeDef<'checkbox'> = {
  type: 'checkbox',
  icon: 'square-check',
  Display: CheckboxDisplay,
  Editor: CheckboxEditor,
  operators: () =>
    withEmpty(['is_checked', 'is_not_checked']).filter((operator) => !operator.operator.endsWith('empty')),
  toText: (value) => (value === true ? 'TRUE' : 'FALSE'),
  fromText: (text) => {
    const word = text.trim().toLowerCase();
    if (TRUE.has(word)) return true;
    if (FALSE.has(word)) return false;
    return refuse(`“${text.trim()}” isn’t yes or no. Use true or false.`);
  },
  align: 'start',
  editIn: 'cell',
  cleared: false,
  togglesInPlace: true,
  width: 'narrow',
};
