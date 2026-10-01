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
- `surface` (`cell`, `panel`, `card`, `form`, `filter`, `preview`) changes behaviour only: a cell commits on Enter and hides labels; a form is always in edit mode. Looks adapt to the slot.
- `display` carries the data layer's display shapes (names and pictures for references, members and files); fields never resolve ids.
- Editors commit only values that parse with the type's schema from `@crm/contracts/values`, `null` to clear, or nothing while the input is invalid; the Field shows how to fix it (AC-5). A required attribute refuses empty with "<Name> is required." Uniqueness is the server's; pass its refusal back as `error`.
- A read only, computed or system value (timestamp, interaction) shows read only with its reason. An AI value edits as its result type; a hand edit replaces it, and `onRefresh` adds Refresh.
- `fieldTypeOf(type)` gives the grid and filters each type's `operators(attribute)`, `toText` and `fromText` (copy, paste, CSV, the import preview), `align` and `editIn`.

Each type's folder has its display, its editor, its `type.ts` registry entry, its stories and a README with its pairing, its text conversion and its operators.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, several values ("+N" past `maxVisible`), read only, and each editor's own.

## Keyboard

Each editor's, through the component it uses (Field, Select, Menu, DatePicker, Checkbox, Rating).

## Differences from the artifact

The artifact's Field card table is the source; Personal name, Actor reference, Interaction and File are added, and Multi select folds into Select with "allow multiple" (spec 0003).
