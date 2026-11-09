RichTextEditor is where people write: notes, comments and descriptions, drawn as a page with no box around the text.

**Use it for**: a record's notes (`NoteEditor`, a title over the text), comments and long descriptions that need headings, lists, to-dos, links and @mentions. **Don't use it for** one line answers or form questions: use TextField or TextArea.

**The consumer provides**: `label` (the text's accessible name), `defaultContent` (HTML or Tiptap JSON; remount with a new `key` to show another document), `onChange(doc)` (Tiptap JSON, 300ms after typing pauses and on blur, never HTML), `people` for `@`, `placeholder`, `isReadOnly` with `readOnlyReason`, `autoFocus`. `NoteEditor` adds `title`, `onTitleChange` and `autoFocusOn` (`title` for a new note, `text` for one opened again). `SLASH_BLOCKS` lists the `/` menu.

**States**: empty (placeholder, then "Press / for blocks" on an empty line), writing, a selection (format bar), `@` and `/` lists (filtered, nothing matching), read only with its reason.

**Interaction**: ⌘B, ⌘I, ⌘⇧H and the markdown shortcuts (`# `, `- `, `[] `, `> `, `---`). In the lists, ↑ ↓ move, Enter or Tab pick, Esc closes, focus stays in the text. In a note, Enter or ↓ in the title goes to the text and ↑ on its first line comes back. The format bar grows from the selection (transitions.dev 05: 250ms from .97); the lists open in the shared Popover (05); Link swaps the buttons for an address field (a soft text swap). A mention is the shared Mention chip and opens its person in a Popover. To-dos use TaskList's round Checkbox (25 checkbox check) and strike through as they are ticked.

**Replaces**: editor/RichTextEditor, FormatToolbar, MentionView, NoteEditor, the editor's SuggestionList and slash-commands.
