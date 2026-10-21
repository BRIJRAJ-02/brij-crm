# QrCode

A QR code: what an authenticator app scans to set up two factor sign in (spec 0033).

## Why it exists

New. Two factor setup shows the app's secret as a QR code (AC-881). Nothing in the library draws one, and no existing atom is close: it is an image made from data, not a control. It wraps `uqr` (no dependencies, about 80 kB unpacked, MIT), the one place that library is imported, and draws the modules as one SVG path with token colours, so no raw values and no inline markup string.

## Use

```tsx
<QrCode value={totpUri} label="QR code for your authenticator app" />
```

- `value` is what it holds; `label` names it for screen readers (`role="img"`). Always show the same secret as text beside it for people who can't scan.
- It is 240px wide (`size-menu`), shrinking to its slot on a narrow screen, with the 4 module quiet zone scanners need.
- Dark modules on a light ground in both themes: `light-dark()` picks `text` on `surface` in light and `on-inverse` on `surface-inverse` in dark, because not every scanner reads an inverted code.

## States

One state: drawn. It has no hover, focus or disabled state (it is not interactive).

## Keyboard

Not focusable.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
