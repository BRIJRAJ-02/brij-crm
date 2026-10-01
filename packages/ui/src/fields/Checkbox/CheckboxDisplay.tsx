import { CheckboxMark } from '../../atoms/Checkbox/Checkbox.tsx';
import type { DisplayProps } from '../types.ts';

/**
 * Checkbox: the Checkbox's look with no control of its own, since a display
 * never edits (the editor is the real Checkbox). Unchecked is false, never
 * empty. In a grid cell the cell is the control, so a scroll past hundreds of
 * rows mounts no checkbox each.
 */
export function CheckboxDisplay({ attribute, value }: DisplayProps<'checkbox'>) {
  return (
    <CheckboxMark
      label={attribute.name}
      isSelected={value === true}
      isReadOnly={attribute.isReadOnly || attribute.computed !== undefined}
    />
  );
}
