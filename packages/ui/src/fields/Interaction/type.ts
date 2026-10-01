import type { InteractionValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { InteractionDisplay } from './InteractionDisplay.tsx';
import { InteractionEditor } from './InteractionEditor.tsx';

/** The interaction type: the last email or meeting with a record, written by the system. */
export const interactionType: AttributeTypeDef<'interaction'> = {
  type: 'interaction',
  icon: 'mail',
  Display: InteractionDisplay,
  Editor: InteractionEditor,
  operators: () => withEmpty(['before', 'after', 'within_last', 'kind_is']),
  toText: (value) => {
    const interaction = value as InteractionValue;
    return `${interaction.at} ${interaction.kind}`;
  },
  fromText: () => refuse('The system records interactions; they can’t be pasted.'),
  align: 'start',
  editIn: 'none',
};
