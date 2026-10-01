import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { toCommittable } from '../values.ts';

/** The most a long text holds. */
const LONG_TEXT_MAX = 10_000;

/** Long text: a Field that grows with its content, with a counter; line breaks kept. */
export function LongTextEditor(props: EditorProps<'long_text'>) {
  const initial = typeof props.value === 'string' ? props.value : '';
  return (
    <TextLikeEditor<'long_text'>
      {...props}
      initial={initial}
      isMultiline
      maxLength={LONG_TEXT_MAX}
      check={(draft) => toCommittable<'long_text'>(props.attribute, draft.trim())}
    />
  );
}
