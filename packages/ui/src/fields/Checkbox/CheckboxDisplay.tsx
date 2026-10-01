import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import type { DisplayProps } from '../types.ts';

/** Checkbox: the Checkbox itself, read only; unchecked is false, never empty. */
export function CheckboxDisplay({ attribute, value }: DisplayProps<'checkbox'>) {
  return <Checkbox label={attribute.name} isLabelHidden isSelected={value === true} isReadOnly />;
}
