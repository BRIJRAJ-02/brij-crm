# Currency

An amount as its currency code, then the digits.

## Why it exists

Ported from the artifact's Currency card. It is the currency type's one display (cells, the record panel, cards, totals). Screens render it through the field set, never directly (lint).

## Use

```tsx
<Currency value={{ amount: '1234.5', currency: 'USD' }} /> // USD 1,234.50
```

- The code always comes first, whatever the language, so mixed currencies line up in a column.
- The digits format in the provider's language from the exact decimal string: at least the currency's minor units (2 for USD, 0 for JPY) and at most 4 decimals, never rounded by floating point.

## States

None of its own; an empty value is the field's empty state.

## Keyboard

It takes no focus.

## Differences from the artifact

- `value` (amount and currency) replaces `code` and children, so the amount formats from the stored decimal.
