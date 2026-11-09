QrCode draws a scannable code for a link page, booking page, table menu or authenticator secret, and saves it as PNG or SVG.

**Use it for**: sharing a public page (link page, booking page, form), table and menu cards (QrSheet draws one per table with `frameLabel` and `ground="paper"`), and two-factor setup (with `children` as the steps beside it). **Don't** invert it, put it on a coloured tile, or use a module colour lighter than 4.5 to 1 on white (the code falls back to ink).

**The consumer provides**: `value`, `label` for screen readers, `size` (`sm` 120, `md` 240, `fill`), `withLogo` (the Timefix mark in the centre; error correction goes to H), `colour` (`#rrggbb`), `frameLabel`, `ground` (`drawn`, `paper`, `clear`), `ref` for `downloadQr(svg, name, 'png' | 'svg')`, and optional `children` beside it. Always show the link or key as text too.

**States**: one drawn state. Rounded modules and finder eyes, a 4-module quiet zone. In a dark app the ground steps down to a soft grey so it doesn't glare; saved files are always on white.

**Interaction**: not focusable. The code redraws as the value changes; the encoder is a local port (byte mode, versions 1 to 40, best mask), checked with Apple's QR detector, logo included.

**Replaces**: QrCode and QrSheet's code (frame, label, paper ground).
