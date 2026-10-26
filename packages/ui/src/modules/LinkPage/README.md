# LinkPage

A person's link page at `/<handle>` (spec 0051, built as blocks): their face, name and bio, their social icons, then their blocks in the order they set (booking pages, links, and the small headings that group them), and the foot. The editor's phone preview draws the same component with `isPreview`.

## Why it exists

New (25 October 2026). The profile used to be BookingProfile with a LinkList of booking pages under it. A link page is a different object: every row is the one thing to press, told apart at a glance by a network's mark, an icon or a letter, and read on a phone first. LinkList is a list of things to manage (title, address, chips, switches and row menus, at row height), and BookingProfile is a card holding it; bending either into thumb sized cards with leading tiles would have changed every Captures list and the booking pages' card. So the page is its own module, built from the library's atoms (Avatar, Icon, ProviderMark, Skeleton, VisuallyHidden) and BookingFrame's foot, and LinkList gained one small variant instead (`leading`) for the editor's rows, which show the same tiles through `LinkPageTile`.

## Anatomy

- **Hero**, centred: Avatar `xl`, the name as the page's `h1` (`text-note-title`: the identity leads), the bio (`text-secondary`), then `socials` (the person's own set of network icons, never a block).
- **Toolbar** (`toolbar`): a search once there are many blocks.
- **Blocks**, `space-12` apart, in groups: the blocks before the first heading, then each heading (an `h2`, `text-body-strong` in the secondary colour) with the blocks under it. Each block is a raised card (`surface-raised`, hairline, `radius-xl`, `shadow-xs`, `space-12` padding) that is one real link: a leading tile (`LinkPageTile`, `size-row` plus `space-6` square), its title (`text-title`) and a line under it, and an arrow at the end.
  - `link`: the owner's address as stored, never wrapped or redirected, through the library's one href rule (`safeHref`, plus `sms:` with a number); an address the rule refuses draws as words, never as a link. A web address opens in a new tab with `rel="noopener noreferrer nofollow"` (and `me` on a network profile, the person's own), its name ending "(opens in a new tab)", an arrow at its end. An email, a call or a text opens the device's app in place, with a mail, phone or message icon at its end. Its tile is the network's mark (ProviderMark), else the picked icon, else the email's, call's or text's own icon, else the site's own icon (`siteIcon`), else the title's first letter on its hue's tag colours.
  - `page`: one of the person's booking pages (an address on our own origin only), opened in this tab; its tile is the calendar on `accent-soft` in the `link` colour, its line the lengths ("15 min · 30 min · Team"), and it ends in "Book" in the `link` colour (the accent itself falls under AA on a raised card in dark).
  - `contact`: the owner's contact card (spec 0051, AC-5115): its tile is an id card on `accent-soft`, its title the card's full name and its line the job title and company, and it ends in "Save contact" in the `link` colour. It is one plain link to the card's vCard on our own origin (`/api/public/handles/<handle>/contact.vcf`, answered as an attachment), opened in place, so it works with no script and straight from a QR code, and a phone offers to add the card to its contacts.
  - A block with no line under it keeps its title by its tile, left aligned like every other, and centred in the row's height (crm-87, 25 October 2026).
  - `testimonial`: something a customer said (spec 0052, AC-5220). A quiet quote in the reading measure, the author and their role under it in the muted colour, parted by a middot drawn in CSS. No border, no quotation mark graphic, no photo and nothing to press: it is the page talking, so it breaks out of the row list exactly as writing does, and it records no press because there is nothing to press. There is no photo because the page loads no picture from another origin, and a face would need file storage that does not exist yet.
  - `heading` set to `group: 'folder'` (spec 0054, AC-5416) draws as one row instead of a label: the page's own `.block` shape, its tile, its words, how many blocks are under it, and the chevron every staying row ends in, turned a quarter when it is open. The row is a real `button` inside the `h2` it names, which is the disclosure pattern: the page's outline keeps its heading, and the button carries `aria-expanded` and `aria-controls`, so the state is announced and the keyboard reaches it. The number beside the chevron is `aria-hidden` with "3 links inside" read in its place, so the row never reads as a bare number. A folder with nothing shown under it draws as the plain heading it was (AC-5419): a row that opens onto nothing is worse than no row.
  - **One folder is open at a time.** `openFolder` and `onOpenFolder` hand that state to the caller, which is how the public page keeps it in the address as `#<block id>` (AC-5417), so a link opens a section and the back button closes it. An address can hold one section, so the page holds one; with no `onOpenFolder` the page keeps its own, which is what the editor's preview and the stories want. A search leaves no headings in the list at all (the server drops them, spec 0051 AC-5133), so no folder can hide a match (AC-5418).
- **After** (`after`): a refusal's Callout, Show more.
- **Foot** (`foot`): the public page passes BookingFoot, tagged `booking_profile`. A slot rather than drawn here: the app's editor draws this page too, and a module both bundles import is split into a chunk of its own, taking BookingFrame's CSS out of the booking page's first load (0.6 kB more, gzipped, measured 25 October 2026). The editor's preview has no foot.

`siteIcon` (26 October 2026) is a path on our own origin, never the site's own address: the api fetches the favicon and answers it itself, so the pages' `img-src 'self' data: blob:` is unchanged and no visitor's browser is made to call a site they didn't open. It goes through `safeImageSrc` here as every image does, and the tile falls back to the letter the moment the image fails — a site with no icon answers 404, and a great many favicons are broken, so the fallback is the common case and not the edge. The icon is `alt=""` and `aria-hidden`, since the title beside it already says where the link goes.

Why the letter tile isn't an Avatar: an Avatar is a person (initials from a name, a circle or a workspace square at the avatar sizes), while this tile is one of the faces of one slot (a brand mark on a hairline, a Lucide icon on the sunken surface, a calendar or an id card on the accent's soft surface, a letter on a hue), all at the tile's own size. Bending Avatar to draw marks and icons, or adding a tile size to it for this slot alone, would have spread the tile across two components; the hue pairs are the same `tag-<hue>` tokens Avatar and Tag read.

