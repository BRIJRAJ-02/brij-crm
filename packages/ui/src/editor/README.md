# RichTextEditor and NoteEditor

`@crm/ui/editor`: the rich text editor (spec 0003, `0003-rich-text-and-email.md`), on Tiptap 3, saving Tiptap's JSON as a `RichTextDoc` (`@crm/contracts/values`), never HTML.

## Why it exists

New. Notes (#19), and later comments (#29) and email (#45), need formatted text with mentions; the Field's textarea holds plain text only. It is its own entry, never imported from `src/index.ts` (`entry.test.ts` checks), because Tiptap and ProseMirror are heavy: screens load it with `import('@crm/ui/editor')` when a note first opens, with a Skeleton meanwhile.

## Use

```tsx
<NoteEditor
  key={note.id}
  label="Note"
  title={session.title}
  onTitleChange={session.setTitle}
  titleMaxLength={200}
  defaultValue={note.content}
  onChange={(doc) => session.save(doc)}
  onSearchMentions={(query) => members.search(query)}
  autoFocus={isNew ? 'title' : 'text'}
/>
```

- `RichTextEditor` takes `mode` (`note` only for now; `comment` and `email` come with their features), `label` (the editable's accessible name; not drawn), `value` or `defaultValue` (`RichTextDoc | null`), `onChange(doc)`, `onChangeMaxWait`, `placeholder`, `onSearchMentions(query)`, `isReadOnly`, `readOnlyReason`, `error`, the title (`title`, `onTitleChange`, `titleLabel`, `titlePlaceholder`, `titleMaxLength`) and `autoFocus`.
- It draws as a page, as Notion's do (the owner's call, 21 October 2026): no box, border, fill or focus ring around the text, and the caret marks focus. The text fills what its holder leaves (at least six rows), so a click anywhere under the last line lands in it. Why: a note is writing, not a form; the boxed look made the window read as one. Comment and email modes bring their own frames with their features.
- `title` draws the document's title over the text as the page's own heading: the Field's `title` variant (no box, the note title type), with "Untitled" as its placeholder and "Title" as its name for screen readers. Enter in it goes on to the start of the text; the arrow up on the text's first line, or Backspace in an empty first line, comes back to the end of the title. Without `title`, there is no title.
- `autoFocus`: `title` for a new note (still to be named), `text` for one opened again (the start of its text). Read only takes no focus.
- `NoteEditor` is RichTextEditor in note mode with a note's defaults: the placeholder "Write something, press / for commands, or @ to mention someone" and `onChangeMaxWait` 2,000.
- `onChange` hears a document that parses with `RichTextDocBody`: 300 ms after typing pauses, at most `onChangeMaxWait` ms apart while typing goes on, on blur, and as the editor unmounts (so closing never loses the last words). It never fires for content set from outside.
- To show another document, remount with a new `key`. A changed `value` replaces the text only while the editor isn't focused.
- `onSearchMentions` is read when the editor mounts: without it, `@` stays plain text. With it, typing `@` opens the members list under the `@query`; a chosen member becomes a `mention` node `{ id, label }`, drawn as the Mention chip.
- `readOnlyReason` (with `isReadOnly`) and `error` show under the editor and describe it. A screen that already shows the reason in a Callout can leave `readOnlyReason` out.
- The schema is `extensions.ts`: paragraphs, headings 1 to 3, bold, italic, strike, underline, inline code, highlight, links, bulleted, numbered and task lists (nested), quotes, code blocks, rules, hard breaks and mentions. Its node and mark names equal `RICH_TEXT_NODES` and `RICH_TEXT_MARKS` (`schema.test.ts`). The slash menu and the way back to the title add no node or mark.
- Pasting keeps only what the schema holds: images and anything else outside it are dropped. A link must pass `isSafeLink` (http, https, mailto, tel or a path on this site), typed, pasted or autolinked; links don't open on click while editing.
- Tiptap's injected stylesheet is off (`injectCSS: false`, for `style-src 'self'`), so every style is in the CSS modules, on tokens. Each node draws with a class from `RichTextEditor.module.css`, never stored with the document (links, whose class Tiptap would store, are styled by their `href`).

## Parts

- `FormatToolbar`: a bubble over a selection (Tiptap's BubbleMenu) holding a React Aria Toolbar of ghost ToggleButtons: the marks only (bold, italic, strike, code, highlight) and Link, which swaps the buttons for an address Field (Enter applies, Esc goes back; an empty address removes the link). Why the marks only: blocks come from the slash menu and the markdown shortcuts, as in Notion, so the bubble stays small over the text (21 October 2026).
- The slash menu: typing `/` at a line's start or after a space (never in code) opens the blocks under it, as Notion's command menu: Text, Heading 1 to 3, Bulleted list, Numbered list, To do list, Quote, Divider and Code block, each with the markdown that makes it at the row's end. Typing after the `/` filters them (by name, or a word such as `h1` or `todo`); a bare `/` reads "Type to filter". The pick turns the line into the block (the divider goes in after it). `slash-commands.ts` holds the blocks and the matching, on `@tiptap/suggestion` (Tiptap's own way, already used by mentions; no new dependency).
- `SuggestionList` (now `molecules/SuggestionList`, so the comment composer shares it without reaching the editor's chunk): the `@` list and the `/` menu, one list in the library's Popover (non modal), drawn like a Menu's rows: a member's Avatar, name and email, or a block's icon, name and markdown. Focus stays in the editor, which names the open list in `aria-controls` and the highlighted row in `aria-activedescendant`. Why one: the two lists differ only in what a row holds.
- `MentionView`: a mention inside the editor, drawn as the Mention atom through a React node view.
- The placeholders: the note's while all of it is empty; then, while the text has focus, "Press / for commands" on an empty line under the caret and "Heading 1" (2, 3) in an empty heading.

## States

Empty (placeholders), with every node and mark, typing (onChange), the format toolbar, adding a link (refused, then applied), mentions (open, picked, Esc), the slash menu (open, filtered and picked, each block, nothing matching, Esc, closed on leaving the text), the markdown shortcuts, paste, read only (with the reason), error. `NoteEditor.stories.tsx` shows the note window's states around it in the Modal's peek: new, typing, saved, edited, refused, read only, the slash menu and the selection toolbar.

## Keyboard

- The usual shortcuts: ⌘B, ⌘I, ⌘⇧S (strike), ⌘U, ⌘E (code), ⌘⇧H (highlight), ⌘⌥1 to 3 (headings), ⌘⇧7, ⌘⇧8 and ⌘⇧9 (numbered, bulleted and task lists), ⌘⇧B (quote), ⌘⌥C (code block), ⌘Z and ⌘⇧Z. Markdown shortcuts work too (`# `, `## `, `### `, `- `, `1. `, `[] `, `> `, three backticks and a space, `---`).
- Tab and Shift+Tab indent and outdent a list item; elsewhere Tab leaves the text for the format toolbar (when it shows) and then the page.
- In the title, Enter goes to the text; in the text, the arrow up on the first line (or Backspace in an empty first line) goes back to the title.
- In the format toolbar, the arrows move between buttons, Enter or Space presses one, Esc goes back to the text. Esc in the text over a selection puts the caret at its end, closing the toolbar; the next Esc reaches whatever holds the editor.
- In the members list and the slash menu, up and down move, Enter or Tab picks, Esc closes the list (the dialog around the editor doesn't hear that Esc), and leaving the text closes the slash menu.

## Differences from the artifact

The artifact has no editor yet. `onChangeMaxWait` is new (spec 0019), and so are the title, `autoFocus` and the slash menu (21 October 2026). `variables` and `collaboration` from spec 0003's interface come with email (#45) and shared notes (#27). The editor isn't in the artifact build: its stories sit under `Editor/`, outside the artifact's groups, since the previews can't bundle Tiptap.
