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
- `size="sm"` draws it `size-column-narrow` wide (120px, alone or with its column): a code in a card among others, Home's "Your link page", which still scans from a phone held near the screen and opens large in a Modal.
- `size="fill"` draws the code at its slot's whole width rather than `size-menu`: the link page's QR Modal (spec 0051, AC-5122) shows it large, to be scanned from across a table or saved to print. A size, not a new component: the image, its quiet zone and its colours are the same. With `children`, the code stays `size-column`.
- Dark modules on a white ground in both themes: the code carries `data-theme="light"`, so it draws `text` on `surface` from the light theme's tokens whatever the page's theme, because not every scanner reads an inverted code, and a code saved as a PNG from dark mode (a link page's Download QR code) prints white, not grey (AC-5122, 25 October 2026; dark mode's `surface-inverse` ground was a light grey).

## States

One state: drawn, alone (at `size-menu` or filling its slot) or with its column (side by side, or under it when narrow). It has no hover, focus or disabled state (it is not interactive); the column's controls have their own.

## Keyboard

Not focusable.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
