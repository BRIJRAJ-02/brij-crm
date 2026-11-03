# MenuList

A place's published menu as a guest reads it on a phone (spec 0065, H1, AC-6528 to AC-6533). The layout and flow
follow the checklabs guest app (owner, 4 November 2026), rebuilt from library parts and tokens: a glass bar stuck to
the top with the brand mark and the section pills, the header, the menus, search and dietary filters, each section's
dishes as rows or a photo grid, a dish's sheet, and Your picks.

## Why it exists

Nothing in the library draws a public menu: LinkPage is one column of links, BookingFrame a booking. Spec 0065's
"Build on what exists" allows two new modules for the guest menu, this and ItemSheet; everything else is the library's
own (SectionTabs for the pills, SegmentedControl switches the menus, ChoiceChips filter by diet, Modal `sheet-card` and
`sheet-side` hold the dish and the picks, Button, Icon, NumberPop, Reveal, and the public pages' BookingProvider and
BookingFoot). It is used by the public `/m/:key` page and by the Menus editor's phone preview, which renders the draft
through the same component.

## Use

```tsx
<MenuList
  menu={publicMenu}
  logoHref={logo}
  coverHref={cover}
  photoHref={(id, size, version) => menuPhotoPath(key, id, size, version)}
  picks={picks}
  onPicksChange={keepPicks}
  foot={<BookingFoot … />}
  hasEntrance
/>
```

- `menu` is `GET /api/public/menu/:key`'s answer: the snapshot, the items sold out now and the header.
- The bar: the logo (`logoHref`, never cropped), or without one a squircle in the menu's ink with the business's first
  letter, so the bar is never an empty band; the business's name fades in once the heading has scrolled away; the
  table a QR code named (`table`); and SectionTabs, whose fill slides to the section under the bar as the page scrolls.
- The header: `coverHref` (a 3:1 photo) when there is one, the place's name as an eyebrow, the business as the h1 and
  its line, open now, the address and phone, then the menus (serving now first; the rest say "Serving from 18:00"),
  search and the dietary chips.
- A dish row: its name (Popular, Sold out), two lines of its words, its price and its marks, then an 88px photo at the
  end with a + on its corner (or the + at the row's end without a photo). A grid card: the photo first at 4:3, the +
  on its corner. Two columns on a phone, three in a column 480px or wider. A sold out dish keeps its place, dimmed,
  with no +.
- The +: a dish with nothing to choose (one price, no option groups) adds one at once, and its + becomes a small
  stepper (− takes one away); any other dish opens its sheet.
- A dish opens ItemSheet in a `Modal` `sheet-card` (a bottom sheet on a phone, a card centred over a wider screen),
  and the picks bar opens PicksSheet in a `sheet-side` (a bottom sheet on a phone, a panel at the end edge wider).
  Both are real dialogs: focus held, Escape closes, focus returns.
- The picks bar ("4 · View your picks · £65.36") rises from the foot with the first pick; its count and total pop as
  they change (NumberPop). The total adds each menu's service and holds its tax (`picksBill`).
- Colours: the root reads the `--menu-*` custom properties the menu's look stylesheet sets (ground, card, chip, line,
  glass, text, quiet, accent, on accent), each falling back to a token, and one level in points the library's own
  names (surface-raised, text, accent, focus) at them. The dish's sheet and Your picks open inside the module's own
  root (React Aria's portal provider), so they wear the warm card in both themes. The module never writes a colour.
- Motion (spec 0068, AC-6803, AC-6806): `hasEntrance` (the live page only, never the editor's preview) lets the
  heading, its line and the first dishes rise in once, a stagger apart (Reveal); rows and the picks bar ease down when
  pressed (`--scale-press` set to `scale-enter` here); a changed Button label resolves in (`--label-swap`). Reduced
  motion keeps fades and drops movement.
- Without `onPicksChange` the menu has no picks and no + (the editor's preview). Picks are the caller's to keep.

## States

Serving, not serving yet (a notice and per section "Serving from"), filtering with no match (Show everything), an empty
menu, a sold out dish, no photos, no logo (the initial), a cover, picks (the bar), the sheet open, the picks open.
Stories: Default, SheetOpen, PicksOpen, DemoPickASize (the stageshow demo: open a wine, pick the bottle, the price
pops, add it), Filtered.

## Keyboard

Tab moves through the pills, the menus, search, the chips, then each dish and its +; Enter opens a dish's sheet.
Escape closes a sheet.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.

- `at` reads the menu at another instant than now (the editor's Preview at, after checklabs' `?at=` preview): which menus and sections serve, and the open line, follow it.
