# LinkPage

A person's link page at `/<handle>` (spec 0051, built as blocks): their face, name and bio, their social icons, then their blocks in the order they set (booking pages, links, and the small headings that group them), and the foot. The editor's phone preview draws the same component with `isPreview`.

## Why it exists

New (25 October 2026). The profile used to be BookingProfile with a LinkList of booking pages under it. A link page is a different object: every row is the one thing to press, told apart at a glance by a network's mark, an icon or a letter, and read on a phone first. LinkList is a list of things to manage (title, address, chips, switches and row menus, at row height), and BookingProfile is a card holding it; bending either into thumb sized cards with leading tiles would have changed every Captures list and the booking pages' card. So the page is its own module, built from the library's atoms (Avatar, Icon, ProviderMark, Skeleton, VisuallyHidden) and BookingFrame's foot, and LinkList gained one small variant instead (`leading`) for the editor's rows, which show the same tiles through `LinkPageTile`.

## Anatomy

- **Hero**, centred: Avatar `xl`, the name as the page's `h1` (`text-heading`), the bio (`text-secondary`), then `socials` (the person's own set of network icons, never a block).
- **Toolbar** (`toolbar`): a search once there are many blocks.
- **Blocks**, `space-12` apart, in groups: the blocks before the first heading, then each heading (an `h2`, `text-label-strong`) with the blocks under it. Each block is a raised card (`surface-raised`, hairline, `radius-xl`, `shadow-xs`, `space-12` padding) that is one real link: a leading tile (`LinkPageTile`, `size-row` plus `space-6` square), its title (`text-title`) and a line under it, and an arrow at the end.
  - `link`: opens the owner's address as typed (never wrapped or redirected) in a new tab, `rel="me noopener noreferrer nofollow"`; its name ends "(opens in a new tab)". Its tile is the network's mark (ProviderMark), else the picked icon, else the title's first letter on its hue's tag colours.
  - `page`: one of the person's booking pages, opened in this tab; its tile is the calendar on `accent-soft`, its line the lengths ("15 min · 30 min · Team").
- **After** (`after`): a refusal's Callout, Show more.
- **Foot**: BookingFoot, tagged `booking_profile`.

## Use

```tsx
<LinkPage
  person={{ name: 'Anish Gupta', id: 'anish', bio: 'Cofounder at Timefix.' }}
  blocks={[
    { kind: 'page', id, title: 'Intro call', href: '/anish/intro-call', facts: '30 min' },
    { kind: 'heading', id, title: 'Find me' },
    { kind: 'link', id, title: 'LinkedIn', href: 'https://www.linkedin.com/in/anish', mark: 'linkedin', hue: 'blue' },
  ]}
  claimHref={claimPageHref('booking_profile')}
  onPress={(id) => beacon(id)}
/>
```

- **A new kind of block** is one more member of `LinkPageBlock` and one more renderer in `RENDERERS` (and a tile in `LinkPageTile`); callers map their data onto the union and skip a kind they can't map, so an older page never breaks on a newer block.
- **`isPreview`** draws a plain region (no `main`), its content's height, `inert`: the editor's phone shows the page, and a press there never leaves the editor.
- **`onPress`** hears a block pressed, for a counter's beacon; it never holds up the navigation.

## States

Loading (no `person`: the hero's skeleton; no `blocks`: five block shaped places, the tile's and a title line's, so nothing moves when they arrive), empty (`empty` in the list's place), ready, long words (titles, notes, names and bios wrap inside their card), with Show more, and the preview. Hover lifts a card to `surface-hover` and `border-strong` on fine pointers only; focus draws `shadow-focus`; there is no press shrink (house rule). The blocks arrive with a short fade and a `space-2` rise over `duration-popover`; reduced motion keeps the fade.

## Keyboard

Tab reaches each block in reading order, then the foot's links. Enter opens a block.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
