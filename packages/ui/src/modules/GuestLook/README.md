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

The prototype's GuestLook is a different part: the owner's look picker (four looks or Custom, the accent, the face, light or dark, beside a small preview of the page), with `guestLookProps(value)` giving a page's root its theme and the accent as `--primary`, `--accent` and the face. The library keeps that split: the picker is the Design screens' (owed to the screen phase that ports them, with MenuLookThumbnail and the look presets), and this part is the root a guest page wears, the library's half of `guestLookProps`. Its look, in token names: the surfaces (`surface`, `surface-raised`, `surface-subtle`, `surface-hover`, `surface-selected`), the lines (`border`, `border-subtle`), the words (`text`, `text-secondary`, `link`) and the radii (`radius-xs` to `radius-xl`, times the look's `--menu-round`) point at the look stylesheet's `--menu-*` values; `accent`, `accent-text`, `on-accent`, `focus-ring`, and (decision 16) `primary` and `on-primary` point at the look's accent, so a guest primary Button wears the page's brand, as the prototype's `guestLookProps` sets `--primary`; with no look linked, the ink (`surface-inverse`, `on-inverse`), never the app's blue. It draws no box and moves nothing.

**Use it for** the reservation page and the business page, around the booking parts, so they read as the guest menu does. **Don't use it for** the booking page (BookingFrame carries its own brand names) or any app screen.

**The consumer provides** `children`, and links the look stylesheet that sets `--menu-*` on the page's root.

**States**: no look linked (the token fallbacks, ink primary), a look linked (its ground, card, chip, line, words and accent), a dialog opened inside it (wearing the look through the portal provider).

**Differences from the prototype**
- No picker, swatches, preview, Font or Appearance controls here (see above); `value`, `onChange`, `GUEST_LOOKS`, `GuestLookPreview` and `isPreviewHidden` are the screen phase's.
- The accent's hover stays the accent unmixed (the prototype mixes 12% black): a brand's accent is checked at 4.5:1 only as it is. `accent-soft` is the look's chip, not a 14% tint of the accent, and `accent-border` a 16% one, so a day under the pointer is never ink on ink.
- It still remaps the legacy `shadow-focus`, `shadow-focus-inset` and `shadow-primary` for the parts it dresses that read them (BookingFrame, phase 2's guest parts, and BusinessPage until tier 3d): the remaps leave with their last reader. The ported parts inside take the outline ring, and `focus-ring` points at the look's accent too, so a guest page's rings (DayStrip's days, BusinessPage's tabs, BusinessGallery's photos, a Button or a field) wear the brand as they did before the port, not the app's blue. The look's accent is held at 3:1 and more on its ground (`menuLookRoles` in `@crm/contracts`, the control guard), so the ring keeps 3:1; with no look linked it is the ink (`surface-inverse`), 13.6:1 and more on the surfaces in both themes.

## PopupHost (spec 0074, batch 4)

`PopupHost.tsx` is the one way a guest page's popups wear its look: React Aria's `UNSAFE_PortalProvider` around the page's content and an empty host at the end of the page's themed root, so every overlay opened inside (Popover, Menu, Select, ComboBox, DatePicker, Tooltip, Modal in every variant) portals there instead of to `document.body`, and the root's custom properties and `data-*` selectors (theme, template, corners, colours) cascade into it with nothing copied (AC-7409). React Aria places a popover against its real containing block, so positions are unchanged. The host is kept in state, as GuestLook kept it since spec 0065: an overlay already open on the very first render (a dish's sheet opened from its link) draws on the document for that first frame, then moves into the host and mounts again, which costs that one overlay its focus return to the trigger. A ref would keep it on the document for good, out of the page's look; every overlay opened later draws in the host at once.

The host's class comes from the page's own stylesheet (`.popups`), so the hosted form and the booking page load no stylesheet of their own for it (a separate one cost each 120 B). Each page's `.popups` is `display: contents` (no box, so the layout never sees it), sets `--size-topbar` to the guest pages' bar height (spec 0071's legacy `size-bar`, 46px; until that token reaches this branch the same 46px is built from `size-row` and `space-2`, a fallback to drop at spec 0071's merge) so a guest sheet's or dialog's header is the height of the page's own bars (AC-7426), and shares the rule where the page maps its brand onto the library's names one level in (`.card` on the form, `.layout` on the booking page, `.column` on the link page), so a popup's accent and focus ring are the brand's too.

What reaches the popups, and so changes there on purpose: the page's theme, template, surfaces, words' colours, corners and brand accent; on the booking page and the link page their public pace (`--duration-*`) and press (`--scale-press`), so their dialogs open at the page's pace; and through `--size-topbar` a guest Modal's top offset and height, QrSheet's header and the sheet touch target (48px, as its comment says). Not yet: the link page's own face and shape (`--page-body-face`, `--page-radius`), which the page uses through its own names rather than the library's.

A container (`container-type`) holds `position: fixed` boxes, so no ancestor of the host may be one: the link page's grid container sits on a frame inside its PopupHost, not on its root.

Used by GuestLook (the menu, business and reservation pages), MenuList, the hosted form's `FormGround`, `LinkPage` and `BookingFrame` (the booking page and its manage page). A popup in the app, with no PopupHost around it, is unchanged (AC-7410). Not exported: only library parts take it. Why not the prototype's `LookContext` (copying the look's theme and style onto each popup root): it misses Tooltip and the drawers, and can't carry `data-template` or `data-page-*` selectors (spec 0074, rationale 8).

Owed: AC-7426's story measuring a sheet's header against the page's bar on the menu, link and booking pages waits for spec 0071's `size-bar` on this branch; until then the menu's own bar still reads the app's `size-topbar` (56px) while its sheets read 46px.
