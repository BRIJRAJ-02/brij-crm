# QrCode

A QR code: what an authenticator app scans to set up two factor sign in (spec 0033).

## Why it exists

New. Two factor setup shows the app's secret as a QR code (AC-881). Nothing in the library draws one, and no existing atom is close: it is an image made from data, not a control. It wraps `uqr` (no dependencies, about 80 kB unpacked, MIT), the one place that library is imported, and draws the modules as one SVG path with token colours, so no raw values and no inline markup string.

## Use

```tsx
<QrCode value={totpUri} label="QR code for your authenticator app" />
<QrCode value={totpUri} label="QR code for your authenticator app">
  <p>1. Open an authenticator app.</p>
  <p>2. Scan the code, or type the key.</p>
  <p>3. Enter the 6 digit code it shows.</p>
  <CodeInput label="Code from your authenticator app" isLabelHidden size="lg" />
</QrCode>
```

- `value` is what it holds; `label` names it for screen readers (`role="img"`). Always show the same secret as text beside it for people who can't scan.
- It is 240px wide (`size-menu`), shrinking to its slot on a narrow screen, with the 4 module quiet zone scanners need.
- `children` is a column beside the code: what to do with it, and the setup key to type instead. Only real content makes the column: nothing, `false` or an empty list keeps the plain code. The code is then `size-column` wide (200px), and the two sit side by side where the slot holds the code, `space-16` and a column of at least `size-column` (a 480px dialog); in a narrower slot (a dialog on a phone) the column wraps under the code at the slot's full width. It wraps rather than asking a container query, since the library's breakpoints (320px, 480px) don't fall between a phone's dialog and a desktop's. The column's items stack `space-12` apart.
- Why a variant, not a new component: two factor setup's dialog showed the code at the left with empty space beside it, one line of instructions, and the six code boxes small at the left under it all (the owner's A122, 23 October 2026). With the steps and the setup key beside the code, and the boxes at the dialog's full width under it all, the dialog reads in one glance. The code is the same image with the same quiet zone and colours; only what sits beside it changes, so the column is an option of QrCode. A Card or a SettingsRow would add a box or a label column the dialog doesn't want.
- `size="sm"` draws it `size-column-narrow` wide (120px, alone or with its column): a code in a card among others, Home's "Your link page", which still scans from a phone held near the screen.
- `size="fill"` draws the code at its slot's whole width rather than `size-menu`: the link page's QR Modal (spec 0051, AC-5122) shows it large, to be scanned from across a table or saved to print. A size, not a new component: the image, its quiet zone and its colours are the same. With `children`, the code stays `size-column`.
- Dark modules on a light ground in both themes: the code carries `data-theme="light"`, so it draws `text` on the light theme's tokens whatever the page's theme, because not every scanner reads an inverted code. In a light app the ground is `surface` (white). In a dark app a white tile glared (the owner, 31 October 2026), so there the ground is the light theme's `border-strong`, a soft light grey; the modules still sit at about 10:1 on it, well past the 4.5 the atom holds a module colour to. `surface-sunken` was the first step down (31 October) and was still near white at the sizes the app draws (the owner again, 1 November 2026, the form's live dialog). It is a border token because the light palette has no surface this far down, and the code's ground is not a page surface. That one rule reads the page's theme with a root selector rather than a token, because the code's own `data-theme="light"` resets every token inside it. A code saved as a PNG (a link page's Download QR code) is always drawn on the light `surface`, so it prints white, not grey (AC-5122).
- `ground="clear"` draws no ground on screen, for a caller that sets the code on a light tile of its own with room around it (ReadyPanel's `share`, 5 November 2026), so the tile and the code read as one card rather than a grey square inside a lighter one. An option rather than the caller styling the code's insides; a saved copy still prints on the light `surface`.

- `ground="paper"` keeps the light `surface` ground in a dark app too: Menu QR's print sheet (spec 0065, H2) draws codes to be printed, and paper is white. A variant, not a new component: only the ground's colour changes, and only in a dark app.

## Style (spec 0061, AC-6124)

A link page's share code may carry its owner's style, saved per page and passed in here:

- `colour`: a `#rrggbb` for the modules, drawn only when it keeps 4.5 to 1 against the white ground (`qrModuleColour`, the same rule the server refuses a saved style by); a lighter one draws the plain dark code. It reaches the modules, the frame and its label through `--qr-modules`, set on the code itself.
- `picture`: a picture in the middle, from our origin only (`safeImageSrc`). It takes at most a fifth of the code's side (`qrPictureBox`: odd, centred on a module), the modules under it and one module round it are left out, and the code switches to the highest error correction (H) to carry it. Clipped to a small round corner.
- `frameLabel`: a rounded frame outside the whole quiet zone, in the module colour, with the label (up to 20 characters) in a band under the code.

All of it is inside the one SVG, so a saved copy carries it (the caller writes the computed colours into a standalone copy, as `qr-png.ts` does; its `text` element needs its fill written in too, and a centre picture must be a `data:` or same origin address for the copy to draw it). The ground always stays white: not every scanner reads an inverted code. `QrCode.browser.test.tsx` draws each style in Chromium, saves it the way the editor does and decodes it with `jsqr` (a dev dependency for that test alone).

Why options, not a new component: the code, its quiet zone and its ground are the same; only the modules' colour and what sits in the middle and around it change.

## States

One state: drawn, alone (at `size-menu` or filling its slot) or with its column (side by side, or under it when narrow). It has no hover, focus or disabled state (it is not interactive); the column's controls have their own.

## Keyboard

Not focusable.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.

## Timefix prototype (spec 0072)

Takes its look from the prototype's QrCode, which it already matched: dark modules on a light ground in either theme, the ground stepping down to `border-strong` in a dark app, paper and clear grounds. Sizes now follow the prototype: `md` is `size-menu`, `sm` half of it, a code beside a column five sixths of it.

**Differences from the prototype**: none in look. `downloadQr` and the print sheet live elsewhere in the library.
