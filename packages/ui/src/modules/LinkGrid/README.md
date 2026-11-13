# LinkGrid

Links as a grid of LinkCards: Captures › Links' booking pages and Captures › Forms' forms.

## Why it exists

New on 20 October 2026, with LinkCard, when the owner swapped Captures' one line rows for a card grid after Calendly's event types. LinkList stays for compact rows inside a card (Bookings › Availability's "Your pages"). LinkList is a React Aria GridList of rows, and a grid of cards that are each a link with their own controls reads and tabs better as a plain list of articles. So this is a separate module rather than a layout variant of LinkList.

## Use

```tsx
<LinkGrid
  label="Booking pages"
  cards={pages.map((page) => ({ id: page.id, title: page.title, href, hue, facts, address, toggle, copyValue, actions }))}
  query={query}
  onQueryChange={setQuery}
  status={status}
  onRetry={retry}
  errorTitle="Booking pages didn’t load"
  emptyState={<EmptyState … />}
/>
```

- **Width:** the grid fills the view's whole width (the owner's rule). It holds as many columns as fit cards at least size-column-wide (300px) wide, one on a phone, space-16 apart, with the page's space-16 gutter round it. Cards in a row are as tall as each other.
- **Search:** the search lives where the page draws it (Captures puts LinkListToolbar in its tab strip) and comes in as `query`. The grid narrows the cards by title or link, and says when nothing matches, with Clear search from `onQueryChange`.
- **`status`:**
  - `loading`: six LinkCardSkeletons after the loading delay, read as "Loading <label>".
  - `error`: an EmptyState with Try again, titled `errorTitle`.
  - `no-access`: the locked EmptyState.
- **`emptyState`:** shows with no cards at all.
- **`groups`:** draws the cards in titled groups, in order, each under a SectionBar heading (an h2, with an optional quiet line) over its own grid, and each card's title then an h3. A card names its group by `groupId`; one naming no group the grid knows sits in a last grid with no heading, so it is never lost; a group the search empties is left out. Why a prop (30 October 2026): Captures › Links shows the workspace's own links apart from members' pages, and a screen can't draw a heading between grids itself. A variant of this grid, not a new module, since each group is the same grid of the same cards.
- **`hasPictures`:** the cards carry a picture (LinkCard's `picture`), so the loading cards draw its stage too and nothing jumps when they land.
- **`cardVariant`:** `page` when the cards are LinkCard's `page` variant (Bookings › Pages), so the loading cards draw that shape.

## States

Cards, grouped, many cards, phone (one column), loading, failed, no access, nothing matches, and empty. Each card has its own states (see LinkCard).

## Keyboard

A list of cards: Tab moves through each card's link and controls in order.

## Differences from the artifact

Not in the artifact yet.

## Timefix prototype (spec 0072)

Takes its look from the prototype's LinkList family through LinkCard, which it renders: each card is LinkCard's prototype look (a `surface` card, `border-subtle` hairline, `radius-lg`, no shadow at rest, the edge and `shadow-xs` under a pointer, the outline ring on focus). The grid itself keeps its own rules, which the prototype only draws as demo layout (its booking pages and forms demos), so nothing here changed and none of its rules repeat LinkCard's.

**Use it for** Captures › Links and Forms, Bookings › Pages. **Don't use it for** a short list beside other work (LinkList).

**The consumer provides** `label`, `cards` (LinkCard's props with an `id` and an optional `groupId`), `query` and `onQueryChange`, `status` with `onRetry`, `errorTitle`, `emptyState`, `groups`, `hasPictures`, `cardVariant`.

**Differences from the prototype**
- Kept: the search, groups, the loading cards and every state above; the prototype's demo grid (`auto-fill` columns of `size-menu` plus `space-12`, `space-12` apart) is not a component rule, so the library's `size-column-wide` columns `space-16` apart stay.
