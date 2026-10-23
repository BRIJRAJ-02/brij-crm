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
- `children` is a column beside the code: what to do with it, and the field for what the app shows. The code is then `size-column` wide (200px), and the two sit side by side where the slot holds the code, `space-16` and a column of at least `size-column` (a 480px dialog); in a narrower slot (a dialog on a phone) the column wraps under the code at the slot's full width. It wraps rather than asking a container query, since the library's breakpoints (320px, 480px) don't fall between a phone's dialog and a desktop's. The column's items stack `space-12` apart.
- Why a variant, not a new component: two factor setup's dialog showed the code at the left with empty space beside it, one line of instructions, and the six code boxes small at the left under it all (the owner's A122, 23 October 2026). With the steps and the boxes beside the code, the dialog reads in one glance. The code is the same image with the same quiet zone and colours; only what sits beside it changes, so the column is an option of QrCode. A Card or a SettingsRow would add a box or a label column the dialog doesn't want.
- Dark modules on a light ground in both themes: `light-dark()` picks `text` on `surface` in light and `on-inverse` on `surface-inverse` in dark, because not every scanner reads an inverted code.

## States

One state: drawn, alone or with its column (side by side, or under it when narrow). It has no hover, focus or disabled state (it is not interactive); the column's controls have their own.

## Keyboard

Not focusable.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
