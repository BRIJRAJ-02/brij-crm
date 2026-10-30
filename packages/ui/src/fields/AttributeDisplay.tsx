// The only way anything draws an attribute value (AC-4): it hands the value to
// its type's one display. Computed and AI values draw as their result type.
import type { AttributeType } from '@crm/contracts/values';
import type { ComponentType } from 'react';
import { fieldTypeOf } from './registry.ts';
import type { DisplayProps } from './types.ts';

/** Props for AttributeDisplay: any type's value, with its attribute. */
export type AttributeDisplayProps = DisplayProps<AttributeType>;

/**
 * A value in the shape its attribute's type reads now. A type change in place (the field types pass) reaches a
 * screen as a new definition and a reread of the column, which can land a moment apart: until the reread lands, a
 * cell may still hold the old type's shape (a select's id under a multi select, a number under a currency), which
 * its new display must not choke on. Anything else passes through untouched.
 */
function shaped(type: AttributeType, allowMultiple: boolean, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (type === 'select' && allowMultiple && typeof value === 'string') return [value];
  if (type === 'currency' && typeof value !== 'object') return null;
  if (type === 'number' && typeof value === 'object') return null;
  if (type === 'phone' && typeof value === 'string') return { number: value };
  return value;
}

/** Draws any attribute value through its type's one display, the same in a cell, the record panel, a card, a filter and a preview. */
export function AttributeDisplay(props: AttributeDisplayProps) {
  const Display = fieldTypeOf(props.attribute.type).Display as ComponentType<AttributeDisplayProps>;
  const value = shaped(props.attribute.type, props.attribute.allowMultiple, props.value);
  return <Display {...props} value={value as AttributeDisplayProps['value']} />;
}
