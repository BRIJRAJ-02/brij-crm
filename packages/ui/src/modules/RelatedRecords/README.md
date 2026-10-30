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
- `picker` is Add: a search menu over the side's far object, each result's note ("At Contoso") and its check when linked already, where picking it again does nothing. Leave it out where the side can't change.
- `onRemove` shows a Remove on each row. The screen drops the row at once and offers Undo in its toast; when it leaves while focus fell to the page, focus moves to the row now in its place, or the heading.
- `picker` shows Add after the heading once the side holds records, and in the empty row while it holds none (never both).
- `picker.onCreate(label)` adds "Create "<typed>"" (a plus) last in Add's search when what is typed matches no result's name, ignoring case and the spaces around it, and hands the label over for the screen to make the record and link it; nothing shows while the search is out or for a blank search. When it is the only item it isn't focused first, so one Enter on a typo makes nothing; an arrow reaches it. With `picker.createFormNoun` ("deal") the row reads "Create deal…" whatever is typed, for a far object that needs more than a name, and the screen opens its full form with the typed text. Leave both out for someone who may not make records of the far object. Why a variant: a search that found nothing was a dead end (owner flow pass, 30 October 2026); the row sits in the same search, as Select's `onCreate` does, rather than a second control. The rule lives in `fields/create-row.ts`, shared with ReferencePicker.
- `readOnlyReason` puts a lock with that reason after the heading, for a side the person may only read (spec 0009).
- The short form, for Overview's Related cards: `limit` draws the first rows with no heading, no Add or Remove; the Card around it names the side and holds its "View all <N>" in its actions, as Overview's other cards do.
- `ref` takes a `RelatedRecordsHandle` whose `focus()` opens the section if the person folded it and moves focus to its heading, for Overview's "View all".
- Focus never falls to the page: when a removed row leaves, it moves to the row now in its place (or the heading); when Show more's rows arrive, to the first of them; when the first record lands in an empty side, to it.
- The rows draw in full, not virtualised: they grow 20 at a time with Show more inside a sidebar that scrolls as a whole, and the data layer reads at most 200 of them again for a change (spec 0017: a hub of thousands is better worked in its table).

## States

Default (with Show more, Add and Remove), every row shown, Show more loading, Show more failed (said in a live region kept in place), read only (no Add, no Remove), read only with its reason, empty (with Add), loading (three skeleton rows), failed (Try again), no access, a large total in full, and the short form ready, empty, loading and failed. Disabled doesn't apply: a side that can't change is read only. Remove shows under a pointer or with focus in its row, and always on touch; the heading's Add the same, as Disclosure's quiet actions do.

## Keyboard

Tab reaches the heading's toggle (Enter or Space folds the section), Add, then each row's chip and its Remove, then Show more. In Add's menu, typing searches, the arrows move and Enter picks; Esc closes it and returns focus to Add.

## Differences from the artifact

Not in the artifact yet.
