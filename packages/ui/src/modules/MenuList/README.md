# MenuList

A place's published menu as a guest reads it on a phone (spec 0065, H1, AC-6528 to AC-6533). The layout, flow, words
and look follow the checklabs guest app ("Nova", which its guest app hard codes) value for value (owner, 4 and 5
November 2026: "the same exact menu theme"), rebuilt from library parts and tokens: one 448px column at every width, a
glass bar with the brand mark (and the menus when the link holds several), the brand block, the sections as pills one
at a time, each section's dishes as rows or a photo grid, the allergens foot, a dish's sheet, and Your selection.

## Why it exists

Nothing in the library draws a public menu: LinkPage is one column of links, BookingFrame a booking. Spec 0065's
"Build on what exists" allows two new modules for the guest menu, this and ItemSheet; everything else is the library's
own (Tabs `variant="pills"` for the sections, a MenuTrigger and Menu switch the menus, Modal `sheet-card` and
`sheet-side` hold the dish and the selection, Stepper, Button, Icon, NumberPop, Reveal, and the public pages'
BookingProvider and BookingFoot). It is used by the public `/m/:key` page and by the Menus editor's phone preview, which renders the draft
through the same component.

## The look (AC-6570 as amended)

The Design page saves one look for a business; the page's stylesheet writes it as `--menu-*` custom properties, read at the root. Colours (`--menu-highlight` is the price), the two faces (`--menu-face`, `--menu-display-face`), and `--menu-round`, a number the library's radii are multiplied by, so a look's corners reach the parts one level in. `coverHref` draws the look's 3:1 cover in the column under the bar. `scheme` puts `data-theme` on the root for a look pinned to one side, so the library's own tokens follow it. `lookVariables` sets the same custom properties through the CSSOM for an editor's live preview; `look-variables.ts` lets through only the look's own names with a whole hex, a font token, the device's face or a number.

**MenuLookThumbnail** is a look as a small picture of itself, for a preset's tile on the Design page: the ground, a heading in its face, a price in its highlight and a button in its accent, from the same custom properties. New because LinkPageThumbnail draws a link page's parts (a host's name and rows) from a page theme's ten names, which a guest look has none of; a screen can't draw one itself. Decoration: `aria-hidden`, since the tile's own name says which look it is. Story: `LookThumbnails`.

## Use

```tsx
<MenuList
  menu={publicMenu}
  logoHref={logo}
  photoHref={(id, size, version) => menuPhotoPath(key, id, size, version)}
  table="Table 4"
  picks={picks}
  onPicksChange={keepPicks}
  foot={<BookingFoot … />}
  hasEntrance
/>
```

- `menu` is `GET /api/public/menu/:key`'s answer: the snapshot, the items sold out now and the header.
- One 448px column (`size-dialog` less `space-32`) with 20px gutters, centred at every width, as checklabs'.
- The bar (50px, glass): the logo (`logoHref`, 24px tall and up to 176px wide, never framed or cropped), or without one
  a 36px squircle in the brand's colour (the menu's ink when the brand has none) with the business's first letter; at
  its end, only when the link holds two or more menus with dishes, a compact "Dinner ▾" that opens the menus (serving
  now first; the rest say "Serving from 18:00"). A published menu with no dish to show is left out.
- The brand block: the place's name as a 12px uppercase eyebrow with the table a QR code named (`table`, "Table 4",
  from `tableDisplayName`) after a "·" as a pill of the ink (Badge `fit`, `isRound`, `accent`, in the eyebrow's 11px
  semibold capitals, 19px tall: checklabs' table chip); the current menu's name as the h1 (26px semibold); then
  checklabs' line under it: the business's own words, else the menu's note, else its address. The note moves to the
  foot only when the business's words took that line (it may carry the rates: "Prices include 5% tax.").
- The sections as outlined 38px pills (Tabs `pills`), one section at a time, the first chosen, even when there is only
  one (as checklabs'); the row runs to the window's edges with the first pill in line with the words. A section with no
  dish to show gets no pill. The pill shows the section's name, so its h2 stays for screen readers only; its sub sections
  follow under their h3s, a hairline between blocks. A link to `#h-<section or sub section id>` opens its pill and
  brings it into view clear of the bar with focus on it (the chosen pill for a section, the heading for a sub
  section; owner, 5 November 2026), on load and on every hash change, never when the menu redraws under the guest.
- A dish row: its name (16px semibold; Popular, Sold out with a red dot), two lines of its words (13px), the price on
  its own line (14px medium), its marks as 24px pills of the cream with the ink's words, 10px in (Badge `chip`,
  `isRound`, `strong`, as Popular and Sold out), then an 88px photo at 14px corners at the end with a 26px + in the ink
  in a 2px ring of the ground on its corner (or a 32px + at the row's end without a photo), its glyph 16px and bold; a
  hairline between rows; pressed (the dish or its +), the whole row takes the cream. A grid card: a square photo at 20px corners
  first, a 32px + of the card in its corner, then the name, the price and the words; two columns at every width. A sold out dish keeps its place,
  its photo dimmed and its name and price quiet, with no +.
- The +: a dish with nothing to choose (one price, no option groups) adds one at once, and its + becomes a 30px row
  Stepper (− n +, Stepper `row`: 24px buttons, a 13px semibold count) in the same corner, rimmed in the ground as the
  + is; any other dish opens its sheet. Focus follows the swap both ways (the stepper's
  - after the first add, the + again after the last remove), so a keyboard never drops to the top of the page.
    A dish with choices, once in the selection, shows its count before its + (Stepper `isFewerHidden`; the + opens the
    sheet again, and taking one away is Your selection's). The + and the stepper's buttons are drawn at checklabs' sizes
    and pressed across 44px (Button `isTouchTarget`), since a guest presses them with a thumb. Each add and remove is said politely to a screen reader
    ("Added Flat white. 2 in your selection.") through a status line, since the count changes without a word.
- The foot: over a hairline, ALLERGENS (12px semibold caps), the allergens this menu's dishes contain in the EU
  list's order (13px; a "may contain" stays on the dish's sheet, as checklabs lists only what its dishes carry), and
  "Tell your server about any allergy before you order.", then the page's foot.
- A dish opens ItemSheet in a `Modal` `sheet-card` (a bottom sheet on a phone, a card centred over a wider screen),
  and the selection bar opens PicksSheet in a `sheet-side`. Both are real dialogs: focus held, Escape closes, focus
  returns.
- The selection bar ("View selection … £65.36", 15px semibold) rises from the foot over 320ms with the first pick, a
  pill in the ink 16px from the sides and the foot; its total pops as it changes (NumberPop). The total adds each menu's service and holds its tax (`picksBill`).
- The look: the root reads the `--menu-*` custom properties the menu's look stylesheet sets (ground, card, chip, line,
  glass, text, quiet, accent, on accent, scrim, and the face), each falling back to a token, and one level in points
  the library's own names (surfaces, text, accent, focus, scrim, the text styles, `size-chip`) at them, so every
  library part inside speaks in the menu's face at checklabs' sizes. The Warm preset is checklabs' Nova: a white
  ground, `#f5f1ea` chips, `#1a1a1a` ink and words, `#6b6b6b` quiet words, a 6% black hairline, the device's own UI
  face; a brand colour takes the accent. Checklabs' sizes (26, 22, 16, 15, 14, 13 and 12px type with its line heights
  and tracking; 14px and 20px corners; the 88px photo) are built from tokens in the module. The dish's sheet and the selection open inside
  the module's own root (React Aria's portal provider), so they wear the look in both themes. The module never writes
  a colour.
