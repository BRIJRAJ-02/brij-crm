// The only way anything draws an attribute value (AC-4): it hands the value to
// its type's one display. Computed and AI values draw as their result type.
import type { AttributeType } from '@crm/contracts/values';
import type { ComponentType } from 'react';
import { fieldTypeOf } from './registry.ts';
import type { DisplayProps } from './types.ts';

/** Props for AttributeDisplay: any type's value, with its attribute. */
export type AttributeDisplayProps = DisplayProps<AttributeType>;

/** Draws any attribute value through its type's one display, the same in a cell, the record panel, a card, a filter and a preview. */
export function AttributeDisplay(props: AttributeDisplayProps) {
  const Display = fieldTypeOf(props.attribute.type).Display as ComponentType<AttributeDisplayProps>;
  return <Display {...props} />;
}
