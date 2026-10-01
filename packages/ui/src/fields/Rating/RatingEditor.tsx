import { Rating } from '../../atoms/Rating/Rating.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';

/** Rating: the Rating atom; choosing the chosen star again clears it, unless the attribute is required. */
export function RatingEditor({ attribute, value, onCommit }: EditorProps<'rating'>) {
  return (
    <Rating
      label={attribute.name}
      value={typeof value === 'number' ? value : null}
      onChange={(next) => {
        const result = toCommittable<'rating'>(attribute, next);
        if (result.ok) onCommit(result.value);
      }}
    />
  );
}
