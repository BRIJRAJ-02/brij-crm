# MenuList

A place's published menu as a guest reads it on a phone (spec 0065, H1, AC-6528 to AC-6533): the business on top
with open now, a glass bar that sticks with the menu switcher, search, dietary filter chips and section chips that
follow the scroll, items as rows or a photo grid per section, a bottom sheet per item, and Your picks.

## Why it exists

Nothing in the library draws a public menu: LinkPage is one column of links, BookingFrame a booking. Spec 0065's
"Build on what exists" allows two new modules for the guest menu, this and ItemSheet; everything else is the library's
own (Tabs switch the menus, ChoiceChips filter by diet, Modal is the sheet, Button, Icon, and the public pages'
BookingProvider and BookingFoot). It is used by the public `/m/:key` page and by the Menus editor's phone preview, which
renders the draft through the same component.

## Use

```tsx
<MenuList
  menu={publicMenu}
  logoHref={logo}
  photoHref={(id, size, version) => menuPhotoPath(key, id, size, version)}
  picks={picks}
  onPicksChange={keepPicks}
  foot={<BookingFoot … />}
/>
```

- `menu` is `GET /api/public/menu/:key`'s answer: the snapshot, the items sold out now and the header.
- Menus serving now (by the place's zone and the provider's clock) come first; the others stay a tap away with
  "Serving from 18:00".
- Colours read `--menu-*` custom properties (ground, text, quiet, card, chip, line, glass, ink, accent), each falling
  back to a token. The menu's look stylesheet sets them from the Warm preset and the brand kit; the module never writes
  a colour of its own.
- The layout follows the owner's references (4 Nov 2026): a dark bar stuck to the top with the venue and the section
  tabs (the active one in the accent, with a short line under it that grows in), then the venue's facts, the menus as
  Tabs, search and the dietary ChoiceChips, then each section under a large title, its dishes as rows with a square
  photo tile on the left and no dividers. A sold out dish keeps its place, its photo dimmed, with a Sold out chip.
- A dish opens ItemSheet in a `Modal` `sheet`: a real dialog that holds focus, closes on Escape and returns focus to the
  dish. Allergens are always words, never an icon or a colour alone.
- Without `onPicksChange` the menu has no picks (the editor's preview). Picks are the caller's to keep; this module
  only draws them and says that nothing is sent.
- Every press scales to `scale-press`; reduced motion keeps colour changes and drops movement.
