import { optionOf } from '../Select/SelectDisplay.tsx';
import { optionByLabel } from '../Select/type.ts';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { StatusDisplay } from './StatusDisplay.tsx';
import { StatusEditor } from './StatusEditor.tsx';

/** The status type: one status, always single. */
export const statusType: AttributeTypeDef<'status'> = {
  type: 'status',
  icon: 'circle-dot',
  Display: StatusDisplay,
  Editor: StatusEditor,
  operators: () => withEmpty(['is', 'is_not', 'is_any_of']),
  toText: (value, context) => optionOf(context.attribute, String(value)).label,
  fromText: (text, context) => optionByLabel(context.attribute, text),
  align: 'start',
  editIn: 'popover',
  closesOnCommit: true,
  isListEditor: true,
  width: 'default',
};
