import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';

/** Text: a Field input; the text is trimmed, and line breaks become spaces. */
export function TextEditor(props: EditorProps<'text'>) {
  const initial = typeof props.value === 'string' ? props.value : '';
  return (
    <TextLikeEditor<'text'>
      {...props}
      initial={initial}
      check={(draft) => toCommittable<'text'>(props.attribute, draft.trim())}
    />
  );
}
