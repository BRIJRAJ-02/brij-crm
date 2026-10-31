# 0049. Duplicate warning and record merge

**Date**: 2026-10-31
**Status**: Proposed

**Numbering**: 0049 was set aside for this on 23 October 2026. This spec owns AC-4901 to AC-4999 and closes scope feature #31. It touches spec 0040 (import, its "#31 duplicates" row), 0022 (trash), 0014 (relationships), 0019 (notes and tasks) and 0059 (company filing), and changes none of their rules beyond what is written here.

## Summary

When you add or edit a record that looks like one you already have, a short hint under the field names the existing record, with Open and Merge. Saving still works. A Duplicates page per object lists likely pairs with the reason, and you can merge them or mark them "Not a duplicate", which is remembered. Merging shows both records side by side, you pick a side for each field that differs, and everything else (emails, domains, links, notes, tasks, comments, files, list entries, meetings and history) moves onto the record you keep. Imports flag rows that look like existing records.

## Requirements

**User stories**:
- As a member adding Jane, I want to see that Jane Doe at Acme already exists before I make a second one.
- As a member cleaning up, I want one list of likely duplicates with the reason, so I can merge or dismiss each pair in a few clicks.
- As a member merging, I want to choose which name, owner or stage wins, and lose nothing else.

**Acceptance criteria**:

*What counts as a likely duplicate*
- **AC-4901**: Two live records of the same object are a likely pair when any rule holds, each with its reason:
  - **People**: the same full name and the same Company ("Same name and company"; never name alone), or a shared email address ("Same email").
  - **Companies**: the same name ("Same name"), or a shared domain ("Same domain").
  - **Any other object**, custom ones included: the same primary name ("Same name"), or a shared value in any email or domain attribute ("Same email" or "Same domain").
- **AC-4902**: Matching is exact after one normalisation, `crm_match_key`. It folds case, joins runs of spaces, drops punctuation, and for company names drops one trailing legal suffix (inc, llc, ltd, limited, plc, gmbh, corp, co, pvt, pte, sa, ag, bv). Emails match on the whole lowercased address and domains on the lowercased host, each within the same attribute. There is no fuzzy matching.
- **AC-4903**: A pair someone marked "Not a duplicate" is never suggested again, by any rule. Trashed records and records the reader cannot see are never suggested, and a reader who cannot see the attribute a rule reads gets no pair by that rule.

*The warning while adding or editing*
- **AC-4904**: The create dialog checks as the member types, 300 ms after the last change to a name, email or domain field (or to Company on a person); its Open links open a new tab so the draft stays. On the record page the banner (AC-4906) takes the hint's place and checks again when a value is saved. Up to 3 matches show under the field: "Jane Doe already exists · Same name and company", each with **Open**, and **Merge** on the record page. Saving is never blocked by a likely match.
- **AC-4905**: When an email or domain is taken by a unique attribute, the existing refusal stays: the save is refused with `UNIQUE_CONFLICT`. If the reader can see the holder, the message names it and offers Open: "jane@acme.com belongs to Jane Doe". If they cannot, the message stays "This value is already in use" and names nothing (spec 0040, AC-1119).
- **AC-4906**: A record page shows one banner when the record has a likely pair: "Possible duplicate of Jane Doe · Same email", with **Merge** and **Not a duplicate**. With several pairs it says "3 possible duplicates" and opens the review page filtered to this record.

*The review page*
- **AC-4907**: Each object's view More menu has **Find duplicates**, which opens `/w/$slug/objects/$object/duplicates`, a full width page. It lists likely pairs, each as two record chips, the reason, and **Merge** and **Not a duplicate**. Pairs are paged 50 at a time, newest record first, and a record in several pairs shows in each. A page reads at most 2,000 records and 50 holders per key, so it may come back short and still carry a cursor.
- **AC-4908**: **Not a duplicate** removes the pair at once, with Undo in the toast. The answer is kept per pair, for everyone in the workspace, and is written to the audit log.
- **AC-4909**: The page has loading, empty ("No likely duplicates in People"), error with Try again, and no access states. A member who cannot write the object sees the pairs with no Merge.

