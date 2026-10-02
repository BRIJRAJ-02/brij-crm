import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface } from '../values.ts';

/** Checkbox: the same Checkbox, toggling in place; each toggle commits. */
export function CheckboxEditor({ attribute, value, surface, onCommit }: EditorProps<'checkbox'>) {
  return (
    <Checkbox
      label={attribute.name}
      isLabelHidden={isCompactSurface(surface)}
      isSelected={value === true}
      onChange={onCommit}
    />
  );
}
