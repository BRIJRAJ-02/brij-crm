import type { LocationValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { LocationDisplay, shortLocation } from './LocationDisplay.tsx';
import { LocationEditor } from './LocationEditor.tsx';
import { locationFromText } from './parse.ts';

/** The location type: an address in parts. */
export const locationType: AttributeTypeDef<'location'> = {
  type: 'location',
  icon: 'map-pin',
  Display: LocationDisplay,
  Editor: LocationEditor,
  operators: () => withEmpty(['country_is', 'locality_is', 'region_is']),
  toText: (value, context) => shortLocation(value as LocationValue, context.locale),
  // "London, UK" or a whole address on one line fills the parts as the editor's first line does.
  fromText: (text, context) =>
    locationFromText(text, context.locale) ?? refuse('Type an address, such as London, United Kingdom.'),
  align: 'start',
  editIn: 'popover',
  width: 'wide',
};
