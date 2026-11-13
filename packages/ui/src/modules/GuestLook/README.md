# GuestLook

The guest pages' one look (5 November 2026): what the guest menu wears, around a page built from the booking parts, so the menu, the reservation page and the business page read as one product.

## Why it exists

New. The first go gave BookingFrame, BookingMessage, BookingReceipt and BusinessPage each a `look` prop and the same block of CSS, which put a restaurant's look into the approved booking page's stylesheet and took that page past its CSS budget. Every part already reads the library's own names (`surface-raised`, `text`, `accent`), and BookingFrame works its accents out from them, so one wrapper that points those names elsewhere dresses them all, with nothing in the parts it dresses. A page without it carries none of its styles.

## Use

```tsx
<GuestLook>
  <BookingFrame … />
</GuestLook>
```

The page links the look stylesheet itself (`/api/public/tables/<key>/look.css`, `/api/public/business/<handle>/look/menu.css`), which sets the `--menu-*` custom properties on the root, with the brand's accent in `--menu-accent`. With none linked, each colour falls back to a token and the accent to the ink (`surface-inverse`, near black in light and near white in dark), never the app's blue. BusinessPage wears it itself.

## States

No state of its own: it holds no data and draws no box (`display: contents`). Dialogs open inside it (React Aria's portal provider), so they wear the look too.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

The prototype's GuestLook is a different part: the owner's look picker (four looks or Custom, the accent, the face, light or dark, beside a small preview of the page), with `guestLookProps(value)` giving a page's root its theme and the accent as `--primary`, `--accent` and the face. The library keeps that split: the picker is the Design screens' (owed to the screen phase that ports them, with MenuLookThumbnail and the look presets), and this part is the root a guest page wears, the library's half of `guestLookProps`. Its look, in token names: the surfaces (`surface`, `surface-raised`, `surface-subtle`, `surface-hover`, `surface-selected`), the lines (`border`, `border-subtle`), the words (`text`, `text-secondary`, `link`) and the radii (`radius-xs` to `radius-xl`, times the look's `--menu-round`) point at the look stylesheet's `--menu-*` values; `accent`, `accent-text`, `on-accent`, and (decision 16) `primary` and `on-primary` point at the look's accent, so a guest primary Button wears the page's brand, as the prototype's `guestLookProps` sets `--primary`; with no look linked, the ink (`surface-inverse`, `on-inverse`), never the app's blue. It draws no box and moves nothing.

**Use it for** the reservation page and the business page, around the booking parts, so they read as the guest menu does. **Don't use it for** the booking page (BookingFrame carries its own brand names) or any app screen.

**The consumer provides** `children`, and links the look stylesheet that sets `--menu-*` on the page's root.

**States**: no look linked (the token fallbacks, ink primary), a look linked (its ground, card, chip, line, words and accent), a dialog opened inside it (wearing the look through the portal provider).

**Differences from the prototype**
- No picker, swatches, preview, Font or Appearance controls here (see above); `value`, `onChange`, `GUEST_LOOKS`, `GuestLookPreview` and `isPreviewHidden` are the screen phase's.
- The accent's hover stays the accent unmixed (the prototype mixes 12% black): a brand's accent is checked at 4.5:1 only as it is. `accent-soft` is the look's chip, not a 14% tint of the accent, and `accent-border` a 16% one, so a day under the pointer is never ink on ink.
- It still remaps the legacy `shadow-focus`, `shadow-focus-inset` and `shadow-primary` for the parts it dresses that read them (BookingFrame, phase 2's guest parts, and BusinessPage until tier 3d): the remaps leave with their last reader. The ported parts inside take the outline ring (`focus-ring`), which it leaves alone.
