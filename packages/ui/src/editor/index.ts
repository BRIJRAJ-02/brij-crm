// `@crm/ui/editor`: the rich text editor, a heavy entry of its own (Tiptap and
// ProseMirror), which screens load with import() so it never sits in the
// app's first load. `src/index.ts` must never import from here.
export { NoteEditor, NOTE_CHANGE_MAX_WAIT_MS, type NoteEditorProps } from './NoteEditor.tsx';
export { CHANGE_DEBOUNCE_MS, RichTextEditor, type RichTextEditorProps, type RichTextMode } from './RichTextEditor.tsx';
