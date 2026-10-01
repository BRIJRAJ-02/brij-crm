import type { LocationValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { LocationDisplay, shortLocation } from './LocationDisplay.tsx';
import { LocationEditor } from './LocationEditor.tsx';

/** The location type: an address in parts. */
export const locationType: AttributeTypeDef<'location'> = {
  type: 'location',
  icon: 'map-pin',
  Display: LocationDisplay,
  Editor: LocationEditor,
  operators: () => withEmpty(['country_is', 'locality_is', 'region_is']),
  toText: (value, context) => shortLocation(value as LocationValue, context.locale),
  fromText: () => refuse('Addresses can’t be pasted as one line. Edit the parts.'),
  align: 'start',
  editIn: 'popover',
};
