# MenuList

A place's published menu as a guest reads it on a phone (spec 0065, H1, AC-6528 to AC-6533). The layout, flow and
words follow the checklabs guest app faithfully (owner, 4 and 5 November 2026), rebuilt from library parts and tokens:
one centred column at every width, a glass bar with the brand mark alone, the brand block, the menus when the link
holds several, the sections as pills one at a time, each section's dishes as rows or a photo grid, the allergens foot,
a dish's sheet, and Your selection.

## Why it exists

Nothing in the library draws a public menu: LinkPage is one column of links, BookingFrame a booking. Spec 0065's
"Build on what exists" allows two new modules for the guest menu, this and ItemSheet; everything else is the library's
own (Tabs `variant="pills"` for the sections, SegmentedControl switches the menus, Modal `sheet-card` and `sheet-side`
hold the dish and the selection, Button, Icon, NumberPop, Reveal, and the public pages' BookingProvider and
BookingFoot). It is used by the public `/m/:key` page and by the Menus editor's phone preview, which renders the draft
through the same component.

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
- One column (`size-dialog` wide) centred at every width, as checklabs' 448px column.
- The bar: the logo (`logoHref`, never cropped), or without one a tile in the brand's colour (the menu's ink when the
  brand has none) with the business's first letter. Nothing else (checklabs').
- The brand block: the place's name as an uppercase eyebrow with the table a QR code named (`table`, "Table 4", from
  `tableDisplayName`) after a "·" as an accent Badge; the current menu's name as the h1; the business's line.
- The menus (serving now first; the rest say "Serving from 18:00") in a SegmentedControl, only when the link holds two
  or more.
- The sections as outlined pills (Tabs `pills`), one section at a time, the first chosen; a section with no dish to
  show gets no pill. The pill shows the section's name, so its h2 stays for screen readers only; its sub sections
  follow under their h3s, a hairline between blocks. A link to `#h-<section or sub section id>` opens its pill and
  brings it into view clear of the bar with focus on it (the chosen pill for a section, the heading for a sub
  section; owner, 5 November 2026), on load and on every hash change, never when the menu redraws under the guest.
- A dish row: its name (Popular, Sold out with a red dot), two lines of its words, the price on its own line, its marks
  as chip Badges (the look's cream chip),
  then an 88px photo at the end with a round + in the ink on its corner (or the + at the row's end without a photo). A
  grid card: a square photo first, the + on its corner; two columns at every width. A sold out dish keeps its place,
  its photo dimmed and its name and price quiet, with no +.
- The +: a dish with nothing to choose (one price, no option groups) adds one at once, and its + becomes a white
  hairline stepper (− n +); any other dish opens its sheet. Focus follows the swap both ways (the stepper's + after
  the first add, the + again after the last remove), so a keyboard never drops to the top of the page.
  A dish with choices, once in the selection, shows its count before its + (n +; the + opens the sheet again, and
  taking one away is Your selection's). The + and the stepper's buttons are Button's `touch` size (44px), since a
  guest presses them with a thumb (review, 5 November 2026). Each add and remove is said politely to a screen reader
  ("Added Flat white. 2 in your selection.") through a status line, since the count changes without a word.
- The foot: ALLERGENS, the allergens this menu's dishes name in the EU list's order, and "Tell your server about any
  allergy before you order.", then the page's foot.
- A dish opens ItemSheet in a `Modal` `sheet-card` (a bottom sheet on a phone, a card centred over a wider screen),
  and the selection bar opens PicksSheet in a `sheet-side`. Both are real dialogs: focus held, Escape closes, focus
  returns.
- The selection bar ("View selection … £65.36") rises from the foot with the first pick, a pill in the ink; its total
  pops as it changes (NumberPop). The total adds each menu's service and holds its tax (`picksBill`).
- Colours: the root reads the `--menu-*` custom properties the menu's look stylesheet sets (ground, card, chip, line,
  glass, text, quiet, accent, on accent), each falling back to a token, and one level in points the library's own
  names (surface-raised, text, accent, focus) at them. The Warm preset is checklabs' monochrome (a near white ground,
  cream chips, the accent in the ink); a brand colour takes the accent. The dish's sheet and the selection open inside
  the module's own root (React Aria's portal provider), so they wear the look in both themes. The module never writes
  a colour.
- Focus rings are the full ink (a 40% mix of the ink fell under 3:1 on the near white ground).
- Motion (spec 0068, AC-6803, AC-6806): `hasEntrance` (the live page only, never the editor's preview) lets the
  heading, its line and the first dishes rise in once, a stagger apart (Reveal); rows and the selection bar ease down
  when pressed (the public pages' press, as BookingFrame's, spec 0068 AC-6806); the pill fill slides between sections. Reduced motion keeps fades and drops movement.
- Without `onPicksChange` the menu has no selection and no + (the editor's preview). Picks are the caller's to keep.

## Deviations from checklabs, and why

- The menus switcher: our link publishes several menus; checklabs lists them on a venue page we don't have.
- "Not serving now / Serving from 18:00": our menus and sections have serving times.
- Sold out and Popular chips: both are set by the owner in our editor.
- Every dietary mark as a pill (checklabs derives only vegan and vegetarian): our model stores the marks.
- No Order now in the selection: we send no orders; it says "Show this to your server."
- A dark theme (checklabs has none), from the same look properties.
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
