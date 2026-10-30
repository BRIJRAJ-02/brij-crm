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
- A row's `choice` makes it one option of a choice ("Theme"): a choice's rows are drawn together wherever the matching sorted them, as a group of their own joined to their section's rows with no gap or heading (named after the choice, or after the section when they come first in it), and each reads as a radio item, checked or not. `isChecked` marks the option in effect (the theme in use) with a check at the end, which screen readers hear as checked (QA Q47, 23 October 2026: the check was drawn but never announced). A section's status row is never an option. A row with `isChecked` and no `choice` draws the check, heard as "Current".
- Its search is Menu's `size: 'lg'` (30 October 2026): a bar's height, the title's 15px, and rows `size-input` tall, as Linear's and Attio's palettes are.

## States

Open with results, loading rows (skeletons), searching, the search failed, nothing matches. In sections: empty with recent items and actions (`Sections`), results in sections (`SectionsSearchAndChoose`), a section searching (`SectionSearching`), a section's search failed (`SectionFailed`), nothing matches (`SectionsNothingMatches`), the theme in use announced (`ThemeChecked`), a choice kept together (`ChoiceKeptTogether`), the highlight as the text changes and records come in (`HighlightFollowsTheText`), and Enter before the records (`EnterBeforeTheRecords`). Opened from the keyboard it appears at once (Modal's palette variant).

## Keyboard

It opens with its search field focused. Typing searches, the up and down arrows move the highlight, Enter chooses, Esc closes and returns focus to where it opened from.

In sections, each key typed moves the highlight to the first row that matches the text now (React Aria's Autocomplete; a deleting key clears it). Enter chooses the highlighted row, read from the rows themselves: React Aria names that row to the field (`aria-activedescendant`) only half a second after a key, so the field can still name no row while rows that came in later sit above the highlight. With no row highlighted, Enter chooses the first row. With no rows yet while a section is searching, Enter waits and chooses the first row once that search is in for the same text; new text, any other key or an answer with no rows drops it. The caller keeps rows found for earlier text out of `sections` while its search for the new text is out (the command menu shows only "Searching…" there), so no such row can hold the highlight or an Enter.

## Differences from the artifact

- `items` is a `ListSource` with `onSearch`, rather than a static list; `sectionLabel` and `actionLabel` are gone (the foot names the keys instead of repeating the action).
- Match highlighting waits until a Menu row can take a highlighted label (spec 0039's follow up).
- Sections, the status row, the live count and checked rows are new (spec 0039).
