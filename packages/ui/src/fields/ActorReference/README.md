# ActorReference

Who: a member (an owner, an assignee), or an API key, an automation or the system for what they did.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the actorreference type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a RecordChip with the member's avatar; an API key, an automation and the system show their icon, and the system reads "System". Several are a row with "+N". Names come from the data layer's `ActorDisplay`. On a record's panel the chip is plain (the avatar and the name as text, at the body's weight, `isPlainActorSurface`), so an owner reads like the values around it: the framed chip at the strong weight looked larger and heavier than its row (the owner, 21 October 2026). A record reference beside it stays a framed chip, since a record opens its own page and a member is not a link. A card's chip is flat (`isFlatSurface`).
- **Editor**: one field, drawn like Field's box: the chosen members as flat chips inside it, each with a small Remove, and the rest of the box a button ("Choose <Attribute>…" while empty, then only a chevron, named "Change <Attribute>" or "Add another") that opens a searchable Menu of members under the whole box, "Me" (the `me` prop) first, results from `onSearch` as a ListSource. A click anywhere on the box opens it too. People can only choose members. In a grid cell it edits in the cell's popover, with the search and its results in the panel itself under the chosen chips, never a menu over the panel.
- **Text out / in** (copy, paste, CSV, the import preview): names / a member's exact name, matched ignoring case (members come in `TextContext.members`; `ActorDisplay` carries no email, so email matching waits for #23).
- **Filter operators**: is, is any of, is me, then is empty and is not empty.

- **In a form** the picker draws the attribute's name as its visible label (a group named by it), as Field does; a cell and a panel row name it already. A pick with the pointer hands focus back to the button on the next frame, before the menu has faded, so a key pressed meanwhile (Escape in a dialog) reaches the dialog.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states.

## Keyboard

The button opens the menu (in a grid cell the search is focused at once, starting from the typed key); typing searches; the arrows move; Enter chooses; Esc closes.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
