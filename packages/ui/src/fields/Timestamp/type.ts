import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { TimestampDisplay } from './TimestampDisplay.tsx';
import { TimestampEditor } from './TimestampEditor.tsx';

/** The timestamp type: an instant, written by the system only. */
export const timestampType: AttributeTypeDef<'timestamp'> = {
  type: 'timestamp',
  icon: 'clock',
  Display: TimestampDisplay,
  Editor: TimestampEditor,
  operators: () => withEmpty(['before', 'after', 'within_last']),
  toText: (value) => (typeof value === 'string' ? value : value.join(', ')),
  fromText: () => refuse('The system sets this time; it can’t be pasted.'),
  align: 'start',
  editIn: 'none',
};