`LinkPageTile` with no block is the tile's loading form (a Skeleton filling its place), which the page's loading blocks and the editor's loading rows (LinkList's `leadingLoading`) both draw, so the tile's size lives in this module alone.


## Writing

A `text` block is the person's own words rather than a row (spec 0052, AC-5206): its title as a small heading when it has one, the body under it with its line breaks kept, in the page's reading measure, with no frame and nothing to press. It breaks out of the list of pressable rows, so a run of rows is one `ul` and a piece of writing is prose between the lists: a list item that is not a link would read as one to a screen reader.

The body is drawn as text and never as markup, and the schema refuses every control character but a line break, so nothing in it can become an element. There is no bold, no italic and no inline link: a person who wants a link adds a link block. It records no press and shows no chip, because it has nowhere to go.

## Questions

A `faq` block is a set of questions on the library's own Disclosure (spec 0052, AC-5210): the block's title, defaulting to "Questions", then every question as a fold that starts closed, so the page stays short and a visitor reads it before reading the answers. Several open at once, since someone comparing two answers should not lose the first. Opening one counts nothing (AC-5211).

It sits in a raised card like the rows beside it, because on this page anything that is not the person's own prose is a card, and like writing it is not a list item and has nothing to press.

## A Timefix form

A `form` block is a row like a booking page's, with the owner's own words and a quiet chevron, that opens `/f/:key` in the same tab (spec 0052, AC-5215). It is our own origin, so it is an ordinary navigation: no `target`, no `rel`, no frame and no script from anywhere else. Its press is counted exactly as any other row's is.

## The owner's look

`theme` is six names (spec 0054): `ground`, `hue`, `mode`, `shape`, `fill` and `font`. They become six data attributes on this module's root, and this module's stylesheet has one block per value, each setting the page's own custom properties from token variables. Nothing is styled inline, no CSS is made at run time and no value is ever passed in, so a thousand pages are still one stylesheet and one contrast test.

Everything the page draws reads those properties rather than token variables directly, which is what lets a later block kind take the look by doing the same. `PageLook` repeats `PageTheme`'s keys because the library never imports the contracts; `page-theme.test.ts` fails when the two drift apart, when a value has no stylesheet block, or when a block holds a raw value instead of a token.

Two rules worth knowing. `data-theme` is set to the owner's mode on this root, so the token layer's system preference, which only applies where no `data-theme` is set, never decides somebody else's page. And a filled, tinted or outlined row moves its second line and its chevron onto the card's own colour: the quiet greys have no checked pair against the accent (`text-secondary` on `accent` measures 1.19:1). Ink means a dark page, so its override applies in light mode only; a page already in dark is ink.

`layout="blocks"` ignores the look: an editor's "How it looks" shows the one block being typed, in the app's own colours, not a page in miniature.

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
