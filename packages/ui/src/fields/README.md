# The field set

One display and one editor per attribute type, registered once (spec 0003, `0003-attribute-values.md`, house rule 3).

## Why it exists

So a value looks and edits the same everywhere: a tag in a grid cell is the same Tag in the record panel, on a board card, in a filter and in the import preview. An attribute type is built in one place and fixed in one place.

## Use

```tsx
<AttributeDisplay attribute={attribute} value={value} display={display} surface="cell" />
<AttributeEditor attribute={attribute} value={value} surface="panel" onCommit={save} onSearch={searchMembers} me={me} />
```

- `AttributeDisplay` and `AttributeEditor` are the only way anything draws or edits a value. Screens never import the value atoms (Tag, StatusDot, Currency, Rating, LinkChip, TagList); lint refuses it.
- `surface` (`cell`, `panel`, `card`, `form`, `filter`, `preview`) changes behaviour only: a cell commits on Enter; a form is always in edit mode. Looks adapt to the slot: on a cell, a filter and a record panel row (`isCompactSurface`) editors are small and hide their label, since the name sits beside them already. On a card (a board card, a line of the timeline) chips are flat (`isFlatSurface`): a link is its text alone and a record's or member's chip grey with no edge. On a record's panel a member is plain (`isPlainActorSurface`), the avatar and the name as text like the values around it, while a record stays a framed chip, since it opens its own page (the owner, 21 October 2026). Each is decided once in `values.ts`, never in a display.
- `display` carries the data layer's display shapes (names and pictures for references, members and files); fields never resolve ids.
- Editors commit only values that parse with the type's schema from `@crm/contracts/values`, `null` to clear, or nothing while the input is invalid; the Field shows how to fix it (AC-5). A required attribute refuses empty with "<Name> is required.", unless the attribute says `isRequiredOnSubmit` (a create dialog that checks Required as it submits, spec 0012): then an empty editor commits nothing and stays quiet as focus leaves, so nothing moves under the pointer, while the field still reads as required. Uniqueness is the server's; pass its refusal back as `error`.
- A read only, computed or system value (timestamp, interaction) shows read only with its reason, from `readOnlyReasonOf(attribute)`: its own, else "Worked out by the system", "Set by the system" or "Read only". An AI value edits as its result type; a hand edit replaces it, and `onRefresh` adds Refresh.
- `iconOf(attribute)` is the icon beside an attribute's name (a record's details, a column header, a filter or sort picker, settings): its type's icon, except for a few standard attributes whose type says too little, named by `apiSlug` (a time zone is text, so it takes `earth`; an avatar or a logo is a URL, so it takes `image`). Only the icon differs; the display and editor stay the type's.
- Member and record pickers (ReferencePicker, shared by ActorReference and RecordReference) are one field outside a grid cell: a box drawn like Field's, holding the chosen chips with their small Removes, and a button filling the rest that opens the search under the whole box. Why its own box: Field is a text input (React Aria's TextField) and can't hold chips and buttons; the box uses the same tokens, so the two read as one design.
- Link types that hold several values (emails, phones, domains, URLs: `ListEditor`) are their chips with small Removes, over a field that adds one more. A chip is LinkChip's pressable variant, opening its menu: Make primary (focus stays on the moved chip) and Edit, which puts the value in the add field, focused, with its chip hidden; Enter replaces it in place, and Esc or leaving the field empty keeps it as it was. On a form (any surface but a cell, a filter or a panel row) the attribute's name leads, over the chips, in a FieldGroup, as every field's label sits over its value; the list keeps the name too, and the add field under them keeps it for screen readers. Enter with a value typed adds it and never submits the form around it (a create dialog, New meeting's Also invite); Enter in the empty add field lets the form submit, as InviteRows does.
- Text, number and link editors set `autoComplete="off"`: the value is a record's, never the viewer's own, so neither browser autofill nor a password manager should treat the field as theirs.
- `typeLabelOf(type)` is the type's name for people ("Long text", "URL"), which a type picker shows beside the type's `icon` (spec 0005, "Add attribute").
- `fieldTypeOf(type)` gives the grid and filters each type's `operators(attribute)`, `toText` and `fromText` (copy, paste, CSV, the import preview), `align` and `editIn`, and for the grid `isListEditor(attribute)` (a status or a short single select edits as its open list; a long or multiple select searches in the cell's popover), `closesOnCommit` (one choice finishes it), `togglesInPlace` and `cleared` (a checkbox toggles where it is, and clears to `false`).
- `isDisabled` holds an editor while the form around it sends (a dialog's commit in flight): the value takes no change until the answer. A typed field and a list's add field take Field's disabled look and a list's Removes are off, while its chips stay as they are; a member or record picker fades its whole box (a group marked `aria-disabled` on a form). Every editor honours it: typed, list, picker, select, status, date, checkbox, rating, name, location and file.
- **Forgiving input** (`lib/parse-input.ts`, 30 October 2026): every editor and each type's `fromText` read what people paste the same way, so an editor, a grid paste and an import agree. Amounts take "$1,200", "€5", "1.2k", "2M", "(300)", "1,200 USD" and "12%" (`parseAmount`; a symbol or code also moves a currency's picker); an email takes "mailto:", "Ada <ada@x.com>" and a trailing "." (`cleanEmail`); a date takes words ("tomorrow", "next fri", "8 Oct 2026", an ISO instant; `parseDateInput`, with `TextContext.today`); a list splits a pasted "a@x.com, b@x.com" into its values (`splitPasted`, on spaces too for emails, domains and links); a name splits "Ada Lovelace" into first and last; an address reads "London, UK" into its parts.
- **Copy** (`ValueActions` in `parts.tsx`, decided by `showsValueActions` in values.ts): on the record panel an email, phone, domain, URL or text value has Copy after it, shown on hover or focus with a pointer and always under a finger. Not in a grid cell (⌘C copies the cell) and not on a card (one row to press and drag). A link chip already opens; Copy is what people otherwise reached by opening mailto or selecting the text.
- **Create inline** (`FieldActionsContext`, `actions.ts`): a screen says once how it makes an option, a record or an upload, and every `AttributeEditor` under it offers "Create "<typed>"" the same way (a prop on the editor still wins, as the grid's per cell one does). The record's details, New record (so a board column's too) and Bulk edit give schema managers Create in a select or status, as a table cell does.
- **Empty words**: a type whose empty says something on its own registers `emptyWord` (an interaction's "No contact"); its display shows it everywhere and a record's details write it in place of "Not set".
- `limit` on the attribute caps a list (`{ count, message }`, New meeting's 10 guests): one more typed into the add field is refused there with the message, and what was typed stays.
- `autoOpen` (the grid sets it when it starts an edit; a dialog whose whole task is the pick sets it too, as a booking's Link to a record does with nothing picked) opens a list, menu or search at once, so one key reaches the choices; closing a list ends the edit through `onCancel`. A search starts from `startText`.
- In a cell, a typed field is the cell itself (Field's `cell` variant): the same height, padding and text line as the value it replaces, numbers and amounts at the end, and no box or ring of its own, so the cell's ring is the one focus mark and its danger edge the one refusal mark. Its error floats under the cell on a raised surface, over the rows below. A rating's arrows and a typed digit choose a draft that Enter commits and Esc drops.
- Esc in a typed editor (text, number, email, link, phone and the like) puts the draft back in a cell, a panel row, a card and a filter. On a `form` surface (a create or edit dialog) it goes on to the dialog, which closes, as it does from every other field there, unless the caller passes its own `onCancel` (`escapesHere` in values.ts).

Each type's folder has its display, its editor, its `type.ts` registry entry, its stories and a README with its pairing, its text conversion and its operators.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers; a record's details write their own empty words, "Set <Attribute>…" or "Not set" when read only), a value, several values ("+N" past `maxVisible`; in a grid cell, with no `maxVisible`, the row measures its chips once per value and column width and shows as many whole chips as fit, only the last one truncating, through `ChipFitContext`, which GridCell provides), read only, and each editor's own.

## Keyboard

Each editor's, through the component it uses (Field, Select, Menu, DatePicker, Checkbox, Rating).

## Differences from the artifact

The artifact's Field card table is the source; Personal name, Actor reference, Interaction and File are added, and Multi select folds into Select with "allow multiple" (spec 0003).
