import { useRef, useState } from 'react';
import { useKeyboard } from 'react-aria';
import { Rating } from '../../atoms/Rating/Rating.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';

const DIGIT = /^[1-5]$/;

/**
 * Rating: the Rating atom; choosing the chosen star again clears it, unless
 * the attribute is required. In a cell the arrows and a typed digit choose a
 * draft that Enter commits and Esc drops, so moving across the stars writes
 * nothing; a click commits at once.
 */
export function RatingEditor({ attribute, value, surface, onCommit, onCancel, startText }: EditorProps<'rating'>) {
  const initial = typeof value === 'number' ? value : null;
  const [draft, setDraft] = useState(startText !== undefined && DIGIT.test(startText) ? Number(startText) : initial);
  const isPointer = useRef(false);
  const commit = (next: number | null) => {
    const result = toCommittable<'rating'>(attribute, next);
    if (result.ok) onCommit(result.value);
  };
  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === 'Enter') commit(draft);
      else if (event.key === 'Escape') onCancel?.();
      else if (DIGIT.test(event.key)) setDraft(Number(event.key));
      else event.continuePropagation();
    },
  });
  if (surface !== 'cell') return <Rating label={attribute.name} value={initial} onChange={commit} />;
  return (
    <span
      {...keyboardProps}
      onPointerDown={() => {
        isPointer.current = true;
      }}
    >
      <Rating
        label={attribute.name}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          if (isPointer.current) commit(next);
          isPointer.current = false;
        }}
      />
    </span>
  );
}