*Merging*
- **AC-4910**: **Merge** opens a dialog with both records side by side and the newer one preselected as the one merged away. The member can swap which is kept. Every attribute where both hold a different value, and the reader may see and write it, shows as a row with a choice of side. The kept record's side is preselected, except that an empty side is never preselected over a filled one. Attributes where only one side holds a value, or both hold the same value, are not shown, and the filled value wins.
- **AC-4911**: Multi value attributes (emails, phones, domains, tags, multi selects, record references) are not offered as a choice, and are united even when hidden or read only. The kept record gets every value of both, without repeats. A unique value moves from the merged record to the kept one.
- **AC-4912**: Hidden or read only attributes are not shown. On them the kept record keeps its value, and takes the merged record's only when its own is empty. Read only system attributes (created at, created by, record id) stay the kept record's. Validation rules are skipped, as for a restore.
- **AC-4913**: Confirming the merge moves everything that points at the merged record onto the kept one, in one transaction:
  - links on every relationship (a link the kept record already has is not doubled, and a link between the two records is dropped);
  - list entries, with their entry values (in a list that allows a record once, where both are present, the kept entry stays and takes the other entry's values only where its own are empty);
  - notes, comments, files, tasks, meetings and attendees, form submissions, bookings, notifications and lead routing assignments;
  - the merged record's past values, so the kept record's history shows both.
- **AC-4914**: The merged record leaves the app. It is trashed with `merged_into` set to the kept record, shown in no list, search or trash restore, and purged with the normal 30 day purge. Opening its address takes the reader to the kept record with a toast: "Jane D. was merged into Jane Doe".
- **AC-4915**: The kept record's activity shows "Brij merged Jane D. into this record" and the merged record's past activity. One audit entry names both records and the actor. Change events name the kept record, the merged record and every record on the far side of a moved link, so other tabs update live.
- **AC-4916**: The dialog states what will happen: "Jane D. will be merged into Jane Doe. Its 3 links, 2 notes and 1 list entry move over. This can't be undone." The merge button reads **Merge**. While the merge runs, the dialog shows a pending state, then closes with "Merged into Jane Doe".
- **AC-4917**: A merge is refused, with nothing changed, when:
  - either record changed since the dialog opened (`CONFLICT`: "Jane Doe changed while you were merging. Review it again");
  - either record is trashed or already merged (`NOT_FOUND`);
  - the records belong to different objects (`INVALID`, 422), or are the same record (`INPUT_INVALID`, 400, at the API boundary);
  - the merged record has more than 10,000 links, entries, attached items and past values (`MERGE_TOO_LARGE`: "Too much is attached to merge in one go"), counted before any write.

*Imports*
- **AC-4918**: An import's preview counts the rows it will create that look like existing records by AC-4901's name rules ("12 new rows look like existing records"). It lists them under a **Likely duplicates** filter with the matched record's name. Nothing is merged or skipped for the member; they decide in the file or after the import. Unique key matching (spec 0040, AC-1117) is unchanged.

*Access*
- **AC-4919**: Merging needs write on the object and both records visible. The merged record also needs the same rights a delete needs (record rules included). A member without them sees no Merge anywhere, and the API answers `FORBIDDEN` without saying whether the other record exists.
- **AC-4920**: The duplicate check, the review page and the banner return only records the reader can see, through the access door. A pair whose other record is hidden is absent, never shown as locked.

## Decision

**Chosen option**: Option 1. Exact match keys checked at read time on indexed values, a side by side merge in one engine transaction, and remembered dismissals.

**Implementation skills**: `crm-data-model-access`, `crm-api-backend`, `crm-frontend-state`, `crm-design-system` (project skills, `.claude/skills/`) · `drizzle` (`.claude/skills/drizzle/`) · `react-aria` (`.claude/skills/react-aria/`)

## Feature design

**Data model sketch** (one migration, placeholder number until the landing train renumbers it):

- `records.merged_into_record_id uuid null`, FK to `records(id)`, partial index on it where not null. Set only together with `deleted_at` by a merge.
- `record_duplicate_dismissals`: `workspace_id` (FK, required), `object_id` (FK, required), `low_record_id` and `high_record_id` (FK to records, required; the two ids ordered so low < high), `created_by_member_id` (required), `created_at` (required). Primary key `(workspace_id, low_record_id, high_record_id)`. Forced row level security with the workspace policy, like every tenant table.
- `crm_match_key(kind text, value text) returns text`, an immutable SQL function: `kind` is `name`, `company_name`, `email` or `domain`, applying AC-4902.
- `values.match_key text null`, set by the engine through `crm_match_key` and `crm_match_kind` on name, email and domain values, with one partial index `values_match` on current values. It is a stored column, not an expression index, because under forced row level security only leakproof operators can use an expression index. A custom object's name change re-keys its values, and the migration backfills existing values.
- No stored pairs table. Pairs are found at read time from these indexes.

**API surface** (oRPC, `records` router):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `records.duplicates.check` | `objectId`, `values` (draft values by attribute id), `excludeRecordId?` | up to 3 `{ recordId, display, reason }` | member, read on the object | `FORBIDDEN` |
| `records.duplicates.list` | `objectId`, `recordId?` (filter to one record), `cursor?` | `{ pairs: [{ a, b, reason }], cursor? }`, 50 a page | member, read on the object | `FORBIDDEN` |
| `records.duplicates.dismiss` | `objectId`, `recordIds: [a, b]` | `{ dismissed: true }` | member, write on the object | `FORBIDDEN`, `NOT_FOUND` |
| `records.duplicates.restore` | `objectId`, `recordIds: [a, b]` | `{ restored: true }` (Undo of dismiss) | as dismiss | as dismiss |
| `records.merge` | `objectId`, `keepId`, `mergeId`, `picks: { attributeId: 'keep' or 'merge' }`, `revisions: { keep, merge }` (a retry of the same pair by the same actor answers the merge again, so no separate key) | `{ recordId, version, moved: { links, entries, items } }` | member, AC-4919 | `CONFLICT`, `NOT_FOUND`, `INVALID`, `FORBIDDEN`, `MERGE_TOO_LARGE` |
| `records.mergePreview` | `objectId`, `keepId`, `mergeId` | rows that differ, counts of what moves | as merge, read only | as merge |
| `records.getTrashed` (existing) | unchanged | adds `mergedInto?: { recordId, display }` for a merged record the reader may see the target of | unchanged | unchanged |
| `imports.duplicates` | the staged import | likely duplicate rows with the matched name | member, 30 a minute, 3 second timeout | `FORBIDDEN` |

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| check, list | match keys | `crm_match_key` over current values of the object's primary attribute and its email and domain attributes |
| check, list | a person's Company for the name rule | the person's current link on the standard `company` attribute (record_links) |
| check, list | reason text | the rule that matched (AC-4901) |
| list | newest first | `records.created_at` of the newer record of the pair, then ids |
| list, banner | dismissed pairs | `record_duplicate_dismissals` |
| merge preview | rows that differ | current values of both records for attributes the reader may see and write |
| merge preview, dialog | counts that move | counts of links, list entries and attached items on the merged record |
| merge | preselected merged record | the newer `created_at` of the two |
| merge | picks for unshown attributes | the filled side, else the kept record (AC-4910, AC-4912) |
| redirect | where a merged address goes | `records.merged_into_record_id`, followed to the end of a chain |
| import preview | likely duplicate rows | the same name rules run for staged create rows against live records |

**Key invariants**:
- A merge either moves everything and trashes the merged record, or changes nothing.
- No current value, link or entry points at a merged record after a merge.
- `merged_into_record_id` is set only together with `deleted_at`, never points at itself, and a restore never applies to a merged record.
- A dismissal is stored once per pair, ordered ids, never per direction.
- Unique keys stay unique: the merged record's current unique values are ended before the kept record takes them.

**Security model**:
- Every procedure goes through the access door (`requireMember`, `checkObject`, `checkRecordVisible`). Pair queries apply record rules and field rules inside SQL, never filtered after.
- Merge runs as the member through the engine's write paths (`updateRecord`, the link and entry writes), so value history, audit and change events are written as for any edit.
- Moving rows the member could not otherwise write (notes, comments, files by others) is allowed, because the merge moves them to a record of the same object they may write, and nothing changes who can read them beyond the kept record's rules. This is accepted on purpose and named in the audit entry.
- The check endpoint is limited to 60 calls a minute per member, the pairs list to 120, through the central limits module.
- A person's Company counts for the name rule only when that company is live and visible to the reader. A far record the reader cannot see is never offered or moved as a single link in a merge. Entry values are filled only where the member may write that list.

**Critical test scenarios**:
- Happy path: two Jane Does at Acme are paired "Same name and company", merged with Jane Doe's phone picked from the other side; links, notes, a task and a list entry move; the merged address redirects. Verifies **AC-4901**, **AC-4910**, **AC-4913**, **AC-4914**
- Dismissal: Not a duplicate hides the pair for another member too, and Undo brings it back. Verifies **AC-4903**, **AC-4908**
- Collisions: both records sit in a list that allows a record once, and both link to the same deal; after the merge there is one entry and one link. Verifies **AC-4913**
- Conflict: a second member edits Jane Doe while the dialog is open; the merge is refused and nothing moved. Verifies **AC-4917**
- Access: a member with read only on People sees pairs but no Merge, and the API refuses with `FORBIDDEN`; a pair whose other record is hidden by a record rule is absent. Verifies **AC-4919**, **AC-4920**
- Unique email: typing a taken email names the holder only to a reader who can see it. Verifies **AC-4905**
- Import: a file row "Jane Doe, Acme" with a new email shows under Likely duplicates. Verifies **AC-4918**

## Build plan

Tracer Bullet: one thin merge through every layer first, then the warning, the page and imports.

1. Migration: `merged_into_record_id`, `record_duplicate_dismissals` with forced row level security and its policy, `crm_match_key`, and the two expression indexes. Guard tests: the new table forces row level security, and a cross workspace read returns nothing. Satisfies **AC-4902**, **AC-4903**, **AC-4914**
2. Merge core: `mergeRecords(tx, scope, input)` in `packages/core/src/engine/merge.ts`, including values (single by pick, multi united, unique ended then moved), links, entries, attached tables, history rows, the trash with `merged_into`, audit and change events, plus the size count and the revision check. DB tests for every table in the move list and each refusal. Satisfies **AC-4910** to **AC-4915**, **AC-4917**, **AC-4919**
3. `records.merge` and `records.mergePreview`, plus `mergedInto` on `records.get`, in contracts and the API router. API tests, with a denied actor. Satisfies **AC-4917**, **AC-4919**
4. Merge dialog in the app: launched from the record page's More menu ("Merge with…", record picker) for the first slice; data layer write with a pending state; redirect of a merged address. Browser tests. Satisfies **AC-4910**, **AC-4914**, **AC-4916**
5. Pair finding: `findDuplicates` (by draft values) and `listDuplicatePairs` (paged) in `packages/core/src/engine/duplicates.ts`, plus dismiss and restore. DB tests including a hidden attribute, a record rule and a dismissed pair, and a timing check on the million record seed in CI. Satisfies **AC-4901** to **AC-4903**, **AC-4908**, **AC-4920**
6. Warning and banner: the create dialog and record page hints, the unique conflict message naming a visible holder, and the record banner. Browser tests. Satisfies **AC-4904** to **AC-4906**
7. Review page: route, More menu entry, pairs list with Merge and Not a duplicate, all states. Browser tests. Satisfies **AC-4907** to **AC-4909**
8. Import preview: likely duplicate rows counted and filtered in the staged preview. Core and browser tests. Satisfies **AC-4918**
9. Screens check: design system and UX reviewers, light and dark, inside the real layout with the dialog open. Satisfies **AC-4904** to **AC-4916**

## Consequences

**Positive**:
- One place to clean data, and a warning that stops most duplicates from being made at all.
- Merge reuses the engine's writes, so history, audit and live updates come for free.

**Negative / tradeoffs**:
- Exact matching misses "Jon" and "John". That's on purpose, to avoid false alarms. Fuzzy matching is a follow-up.
- A merge cannot be undone. The dialog's plain statement and the merged record's kept history are the safety net.
- The merge moves notes and comments written by others onto the kept record without asking their authors.
- Two expression indexes add write cost to every name, email and domain value.

**Neutral**:
- Unique emails and domains already refuse true duplicates; the warning names the holder instead of only refusing.
- Spec 0059's company filing finds the holder by domain the same way, so filing and merging agree on what "the same company" means.

## Follow-up

- [ ] Re-keying after a name change and the backfill run in the request and migration; at a million records they want batched jobs. A timed million record pair page test is owed.
- [ ] Pairs and dismissals don't update live across tabs (no change event for a dismissal).
- [ ] History lists no sentence yet for merges and dismissals (in `AUDIT_NOT_LISTED`).
- [ ] A merged record whose kept record is hidden from the reader shows Restore, which the server refuses.
- [ ] Merges above 10,000 attached items run as a background job (spec 0008) instead of being refused.
- [ ] Fuzzy name matching through `crm_search_similar`, if exact matching proves too strict.
- [ ] Unmerge within a short window, from a merge log.
- [ ] Email sync (scope #31's "email sync avoid creating new duplicates") arrives with the email feature, and uses `findDuplicates`.
- [ ] The scope row mentions the old Timefix duplicate and company match logic as a starting point. It was not read for this spec; the builder may compare it.

## Rationale

See [rationale.md](rationale.md).
