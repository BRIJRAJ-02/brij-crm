# Currency

An exact amount and its currency: a deal value, an invoice total.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the currency type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: the Currency atom: the code, then the amount in the language's format, with at least the currency's minor units and at most 4 decimals.
- **Editor**: a Field for the amount (read in the language's format, never through a JS number) with the currency code as a searchable, virtualised picker in front. It starts in the attribute's default currency. The currency sits on each value, so totals can convert mixed currencies (#52).
- **Text out / in** (copy, paste, CSV, the import preview): `USD 1234.5` / with or without the code (the attribute's default currency when none).
- **Filter operators**: =, ≠, >, ≥, <, ≤, between, within one currency, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

The code picker opens with Enter or the arrows and searches as you type; the amount is a Field (Enter commits in a cell, Esc cancels).

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
