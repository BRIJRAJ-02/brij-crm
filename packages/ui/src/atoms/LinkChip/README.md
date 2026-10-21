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
- `isFlat` drops the edge and the fill: the link's text alone, on the chip's line. The field set uses it on a card (a board card, a line of the timeline). Why a variant: in the timeline a cleared phone drew as a big blue chip going to the empty mark, heavier than the words around it (the owner, 21 October 2026); RecordChip is already flat there.

- `mark` puts a brand's mark (ProviderMark, `sm`) before the words: the url field passes a social profile's network, so a LinkedIn link reads as the LinkedIn mark and the handle. Why a variant and not a new chip: it is the same link chip, colour, focus and size, with one more thing at its start; the mark is labelled, so the link's name says the network. `title` carries the whole link as a tooltip when the words are only its domain or handle.

## States

Hover underlines it; focus shows the ring. A refused link is plain; a flat one is its text alone. With a mark, the mark leads in every state.

## Keyboard

Tab reaches it; Enter follows it.

## Differences from the artifact

- `children` is the shown text only; the protocol allowlist is new.
- A link out (`mailto:`, `tel:`, `http`, `https`) is a plain `<a>`, not React Aria's `Link`: it needs no router, and a table draws hundreds of them, so it skips the hooks each would set up. Hover and focus come from `:any-link:hover` and `:focus-visible`. App paths still go through React Aria's `Link` and the router.
