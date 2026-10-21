# CommandPalette

The keyboard first picker for Quick actions (⌘K) and "Choose record": a search field over a list of rows, and a foot naming the keys.

## Why it exists

Ported from the artifact's CommandPalette card. The core loop (#10), relations (#15) and global search (#33) all pick through it. It is a `Modal` (its `palette` variant) holding an inline searchable `Menu` over a `ListSource`, so it is keyboard first, virtualised and async without new parts.

## Use

```tsx
<CommandPalette
  isOpen={isOpen}
  onOpenChange={setOpen}
  title="Choose record"
  items={results}
  onSearch={search}
  onAction={(item) => open(item.id)}
/>
```

- `items` is a `ListSource` of rows for the current search; rows still loading draw skeletons. `onSearch` gets each change to the search.
- A row shows its `name`, then its `description` (a domain, an email) under it, its `kind` at the end, and an action's `kbd`. `icon` or `leading` (an Avatar) comes first.
- Choosing a row (Enter or a click) calls `onAction` and closes the palette.
- Opened from the keyboard (⌘K) it appears at once; opened by pointer it grows in like any modal, and closing uses the exit animation.
- `searchStatus` says what an empty list means: `searching` ("Searching…"), `failed`, or (the default) nothing matches.
- **Sections** (spec 0039, the command menu): `sections` in place of `items`, each `{ id, label, items, status? }`, drawn as `MenuSection`s under their headings, in order. The arrows move across sections. A section with no rows is left out unless it has a `status`: `searching` adds a quiet "Searching…" row at its end, `failed` a "The search didn't finish. Try again." row that calls `onRetry` when chosen and keeps the palette open. With nothing in any section, the palette says "Nothing matches “<text>”". A polite live region says how many results show ("12 results", "No results"), and "Searching…" only once a search has run past half a second, so typing quickly never chatters. Why a variant and not a new component: the command menu is this palette with headings; a second palette would be a second look for the same element.
- `placeholder` is the field's hint ("Type a command or search…"); `title` names the dialog ("Command menu", "Search").
- A row's `isChecked` puts a check at its end, read as "Current" (the theme in use).

## States

Open with results, loading rows (skeletons), searching, the search failed, nothing matches. In sections: empty with recent items and actions (`Sections`), results in sections (`SectionsSearchAndChoose`), a section searching (`SectionSearching`), a section's search failed (`SectionFailed`), nothing matches (`SectionsNothingMatches`). Opened from the keyboard it appears at once (Modal's palette variant).

## Keyboard

It opens with its search field focused. Typing searches, the up and down arrows move the highlight, Enter chooses, Esc closes and returns focus to where it opened from.

## Differences from the artifact

- `items` is a `ListSource` with `onSearch`, rather than a static list; `sectionLabel` and `actionLabel` are gone (the foot names the keys instead of repeating the action).
- Match highlighting waits until a Menu row can take a highlighted label (spec 0039's follow up).
- Sections, the status row, the live count and checked rows are new (spec 0039).
