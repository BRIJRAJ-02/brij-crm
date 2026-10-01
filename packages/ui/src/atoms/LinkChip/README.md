# LinkChip

An email, phone, domain or URL value as a link chip.

## Why it exists

Ported from the artifact's LinkChip card. It is the one display for the email, phone, domain and URL types, so a domain looks the same in a cell, the record panel and on a card. Screens render it through the field set, never directly (lint).

## Use

```tsx
<LinkChip href="mailto:ada@example.com">ada@example.com</LinkChip>
<LinkChip href="https://example.com">example.com</LinkChip>
```

- `href` passes `safeHref()`: `mailto:`, `tel:`, `http`, `https` and app paths only. Links out open in a new tab. Anything else renders as a plain grey chip with no link (AC-14).
- A long value is cut with an ellipsis; the cell or panel shows the full text in a tooltip.

## States

Hover underlines it; focus shows the ring. A refused link is plain.

## Keyboard

Tab reaches it; Enter follows it.

## Differences from the artifact

- `children` is the shown text only; the protocol allowlist is new.
