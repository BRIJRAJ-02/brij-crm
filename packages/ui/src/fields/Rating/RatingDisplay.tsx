import { Rating } from '../../atoms/Rating/Rating.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Rating: the stars, read only, named "Fit: 4 out of 5 stars"; no rating is the empty value, never five grey stars. */
export function RatingDisplay({ attribute, value, surface }: DisplayProps<'rating'>) {
  if (typeof value !== 'number') return <EmptyValue surface={surface} />;
  return <Rating label={attribute.name} value={value} isReadOnly />;
}
