# RichTextEditor and NoteEditor

`@crm/ui/editor`: the rich text editor (spec 0003, `0003-rich-text-and-email.md`), on Tiptap 3, saving Tiptap's JSON as a `RichTextDoc` (`@crm/contracts/values`), never HTML.

## Why it exists

New. Notes (#19), and later comments (#29) and email (#45), need formatted text with mentions; the Field's textarea holds plain text only. It is its own entry, never imported from `src/index.ts` (`entry.test.ts` checks), because Tiptap and ProseMirror are heavy: screens load it with `import('@crm/ui/editor')` when a note first opens, with a Skeleton meanwhile.

## Use

```tsx
<NoteEditor
  key={note.id}
  label="Note"
  defaultValue={note.content}
  onChange={(doc) => session.save(doc)}
  onSearchMentions={(query) => members.search(query)}
/>
```

- `RichTextEditor` takes `mode` (`note` only for now; `comment` and `email` come with their features), `label` (the editable's accessible name; not drawn), `value` or `defaultValue` (`RichTextDoc | null`), `onChange(doc)`, `onChangeMaxWait`, `placeholder`, `onSearchMentions(query)`, `isReadOnly`, `readOnlyReason` and `error`.
- `NoteEditor` is RichTextEditor in note mode with a note's defaults: the placeholder "Write a note. Type @ to mention someone." and `onChangeMaxWait` 2,000.
- `onChange` hears a document that parses with `RichTextDocBody`: 300 ms after typing pauses, at most `onChangeMaxWait` ms apart while typing goes on, on blur, and as the editor unmounts (so closing never loses the last words). It never fires for content set from outside.
- To show another document, remount with a new `key`. A changed `value` replaces the text only while the editor isn't focused.
- `onSearchMentions` is read when the editor mounts: without it, `@` stays plain text. With it, typing `@` opens the members list under the `@query`; a chosen member becomes a `mention` node `{ id, label }`, drawn as the Mention chip.
- `readOnlyReason` (with `isReadOnly`) and `error` show under the editor and describe it. A screen that already shows the reason in a Callout can leave `readOnlyReason` out.
- The schema is `extensions.ts`: paragraphs, headings 1 to 3, bold, italic, strike, underline, inline code, highlight, links, bulleted, numbered and task lists (nested), quotes, code blocks, rules, hard breaks and mentions. Its node and mark names equal `RICH_TEXT_NODES` and `RICH_TEXT_MARKS` (`schema.test.ts`).
- Pasting keeps only what the schema holds: images and anything else outside it are dropped. A link must pass `isSafeLink` (http, https, mailto, tel or a path on this site), typed, pasted or autolinked; links don't open on click while editing.
- Tiptap's injected stylesheet is off (`injectCSS: false`, for `style-src 'self'`), so every style is in the CSS modules, on tokens. Each node draws with a class from `RichTextEditor.module.css`, never stored with the document (links, whose class Tiptap would store, are styled by their `href`).

## Parts

- `FormatToolbar`: a bubble over a selection (Tiptap's BubbleMenu) holding a React Aria Toolbar of ghost ToggleButtons: bold, italic, strike, code, highlight, heading, subheading, bulleted, numbered and task lists, quote, and Link, which swaps the buttons for an address Field (Enter applies, Esc goes back; an empty address removes the link).
- `MentionList`: the `@` list in the library's Popover (non modal), drawn like a Menu's rows with each member's Avatar, name and email. Focus stays in the editor, which names the list in `aria-controls` and the highlighted member in `aria-activedescendant`.
- `MentionView`: a mention inside the editor, drawn as the Mention atom through a React node view.

## States

Empty (placeholder), with every node and mark, typing (onChange), the format toolbar, adding a link (refused, then applied), mentions (open, picked, Esc), paste, read only (with the reason), error.

## Keyboard

- The usual shortcuts: ⌘B, ⌘I, ⌘⇧S (strike), ⌘U, ⌘E (code), ⌘⇧H (highlight), ⌘⌥1 to 3 (headings), ⌘⇧7, ⌘⇧8 and ⌘⇧9 (numbered, bulleted and task lists), ⌘⇧B (quote), ⌘⌥C (code block), ⌘Z and ⌘⇧Z. Markdown shortcuts work too (`# `, `- `, `1. `, `[ ] `, `> `, three backticks).
- Tab and Shift+Tab indent and outdent a list item; elsewhere Tab leaves the text for the format toolbar (when it shows) and then the page.
- In the format toolbar, the arrows move between buttons, Enter or Space presses one, Esc goes back to the text.
- In the members list, up and down move, Enter or Tab inserts the member, Esc closes the list (the dialog around the editor doesn't hear that Esc).

## Differences from the artifact

The artifact has no editor yet. `onChangeMaxWait` is new (spec 0019). `variables` and `collaboration` from spec 0003's interface come with email (#45) and shared notes (#27). The editor isn't in the artifact build: its stories sit under `Editor/`, outside the artifact's groups, since the previews can't bundle Tiptap.
