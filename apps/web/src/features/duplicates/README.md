# Duplicates (spec 0049)

Likely duplicates on screen, all through `data.records.duplicates` (`@crm/data`):

| File                                               | What                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DuplicateHint.tsx`                                | The hint under the field just filled in the new record dialog (AC-4904): one match with Open (new tab, so the draft stays), several as chips. Never blocks Create.              |
| `DuplicateBanner.tsx`, `RecordDuplicateBanner.tsx` | A record page's banner (AC-4906): one pair with Merge (the merge dialog) and Not a duplicate, several with Review. Asked again 300 ms after the values a rule reads change.                        |
| `DuplicatesScreen.tsx`                             | `/w/$slug/objects/$object/duplicates` (`?record=` narrows it), from the view menu's Find duplicates (AC-4907 to AC-4909), with its loading, empty, failed and no access states. |
| `useDismiss.ts`                                    | Not a duplicate, shown at once, with Undo in its toast (AC-4908).                                                                                                               |
| `matched.ts`                                       | Which attributes a rule reads (name, email, domain, a person's Company), so only they go in a check.                                                                            |

The import preview's Likely duplicates filter lives in `../imports/ImportScreen.tsx` (AC-4918).

## The merge dialog (`merge/MergeDialog.tsx`)

- **Purpose**: merge two records of one object into one, keeping what both hold (AC-4910 to AC-4917).
- **Main task**: see both side by side, pick the value to keep where they differ, read what moves, then Merge.
- **Leaves out**: finding likely pairs (the review page and banner open it with both ids), undo (a merge can't be
  undone, so the dialog is its confirmation, AC-4916), and any optimistic change: nothing shows before the server
  answers.

- Opened through `useMergeDialog` (`merge/index.ts`) with one record (the record page's More › Merge with…, which asks
  for the other first, through the record search, never offering the record itself) or two.
- The newer record (the greater uuid v7) is merged away by default; Swap, at the footer's start, keeps it instead.
- A row per attribute both hold differently that the reader may change (from `records.mergePreview`): a card per side,
  the record's name over its value through the field display, the kept side preselected. Multi values, empty sides,
  hidden and read only attributes are never rows; the server combines them.
- The line above the rows says what happens: "Jane D. will be merged into Jane Doe. Its 3 links, 2 notes and 1 list
  entry move over. This can't be undone."
- Merge shows pending ("Merging…") and the dialog can't be closed meanwhile. A refusal shows in the dialog as a danger
  Callout; a record changed meanwhile (`CONFLICT`) reads both again. Too much attached shows a warning and no Merge.
- Once it lands: "Merged into Jane Doe", the kept record's new values everywhere, the merged one gone from every list.
- States: loading (a skeleton), failed (a danger Callout with Try again), ready, pending, refused, too large.

## A merged record's address (`features/records/RecordPage.tsx`)

- Opening a merged record's page goes to the record it was merged into, with "Jane D. was merged into Jane Doe"
  (AC-4914). When the reader can't see that record, the page reads as a record in the trash would.

## Not yet

- A merged record whose kept record the reader can't see opens as a trashed one, with a Restore the server refuses.
- A value card's links (a URL, a record chip) still take a Tab stop inside the card; the `preview` surface should draw
  chips without links (a field set rule).
