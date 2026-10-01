import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import type { EditorProps } from '../types.ts';

/** Checkbox: the same Checkbox, toggling in place; each toggle commits. */
export function CheckboxEditor({ attribute, value, surface, onCommit }: EditorProps<'checkbox'>) {
  return (
    <Checkbox
      label={attribute.name}
      isLabelHidden={surface === 'cell' || surface === 'filter'}
      isSelected={value === true}
      onChange={onCommit}
    />
  );
}
