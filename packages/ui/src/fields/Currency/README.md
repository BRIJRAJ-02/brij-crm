# Currency

An exact amount and its currency: a deal value, an invoice total.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the currency type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: the Currency atom: the symbol and the amount in the language's format (`$58,500`, `$1,234.50`, `CA$12`), with no decimals for a whole amount and otherwise at least the currency's minor units and at most 4 decimals.
- **Editor**: a Field for the amount (read in the language's format, never through a JS number) with the currency code as a searchable, virtualised picker in front. It starts in the attribute's default currency. The currency sits on each value, so totals can convert mixed currencies (#52). On a form the placeholder is an example amount in the viewer's format, and a hint says: pick the currency, then type the amount.
- **Text out / in** (copy, paste, CSV, the import preview): `USD 1234.5` / with or without the code (the attribute's default currency when none).
- **Polish (30 October 2026)**: A new amount starts in the attribute's default, else the workspace's currency (`useRegionDefaults`), never USD by itself; a new Currency attribute defaults to it too. "$1,200", "1,200 USD", "€5", "1.2k" and "(300)" read, and a symbol or code typed with the amount moves the picker (`parseAmount`), and the hint says so ("Currency changed to EUR."). A pasted amount that reads two ways ("1.200") is refused with both, as a number's is, and the editor says what typed text saves as when its digits change.
- **Filter operators**: =, ≠, >, ≥, <, ≤, between, within one currency, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

The code picker opens with Enter or the arrows and searches as you type; the amount is a Field (Enter commits in a cell, Esc cancels). In a grid cell it is the cell itself (Field's `cell` variant), the code at the start and the amount typed at the end, where they show.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
