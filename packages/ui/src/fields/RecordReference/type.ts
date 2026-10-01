import type { RecordReferenceValue, RecordRefDisplay } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { asList, refuse } from '../values.ts';
import { RecordReferenceDisplay, recordDisplayOf } from './RecordReferenceDisplay.tsx';
import { RecordReferenceEditor } from './RecordReferenceEditor.tsx';

/** The record reference type: links to records of the objects its relation allows. `allowMultiple` follows the relation's cardinality. */
export const recordReferenceType: AttributeTypeDef<'record_reference'> = {
  type: 'record_reference',
  icon: 'arrow-up-right',
  Display: RecordReferenceDisplay,
  Editor: RecordReferenceEditor,
  operators: () => withEmpty(['is', 'is_any_of', 'through']),
  toText: (value, context) => {
    const displays = asList<RecordRefDisplay>(
      context.display as RecordRefDisplay | readonly RecordRefDisplay[] | undefined,
    );
    return asList<RecordReferenceValue>(value)
      .map((record) => recordDisplayOf(record, displays).name)
      .join(', ');
  },
  fromText: () => refuse('Linked records can’t be pasted as text. Choose the records.'),
  align: 'start',
  editIn: 'popover',
  width: 'default',
};
