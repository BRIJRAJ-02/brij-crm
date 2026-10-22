# Currency

An amount with its currency's symbol, as Attio and HubSpot show money.

## Why it exists

Ported from the artifact's Currency card. It is the currency type's one display (cells, the record panel, cards, totals). Screens render it through the field set, never directly (lint).

## Use

```tsx
<Currency value={{ amount: '58500', currency: 'USD' }} /> // $58,500
<Currency value={{ amount: '1234.5', currency: 'USD' }} /> // $1,234.50
```

- The symbol and grouping follow the provider's language through `Intl.NumberFormat` (`$58,500` in en-US, `1.234,50 €` in de-DE). A currency whose symbol would be ambiguous says which (`CA$`, `A$`), so mixed currencies still read apart. It was the code then the digits (`USD 58,500.00`) until 22 October 2026; the owner asked for money as the leading CRMs write it.
- A whole amount shows no decimals (`$58,500`); one with a fraction shows at least the currency's minor units and at most 4 (`$1,234.50`, `$1,234.5678`), formatted from the exact decimal string, never rounded by floating point.

## States

None of its own; an empty value is the field's empty state.

## Keyboard

It takes no focus.

## Differences from the artifact

- `value` (amount and currency) replaces `code` and children, so the amount formats from the stored decimal.
