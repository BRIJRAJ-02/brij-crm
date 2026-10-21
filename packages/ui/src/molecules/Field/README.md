# Field

The one field design: an 11px label above a 30px input with a hairline `control-border` outline (3:1 on every surface), and a hint or an error below.

## Why it exists

Ported from the artifact's Field card. Every text, number and link attribute is typed through it, in a create form, the record panel, a cell editor, a filter value or an import preview, so a field looks and behaves the same everywhere. It wraps React Aria's `TextField`, so the label, hint and error are wired for screen readers.

## Use

```tsx
<Field label="Domain" placeholder="Set Domain…" hint="Without https:// or a path." />
<Field label="Amount" prefix="USD" inputMode="decimal" />
<Field label="Description" isMultiline maxLength={10000} showCounter />
<Field label="Title" isWrapping maxLength={2000} showCounter onSubmit={save} />
<Field label="Search records" isLabelHidden variant="search" />
```

- `placeholder` follows the Field card: "Set <Attribute>…" (`strings.setAttribute`), except where a type has a shape to show: on a form or a preview the field set gives email, domain, URL, a social profile, number and currency an example ("ada@example.com", "@adalovelace"); a cell, a panel row and a filter hide the label, so they keep "Set <Attribute>…". It is `text-tertiary`, so never put an instruction only there; use `hint`.
- `error` is a sentence that says how to fix it ("Enter a domain like halcyonlabs.io, without spaces."). The outline turns `danger` and the message shows under the box with an icon, in the hint's place: while the field is invalid (its own `error`, or a Form's refusal) the `hint` steps aside, so the field never carries two lines under it and a screen reader hears the one that matters. A read only or disabled reason still shows. The error says how to fix it, so the hint's help isn't lost. With `isErrorFloating` (a grid cell, one line tall) the message floats under the box on a raised surface, over the rows below. It stays inside whatever would clip it (`lib/float-inside.ts`): in the grid's last column it slides in from the end edge, on a grid narrower than the measure it is no wider than the grid, and with no room under the cell it sits over it.
- `info` puts an InfoTip beside the label, for a setting whose label alone isn't clear (a booking page's Minimum notice). Why a variant: the help belongs to the field's own label, and an InfoTip placed outside the field sat apart from it. The label row keeps the label's height, so a field with help lines up with its neighbours.
- `isReadOnly` fills the box with `surface-subtle` and shows a lock; `readOnlyReason` says why, as the hint. `isDisabled` fades it; `disabledReason` says who can change it.
- `descriptionId` sets the `id` of the line under the box (the hint or reason), so a control nearby can point `aria-describedby` at it: SignInForm's buttons read the field's `disabledReason` this way. The input stays described by it.
- `prefix` holds a unit (`USD`, `%`) or a picker (the currency editor's code Select); `suffix` a clear button or a trigger.
- `after` puts controls beside the box, outside it, on the box's line: the Invite dialog's role Select and remove button per address. The box takes the room left, and the label, hint and error stay the box's. Why a variant: as a `suffix` the role and remove sat inside the email's box, which read as one cramped box (the owner, 22 October 2026), and a screen may not lay out a row of its own.
- A browser's autofill never paints a second colour inside the box: the input's autofilled background is clipped to its text, in every variant and theme.
- `isMultiline` is a textarea that grows with its content (long text). `maxLength` stops typing at the limit; with `showCounter` the count ("1,812/2,000") shows once the text is near it (`COUNTER_FROM`, nine tenths of the way), never before: a count always on under every long text field was noise (the owner's call, 20 October 2026).
- `isWrapping` is a one line value that wraps as it grows, such as a task's title: one line tall at rest (the single line field's height), a line more as the text wraps, Enter calls `onSubmit` instead of breaking the line, and a pasted line break becomes a space. Why a variant: a title is one line of text, but a long one should read whole rather than scroll sideways, and a three line textarea for it looked like a description box.
- `size="sm"` is the 26px field of a filter value or a record panel row; `variant="search"` the search field: a magnifier and the sunken fill, on the same corners as every other field (the owner's call, 20 October 2026).
- `variant="copy"` is a value to copy and never to change, such as a booking page's public link: read only, but drawn as a live field (its hairline and surface, no lock), so it never reads as disabled, with an icon Copy button at its end (`copyLabel` names it, "Copy link") and the whole value selected when it takes focus. Why a variant: the read only look says "you may not change this", which made a link meant for sharing look switched off (owner feedback F18, 20 October 2026). With `isMultiline` it holds a code to paste elsewhere, such as a form's embed snippet, in the Code atom's monospace face (`text-code`), its Copy button at the top of the box's end. With `isWrapping` it holds a long link that must read whole (a workspace's address across a settings Card): one line at rest, wrapping at any character when the box is too narrow, its Copy button at the top of the box's end.
- `variant="title"` is a page's own title, such as a note's (with `isWrapping`, so it wraps and Enter calls `onSubmit`): no box, border, fill or focus ring, in the note title type (`text-note-title`, 28px), so it reads as the page's heading; the caret marks focus, as in a document. Read only it stays plain text, with no lock or fill (the page says why it can't be changed), and a refusal shows as the line under it. Why a variant: the title is still a labelled text field with a limit and Enter to go on; only its look differs, and a boxed field made a note read as a form (the owner's call, 21 October 2026).
- `variant="composer"` (with `isMultiline`) is a message being written, such as a comment: one line tall at rest, a line more as the text grows, ten lines at most, then it scrolls. `combobox` names a list it suggests from (a textarea may not take the combobox role, so it stays a textbox with aria-autocomplete) (`listId`, `isExpanded`, the highlighted option's `activeId`, read through `aria-activedescendant` while focus stays in the field), `onKeyDown` sees every key first (⌘Enter to send, and the arrows, Enter, Tab and Esc while the list is open), and `onSelect` hears the caret move. Why a variant: a comment box three lines tall at rest crowded every thread with empty boxes, and the mention list needs the field itself to name the list (CommentComposer, spec 0038).
- `variant="cell"` is what a grid cell becomes while it edits: the input fills the cell at the cell's height and padding, on the cell's text line, with no box, radius or ring of its own. The cell draws the one focus ring, and swaps it for the danger edge while the value is refused, so an editing cell never shows two rings. `align="end"` puts the typed text at the end, where a number's display sits.
- A textarea (`isMultiline`) grows with its text at either size.
- Typed numbers are parsed by the field set, never here (the input stays text, so nothing is lost to a JS number).
- Stack fields with `space-16` between them in modals and panels.

- `suggestions` offers values under the field as small secondary Buttons in a labelled group (`label`, `items`, `onPick`; focus goes back to the field after a pick, since the buttons may go with the answer): first run's web address shows free addresses when the typed one is taken or the first choice was (spec 0036). Why a prop: the values belong to the field (they fill it), sit under its hint or error, and a Tag can't be pressed; the Buttons are the library's own, only the row is Field's CSS.
- `autoFocus` takes focus as it mounts. A list's search inside a popover takes focus through the list's focus scope instead (Select does this), so a popover around it never reads the move as focus leaving.
- Inside a `Popover` (a grid cell's editor, a list's search, a filter's value) the field draws its focus with the accent border alone, no halo: the popover's own edge already frames it, and a halo inside it read as a second ring around the field (the owner, 21 October 2026). Popover tells it through its `InPopover` context; a Modal opened from a popover sets it back.
- Inside a `Form`, a refusal the form holds under the field's `name` shows here like `error`, until the person changes the field. A given `error` wins. The browser's own checks (`required`, `type="email"`) never show their messages: a required field is marked `aria-required`, and the screen or module says what is wrong in the library's words.
- `labelAside` puts a quiet word after the label, such as "(optional)" on a public form: `text-tertiary`, on the same line, and part of the field's accessible name.

- `autoComplete="off"` also puts the password managers' opt outs on the input (`data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"`): a contact's phone or a search is never a login, and one manager drew its icon in a phone cell (the owner, 21 October 2026).

## States

Empty (placeholder), filled, near its limit (the count shows), focus (a 1px `accent-line` border and the faint halo; inside a Popover the border alone, see below), invalid (danger border and message, in place of the hint), read only (filled, lock, reason), disabled (faded, reason), copy (read only, drawn live, with its Copy button, on one line or many). The `cell` variant has none of these looks of its own: its grid cell draws focus and the refusal, and the message floats under the cell on a raised surface. The `title` variant has no box in any state: empty shows its placeholder, read only is plain text.

## Keyboard

Tab reaches it. In a single line field and a wrapping one, Enter calls `onSubmit` (a cell commits on it); in a multiline one it breaks the line.

## Differences from the artifact

- React Aria's props replace the input attributes: `onChange(value)`, `isReadOnly`, `isDisabled`, `isInvalid` through `error`.
- `readOnlyReason` and `disabledReason` replace writing the reason into `hint` by hand. `counter` is `maxLength` with `showCounter`.
- A chosen value (a chip or a status) is no longer `children`: that is the field set's editor for its type.
