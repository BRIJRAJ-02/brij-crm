# LinkPage

A person's link page at `/<handle>` (spec 0051, built as blocks): their face, name and bio, their social icons, then their blocks in the order they set (booking pages, links, and the small headings that group them), and the foot. The editor's phone preview draws the same component with `isPreview`.

## Why it exists

New (25 October 2026). The profile used to be BookingProfile with a LinkList of booking pages under it. A link page is a different object: every row is the one thing to press, told apart at a glance by a network's mark, an icon or a letter, and read on a phone first. LinkList is a list of things to manage (title, address, chips, switches and row menus, at row height), and BookingProfile is a card holding it; bending either into thumb sized cards with leading tiles would have changed every Captures list and the booking pages' card. So the page is its own module, built from the library's atoms (Avatar, Icon, ProviderMark, Skeleton, VisuallyHidden) and BookingFrame's foot, and LinkList gained one small variant instead (`leading`) for the editor's rows, which show the same tiles through `LinkPageTile`.

## Anatomy

- **Hero**, centred: Avatar `xl`, the name as the page's `h1` (`text-note-title`: the identity leads), the bio (`text-secondary`), then `socials` (the person's own set of network icons, never a block).
- **Toolbar** (`toolbar`): a search once there are many blocks.
- **Blocks**, `space-12` apart, in groups: the blocks before the first heading, then each heading (an `h2`, `text-body-strong` in the secondary colour) with the blocks under it. Each block is a raised card (`surface-raised`, hairline, `radius-xl`, `shadow-xs`, `space-12` padding) that is one real link: a leading tile (`LinkPageTile`, `size-row` plus `space-6` square), its title (`text-title`) and a line under it, and an arrow at the end.
  - `link`: the owner's address as stored, never wrapped or redirected, through the library's one href rule (`safeHref`, plus `sms:` with a number); an address the rule refuses draws as words, never as a link. A web address opens in a new tab with `rel="noopener noreferrer nofollow"` (and `me` on a network profile, the person's own), its name ending "(opens in a new tab)", an arrow at its end. An email, a call or a text opens the device's app in place, with a mail, phone or message icon at its end. Its tile is the network's mark (ProviderMark), else the picked icon, else the email's, call's or text's own icon, else the title's first letter on its hue's tag colours.
  - `page`: one of the person's booking pages (an address on our own origin only), opened in this tab; its tile is the calendar on `accent-soft` in the `link` colour, its line the lengths ("15 min · 30 min · Team"), and it ends in "Book" in the `link` colour (the accent itself falls under AA on a raised card in dark).
  - `contact`: the owner's contact card (spec 0051, AC-5115): its tile is an id card on `accent-soft`, its title the card's full name and its line the job title and company, and it ends in "Save contact" in the `link` colour. It is one plain link to the card's vCard on our own origin (`/api/public/handles/<handle>/contact.vcf`, answered as an attachment), opened in place, so it works with no script and straight from a QR code, and a phone offers to add the card to its contacts.
  - A block with no line under it keeps its title by its tile, left aligned like every other, and centred in the row's height (crm-87, 25 October 2026).
- **After** (`after`): a refusal's Callout, Show more.
- **Foot** (`foot`): the public page passes BookingFoot, tagged `booking_profile`. A slot rather than drawn here: the app's editor draws this page too, and a module both bundles import is split into a chunk of its own, taking BookingFrame's CSS out of the booking page's first load (0.6 kB more, gzipped, measured 25 October 2026). The editor's preview has no foot.

Why the letter tile isn't an Avatar: an Avatar is a person (initials from a name, a circle or a workspace square at the avatar sizes), while this tile is one of the faces of one slot (a brand mark on a hairline, a Lucide icon on the sunken surface, a calendar or an id card on the accent's soft surface, a letter on a hue), all at the tile's own size. Bending Avatar to draw marks and icons, or adding a tile size to it for this slot alone, would have spread the tile across two components; the hue pairs are the same `tag-<hue>` tokens Avatar and Tag read.

`LinkPageTile` with no block is the tile's loading form (a Skeleton filling its place), which the page's loading blocks and the editor's loading rows (LinkList's `leadingLoading`) both draw, so the tile's size lives in this module alone.


## Writing

A `text` block is the person's own words rather than a row (spec 0052, AC-5206): its title as a small heading when it has one, the body under it with its line breaks kept, in the page's reading measure, with no frame and nothing to press. It breaks out of the list of pressable rows, so a run of rows is one `ul` and a piece of writing is prose between the lists: a list item that is not a link would read as one to a screen reader.

The body is drawn as text and never as markup, and the schema refuses every control character but a line break, so nothing in it can become an element. There is no bold, no italic and no inline link: a person who wants a link adds a link block. It records no press and shows no chip, because it has nowhere to go.

## Use

```tsx
<LinkPage
  person={{ name: 'Anish Gupta', id: 'anish', bio: 'Cofounder at Timefix.' }}
  blocks={[
    { kind: 'page', id, title: 'Intro call', href: '/anish/intro-call', facts: '30 min' },
    { kind: 'heading', id, title: 'Find me' },
    { kind: 'link', id, title: 'LinkedIn', href: 'https://www.linkedin.com/in/anish', mark: 'linkedin', hue: 'blue' },
  ]}
  foot={<BookingFoot page="booking_profile" claimHref={claimPageHref('booking_profile')} />}
  onPress={(id) => beacon(id)}
/>
```

- **A new kind of block** is one more member of `LinkPageBlock` and one more renderer in `RENDERERS` (and a tile in `LinkPageTile`); callers map their data onto the union and skip a kind they can't map, so an older page never breaks on a newer block.
- **`layout="blocks"`** draws only the blocks, inert, under an optional `caption` ("How it looks"), as a labelled group: an editor's draft of one block.
- **`isPreview`** draws a plain region (no `main`), its content's height, `inert`: the editor's phone shows the page, and a press there never leaves the editor.
- **`onPress`** hears a block pressed, for a counter's beacon; it never holds up the navigation.

## States

Loading (no `person`: the hero's skeleton; no `blocks`: five block shaped places, the tile's and a title line's, so nothing moves when they arrive), a refused address (words, no link), empty (`empty` in the list's place), ready, a contact card, long words (titles, notes, names and bios wrap inside their card), with Show more, a search's count (`summary`, a status region mounted while a search is in play), the blocks alone, and the preview. Hover lifts a card to `surface-hover` and `border-strong` on fine pointers only; focus draws `shadow-focus`; there is no press shrink (house rule). The blocks arrive with a short fade and a `space-2` rise over `duration-popover`; reduced motion keeps the fade.

## Keyboard

Tab reaches each block in reading order, then the foot's links. Enter opens a block.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
