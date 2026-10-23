# RelatedRecords

A record's related records on one side that holds many: a company's Team, its Associated deals, a person's deals.

## Why it exists

New (spec 0017, milestone 3; spec 0014 named it for its record panel). A side that holds many records can hold thousands, so Details leaves it out: one attribute row with a cell's first 20 chips and "+N" can't page, add or remove. RecordChipList draws chips that wrap, for a handful of recent records with no actions; AttributeList draws attribute rows. Neither pages a long list with a total, Show more, Add and a Remove per row, so this module joins existing pieces: Disclosure (the section's folding heading, with its count whole), RecordChip (each row), Menu with its search (Add, as ReferencePicker's search does), Button, Skeleton and EmptyState. No new tokens.

## Use

```tsx
<RelatedRecords
  title="Team"
  noun="people"
  records={rows.map((display) => ({ display, href: recordHref(display) }))}
  total={150_000}
  hasMore
  onShowMore={section.showMore}
  picker={{ onSearch, describeResult, onPick: add }}
  onRemove={askToRemove}
/>
```

- `title` is the side's name, the section's heading; `noun` is the far object's plural, lower case: the total reads "Team 150,000" (said as "150,000 people"), an empty side "No people yet", and Add searches "Search people".
- The rows are what the screen holds, in the side's order; `hasMore` and `onShowMore` ask for the next ones, `isLoadingMore` marks Show more busy, and `isMoreFailed` says it didn't load (pressing it again tries again).
- `picker` shows Add (after the heading, and in the empty row): a search menu over the side's far object, each result's note ("At Contoso") and its check when linked already, where picking it again does nothing. Leave it out where the side can't change.
- `onRemove` shows a Remove on each row. The screen asks first (a Modal) and then drops the row; when it leaves while focus fell to the page, focus moves to the row now in its place, or the heading.
- The short form, for Overview's Related cards: `limit` draws the first rows with no heading (the Card around it names the side), no Add or Remove, and `onViewAll` a "View all <N>" footer, said in full ("View all 12 people in Team").
- `ref` takes a `RelatedRecordsHandle` whose `focus()` moves focus to the section's heading, for Overview's "View all".
- The rows draw in full, not virtualised: they grow 20 at a time with Show more inside a sidebar that scrolls as a whole.

## States

Default (with Show more, Add and Remove), every row shown, Show more loading, Show more failed, read only (no Add, no Remove), empty (with Add), loading (three skeleton rows), failed (Try again), no access, a large total in full, the short form and the short form empty. Remove shows under a pointer or with focus in its row, and always on touch; the heading's Add the same, as Disclosure's quiet actions do.

## Keyboard

Tab reaches the heading's toggle (Enter or Space folds the section), Add, then each row's chip and its Remove, then Show more. In Add's menu, typing searches, the arrows move and Enter picks; Esc closes it and returns focus to Add.

## Differences from the artifact

Not in the artifact yet.