- Focus rings are two rings, the ground then the full ink, so focus shows on the ink's own controls (the +, the
  chosen pill) as well as on the ground.
- Motion (spec 0068, AC-6803, AC-6806): `hasEntrance` (the live page only, never the editor's preview) lets the
  heading, its line and the first dishes rise in once, a stagger apart (Reveal); the pill fill slides between
  sections. Presses are checklabs': each part eases down while held, on its overshoot curve
  (`cubic-bezier(0.34, 1.56, 0.64, 1)`) over 160ms (a row and a grid card over 240ms): a row 0.985 with the cream
  fill, a grid card 0.97 (its photo 0.985 inside it), a section's pill 0.94, the + and a stepper's buttons 0.82, Close
  and the sheet's quantity buttons 0.88, an option's row 0.985, Add and the other buttons 0.97, the selection bar 0.98.
  The values come from the look stylesheet as `--menu-press-*` (CSS here takes curves and scales only from tokens),
  and the root hands them to the library's parts under their own names (`--scale-press`, `--scale-press-sm`,
  `--ease-press`); without the look nothing shrinks but the plain buttons, at every public page's 0.97. Reduced motion keeps
  fades and drops movement (the look sets every scale to 1 there, and every part checks it too).
- Without `onPicksChange` the menu has no selection and no + (the editor's preview). Picks are the caller's to keep.

## Deviations from checklabs, and why

- The menus switch at the bar's end: our link publishes several menus; checklabs lists them on a venue page we don't
  have.
- "Not serving now / Serving from 18:00": our menus and sections have serving times.
- Sold out and Popular chips: both are set by the owner in our editor.
- Every dietary mark as a pill (checklabs derives only vegan and vegetarian): our model stores the marks.
- No Order now in the selection: we send no orders; it says "Show this to your server."
- A dark theme (checklabs has none), from the same look properties; it never changes the light look.
- The allergens foot keeps "Tell your server about any allergy before you order." (a safety line checklabs lacks).
- The chosen pill's lift is the library's `shadow-md`, not checklabs' own (`0 4px 12px -6px` at 35%), and the
  selection bar's drop `shadow-lg`: no token holds checklabs' shadows.
- The stepper on a dish's photo is 32px with its rim, 2px over checklabs' 30px: its 24px buttons keep a 2px inset
  inside the rim where checklabs' overlap theirs.
- No 🌱 after Vegan and Vegetarian: an emoji is a glyph from outside Lucide, the library's only icons.
- Gone from ours (were in it before): search, dietary filter chips, the cover photo, the open now, address and phone
  line in the header (kept on a hidden menu, where Call is the way left), the bar's name fade in.

## States

Serving, not serving yet (a notice and per section "Serving from"), an empty menu, a sold out dish, no photos, no logo
(the initial), a selection (the bar), the sheet open, the selection open, hidden (Unavailable).
Stories: Default, SheetOpen, PicksOpen, DemoPickASize (the stageshow demo: open a wine, pick the bottle, the price
pops, add it), Sections, Unavailable.

## Keyboard

Tab reaches the menus, then the chosen pill (the arrow keys move between pills and show each section), then each
dish and its +; Enter opens a dish's sheet. Escape closes a sheet.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.

- `at` reads the menu at another instant than now (the editor's Preview at, after checklabs' `?at=` preview): which menus and sections serve, and the open line, follow it.

## Unavailable (Live or Hidden)

A menu its owner has hidden (`menu.hidden`) draws as the same page, in the menu's look with its bar, header (name, address, phone) and foot, and one card in place of the dishes: "This menu isn't available right now", with the ways still open: Reserve a table (only an `/r/<key>` path the answer carries, while the place takes reservations online) and Call (the place's phone). No menu switcher or pills. A variant, not a new component: the look, the header and the foot are MenuList's own, and a separate page would draw them twice.
