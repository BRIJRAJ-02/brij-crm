# ActorReference

Who: a member (an owner, an assignee), or an API key, an automation or the system for what they did.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the actorreference type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a RecordChip with the member's avatar; an API key, an automation and the system show their icon, and the system reads "System". Several are a row with "+N". Names come from the data layer's `ActorDisplay`.
- **Editor**: a searchable Menu of members, "Me" (the `me` prop) first, results from `onSearch` as a ListSource. People can only choose members; the chosen ones are chips with remove. The grid edits it in a popover.
- **Text out / in** (copy, paste, CSV, the import preview): names / a member's exact name, matched ignoring case (members come in `TextContext.members`; `ActorDisplay` carries no email, so email matching waits for #23).
- **Filter operators**: is, is any of, is me, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states.

## Keyboard

The button opens the menu; typing searches; the arrows move; Enter chooses; Esc closes.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
