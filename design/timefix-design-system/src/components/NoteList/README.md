A record's notes as cards, and the surface for writing one, which saves as you type.

**Use it for**: the Notes tab and section of a record, meeting notes. **Don't** use it for comments (CommentThread) or for long documents with rich blocks.

**The consumer provides**: for `NoteList`, `notes` (`title`, `body`, `author`, `updated`), `onOpen`, `onNew`, `freshIds`. For `NotePage`, the `note`, `onSave` (a promise), `onBack` and `people` for `@`; it writes with RichTextEditor's `NoteEditor`, the one note editor. `NoteCard` and `SaveIndicator` are exported for record panels and other surfaces.

**States**: empty (a dashed card that says what notes are for), cards with a two-line preview, untitled, editing, saving, saved.

**Interaction**: cards lift their shadow on hover and press to .98. Writing uses NoteEditor: select text for the format bar (⌘B, ⌘I), `/` for blocks, `@` for people. Typing shows "Saving…" with a shimmer sweeping the text (shimmer text), then crossfades to a tick and "Saved" 600ms after typing stops (text swap). List to editor and back slide side by side (page side-by-side).

**Replaces**: NoteList.
