import { Rating } from '../../atoms/Rating/Rating.tsx';
import type { DisplayProps } from '../types.ts';

/** Rating: the stars, read only, named "Fit: 4 out of 5 stars". */
export function RatingDisplay({ attribute, value }: DisplayProps<'rating'>) {
  return <Rating label={attribute.name} value={typeof value === 'number' ? value : null} isReadOnly />;
}
