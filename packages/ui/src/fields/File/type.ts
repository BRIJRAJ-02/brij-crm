import type { FileValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { asList, refuse } from '../values.ts';
import { FileDisplay } from './FileDisplay.tsx';
import { FileEditor } from './FileEditor.tsx';

/** The file type: uploaded files, stored by #32. */
export const fileType: AttributeTypeDef<'file'> = {
  type: 'file',
  icon: 'file',
  Display: FileDisplay,
  Editor: FileEditor,
  operators: () => withEmpty(['name_contains']),
  toText: (value) =>
    asList<FileValue>(value)
      .map((file) => file.name)
      .join(', '),
  fromText: () => refuse('Files can’t be pasted as text. Upload them.'),
  align: 'start',
  editIn: 'popover',
  width: 'wide',
};
