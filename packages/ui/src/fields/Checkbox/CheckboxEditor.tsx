import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface } from '../values.ts';

/** Checkbox: the same Checkbox, toggling in place; each toggle commits. Held while a form sends (`isDisabled`). */
export function CheckboxEditor({ attribute, value, surface, onCommit, isDisabled = false }: EditorProps<'checkbox'>) {
  return (
    <Checkbox
      label={attribute.name}
      isLabelHidden={isCompactSurface(surface)}
      isSelected={value === true}
      isDisabled={isDisabled}
      onChange={onCommit}
    />
  );
}
