import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { refuse } from '../values.ts';
import { RatingDisplay } from './RatingDisplay.tsx';
import { RatingEditor } from './RatingEditor.tsx';

/** The rating type: 1 to 5 stars, or none. */
export const ratingType: AttributeTypeDef<'rating'> = {
  type: 'rating',
  icon: 'star',
  Display: RatingDisplay,
  Editor: RatingEditor,
  operators: () => withEmpty(['at_least', 'at_most']),
  toText: (value) => String(value),
  fromText: (text) => {
    const trimmed = text.trim();
    const characters = trimmed.match(/./gu) ?? [];
    const stars = characters.filter((character) => character === '★' || character === '*').length;
    const value = stars > 0 && stars === characters.length ? stars : Number(trimmed);
    return Number.isInteger(value) && value >= 1 && value <= 5
      ? value
      : refuse(`“${trimmed}” isn’t a rating from 1 to 5.`);
  },
  align: 'start',
  editIn: 'cell',
  width: 'narrow',
};
