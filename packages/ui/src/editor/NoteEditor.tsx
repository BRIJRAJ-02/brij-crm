// The note window's editor (spec 0019): RichTextEditor in note mode with a
// note's defaults, so a screen passes only what is particular to its note.
import { RichTextEditor, type RichTextEditorProps } from './RichTextEditor.tsx';
import { strings } from './strings.ts';

/** How long a note's `onChange` may wait while typing goes on: two seconds (spec 0019). */
export const NOTE_CHANGE_MAX_WAIT_MS = 2_000;

/** Props for NoteEditor: RichTextEditor's, without the mode, and with a note's defaults. */
export type NoteEditorProps = Omit<RichTextEditorProps, 'mode' | 'placeholder' | 'onChangeMaxWait'> & {
  /** Shown while the note is empty; "Write a note. Type @ to mention someone." by default. */
  readonly placeholder?: string;
  /** The most milliseconds `onChange` waits while typing goes on; 2,000 by default. */
  readonly onChangeMaxWait?: number;
};

/** A note's body: RichTextEditor in note mode, saving at most every two seconds while typing goes on. */
export function NoteEditor({
  placeholder = strings.notePlaceholder,
  onChangeMaxWait = NOTE_CHANGE_MAX_WAIT_MS,
  ...props
}: NoteEditorProps) {
  return <RichTextEditor {...props} mode="note" placeholder={placeholder} onChangeMaxWait={onChangeMaxWait} />;
}
