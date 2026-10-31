# Duplicates (spec 0049)

Likely duplicates on screen, all through `data.records.duplicates` (`@crm/data`):

| File                                               | What                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DuplicateHint.tsx`                                | The hint under the field just filled in the new record dialog (AC-4904): one match with Open (new tab, so the draft stays), several as chips. Never blocks Create.              |
| `DuplicateBanner.tsx`, `RecordDuplicateBanner.tsx` | A record page's banner (AC-4906): one pair with Merge and Not a duplicate, several with Review. Asked again 300 ms after the values a rule reads change.                        |
| `DuplicatesScreen.tsx`                             | `/w/$slug/objects/$object/duplicates` (`?record=` narrows it), from the view menu's Find duplicates (AC-4907 to AC-4909), with its loading, empty, failed and no access states. |
| `useDismiss.ts`                                    | Not a duplicate, shown at once, with Undo in its toast (AC-4908).                                                                                                               |
| `launch.ts`                                        | The one way a Merge button reaches the merge dialog. Absent until wip/merge-core plugs its dialog in, so no Merge shows yet.                                                    |
| `matched.ts`                                       | Which attributes a rule reads (name, email, domain, a person's Company), so only they go in a check.                                                                            |

The import preview's Likely duplicates filter lives in `../imports/ImportScreen.tsx` (AC-4918).
