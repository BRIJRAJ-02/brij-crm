# 0040. Import and export: CSV into any object, and any view out

**Date**: 2026-10-20
**Status**: Accepted (21 October 2026)
**Numbering**: handed out by the coordinator on 20 October 2026 (roadmap, Release 1) as 0037, renumbered 0040 on 21 October 2026 when 0037 went to team scheduling and access. This spec owns AC-1111 to AC-1150.

## Owner decisions needed

The owner accepted every recommendation below on 21 October 2026; each is now a decision.

Each has a recommendation and a runner up. The build follows the recommendations; changing one later is noted beside it.

1. **Where a CSV is read and its text turned into values.** Recommended: in the browser, with the field set's own `fromText` for each attribute type, then the typed rows are staged on the server in chunks of up to 1,000 and every value is checked again by the engine as it is written. One type is parsed in one place, the preview is instant, and no file storage is needed. Runner up: upload the raw file (to R2, #32) and parse it in the worker, which needs file storage first and a second, server side copy of every type's text rules.
2. **What happens when a row matches an existing record.** Recommended: three choices, with **Fill empty fields** as the default (scope #30: "filling blanks, never erasing"); **Overwrite with the file's values** and **Skip** are the others. In every choice an empty cell never clears a value, and an attribute that holds several values (emails, domains, tags) gains the file's values beside the ones it holds. Runner up: fill empty fields and skip only, no overwrite.
3. **The undo window.** Recommended: 7 days. Undo moves every record the import created to the trash (one batch, restorable for the trash's 30 days) and puts back every value it changed, except a value someone changed since, which is kept and counted. Runner up: 24 hours.
4. **Where export files live, and how big one may be.** Recommended: in Postgres, as text chunks beside the job, kept 7 days and deleted by the daily cleanup, at most 100,000 rows a file until R2 (#32) arrives; the download is a plain authenticated `GET` that checks the session, the member door and that the caller started the export. Runner up: wait for R2 and allow the full million.
5. **Limits.** Recommended: 100,000 rows, 250 columns and 50 MB per file; at most 3 imports per workspace unfinished at once (staged or running); exports as in 4. All in the limits module, ready for plans (#38). Runner up: 10,000 rows per file until plans exist.
6. **Excel files.** Recommended: CSV only in this spec (UTF-8, or Windows-1252 when the bytes aren't UTF-8; comma, semicolon or tab), Excel `.xlsx` in a follow up once a parser is chosen and measured against the first load. Runner up: add SheetJS now, lazily loaded.
7. **Relation columns.** Recommended: a column mapped to a relationship attribute links each name to an existing record of the far object, matched by its unique attributes (domain, email) and then by its exact name, ignoring case; no match leaves that link out and says so on the row; the import never creates far records. Runner up: create a far record for each name that matches nothing.
8. **New attributes while matching.** Recommended: "New attribute" in a column's picker, for members who may manage the object's attributes, creating it with the header as its name and the type the column's values suggest (text when unsure), through the existing attribute service. Runner up: map only to attributes that exist; create them in Settings first.

## Summary

A member opens **Import CSV** on any object, drops a CSV file, matches its columns to the object's attributes (done for them by header name and value type, no AI), chooses how rows find existing records (by email, domain or any unique attribute) and what happens when they do, previews every row with its errors, and starts the import. It runs as a background job with live progress, can be cancelled, ends with a summary of what was created, updated, skipped and refused and why, and can be undone for 7 days. From any table, **Export CSV** writes the view as it stands (its saved query, or the unsaved filter and sorts on screen) to a CSV file in a background job, with only what the member may read, and offers a download when it is ready.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0008 background jobs | `startJob`, item kinds, slices, cancel, retries, progress events, the Background jobs page, the daily cleanup | hard prerequisite (landed) |
| Spec 0003 field set | `fieldTypeOf(type).fromText` for every type, `createPhoneParser` | hard prerequisite (landed) |
| Spec 0004 and 0009 engine and door | `insertRecord`, `updateRecord`, value history, change events, the unique index, `checkObject`, field and record rules | hard prerequisite (landed) |
| Spec 0020 saved views | a view's query and visible columns (`getView`), `readPage` with the keyset cursor | hard prerequisite (landed) |
| Spec 0022 trash | `deleted_batch_id`, the trash's restore | hard prerequisite (landed) |
| Spec 0022 milestone 3 (lane `wip/bulk`) | the jobs screen changes and bulk jobs | nothing here waits on it; both reuse spec 0008's runner |
| #32 files on R2 | larger exports, `.xlsx` uploads | Postgres chunks, 100,000 rows (decision 4) |
| #31 duplicates | warning about likely duplicates in a file | the unique key match only |

## Requirements

**User stories**:
- As a new customer, I want to bring my contacts and companies from a spreadsheet or my old CRM in one go, without retyping anything.
- As a member, I want the columns matched for me and to see exactly what will happen to each row before anything changes.
- As a member, I want a second import of the same people to fill in what's missing rather than make duplicates or wipe what my team typed.
- As a member who imported the wrong file, I want to take the whole import back.
- As a member, I want any table I'm looking at as a CSV, with only what I'm allowed to see.

**Acceptance criteria** (AC-1111 to AC-1146 used; the rest of the range is spare):

*Starting an import*
- **AC-1111**: The view's More menu on any live object holds **Import CSV** for members who may write the object; it opens `/w/$slug/objects/$object/import`, a full width page with four steps (Upload, Match columns, Match records, Preview) shown in a Steps bar. The page and the CSV reader load lazily, outside the first load.
- **AC-1112**: Upload takes one file by drop or by choosing: a `.csv` (or `.tsv`, `.txt`) of at most 50 MB, at most 100,000 data rows and 250 columns. Anything else is refused on the spot with why ("This file is 62 MB. Import at most 50 MB at a time."). The first row is the headers; an empty header becomes "Column 4"; fully empty rows are dropped; a UTF-8 byte order mark is removed; bytes that aren't valid UTF-8 are read as Windows-1252; the separator (comma, semicolon or tab) is detected from the first lines; quoted fields may hold separators, quotes and line breaks (RFC 4180).
- **AC-1113**: Nothing leaves the browser until the member starts the import; leaving the page before then asks first, and drops the file.

*Matching columns*
- **AC-1114**: Each column is matched on arrival, with no AI: its header against each attribute's name and API name (ignoring case, spaces, dashes and underscores, and a short synonym list such as "e-mail" for Email addresses, "website" for Domains, "first name" and "last name" for the name's parts), then checked against the type: a column whose sample of up to 50 values mostly fails the attribute's `fromText` is left unmatched rather than matched wrongly.
- **AC-1115**: The match step lists every column: its header, its first three non empty values, and a Select of where it goes: the object's attributes the member may write (system, computed, read only and hidden ones are never offered), the name's First name and Last name parts for a personal name, or **Don't import**. One attribute takes one column; a chosen one is marked "Matched to <header>" and can't be chosen twice. "8 of 11 columns will be imported" sits above the list. Continue needs at least one matched column.
- **AC-1116**: For members who may manage the object's attributes, the Select ends with **New attribute**, which creates one named after the header with the type its values suggest (number, date, email, domain, URL, checkbox, else text) through the attribute service, and matches the column to it (decision 8).

*Matching records*
- **AC-1117**: The member chooses how rows find existing records: by any unique attribute that a column is matched to (Email addresses on People and Domains on Companies are chosen for them), or **Always create new records**.
- **AC-1118**: When a row matches a record: **Fill empty fields** (default), **Overwrite with the file's values**, or **Skip**. When it matches none: **Create a record** (default) or **Skip**. An empty cell never clears a value; an attribute that holds several values adds the file's values it lacks (decision 2).
- **AC-1119**: A row matches only a live record the member can read; a key held by a record they can't read is never revealed: that row is refused as a create would be on the taken value. Rows of one file that share a key act on one record: the first as its rule says, the later ones as matches of it.

*Preview*
- **AC-1120**: Every cell is turned into a value by the field set's `fromText` for its attribute's type (one parser per type for paste, copy and import), in the browser's language and time zone, with members matched by email or name and phones read with the attribute's default country. A row with any cell that can't be read is an error row; its other cells are not imported either.
- **AC-1121**: The preview shows the totals ("4,812 ready, 188 with errors") and, once the rows are staged, the server's split of the ready rows ("4,200 new, 612 match existing records"), then a paged table of the rows (all rows reachable, a page at a time: the library's Table holds every row it is given, so it is never handed all of them) filtered by All, Ready or With errors: row number, the matched columns' values, and on an error row each bad cell's reason. **Download rows with errors** saves them as a CSV with an Error column, to fix and import again.
- **AC-1122**: A select or status column whose labels name no option shows "3 values aren't options of Stage" with **Create 3 options** for members who may manage the attribute; creating them reads the column again (Attio's "Create missing select options").

*Running*
- **AC-1123**: **Start import** confirms once ("Import 4,812 rows into People?"), stages the ready rows in calls of at most 1,000 rows and 1 MB, then starts one `records.import` job on the heavy lane, cancellable, whose items are the staged rows in file order. Retrying a staging call or the start with the same ids changes nothing.
- **AC-1124**: The job works in batches of 100 rows, each one engine transaction: each row takes a transaction lock on its match key, finds its record, then creates or updates it through the engine as the member (the door, field and record rules, validation rules, required and unique checks, the record limit), with value history and one change event per batch, each row in its own savepoint. A refused row records its code and plain reason and the rest carry on.
- **AC-1125**: The import page and the Background jobs page show the progress live (rows done of the total, created, updated, skipped, refused) and offer Cancel, which stops before the next batch and keeps what landed. Leaving the page leaves the job running; its end raises the usual job toast with a link back to the import's summary.
- **AC-1126**: A failed batch is retried with backoff (spec 0008) and resumes after the last committed batch, so no row is written twice. Imports in one workspace never hold up light jobs or other workspaces' jobs past spec 0008's fairness (AC-108).
- **AC-1127**: When the job ends the page shows the summary: created, updated, skipped and refused counts, how long it took, the refused rows with their row numbers and reasons (all of them, paged, and as **Download refused rows**), **View records**, and **Undo import** while undo is open. The summary stays at `/w/$slug/objects/$object/imports/$importId` for the undo window.

*Undo*
- **AC-1128**: **Undo import** (the starter or a holder of `jobs.manage`, within 7 days of the start, once the import has finished or been cancelled) confirms with the counts ("Move 4,200 created people to the trash and put back 612 changed records?"), then runs a `records.import_undo` job: every record the import created goes to the trash with the import's id as its batch (restorable for 30 days), and every value it changed is put back to what it held before, unless it has changed since, in which case it is kept and counted ("38 values changed since, kept").
- **AC-1129**: Undo refuses `IMPORT_UNDO_CLOSED` after the window, `IMPORT_RUNNING` while the import still runs, and answers the undo already started when asked twice. Its progress, cancel rules (it can't be cancelled) and end toast are the job's.

*Export*
- **AC-1130**: The view's More menu holds **Export CSV** for every member who can read the view. It exports the view as it stands: its saved filter and sorts, or the unsaved ones on screen, with its visible columns in their order, the record's name first.
- **AC-1131**: The export runs as a `records.export` job on the heavy lane, cancellable, paging the view by its keyset cursor through the engine's page read as the member, so record rules apply and hidden fields are absent. A toast shows its progress, and when it ends it offers **Download**; the Background jobs page shows it too.
- **AC-1132**: More than 100,000 matching rows is refused before the job starts, with the count ("This view has 240,000 people. Export at most 100,000 at a time; narrow the filter.").
- **AC-1133**: The download is `GET /api/exports/<id>/download?workspace=<slug>`: a signed in member of the workspace who started the export gets the file (`text/csv; charset=utf-8`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, no caching); anyone else gets 404. It is named "<Object> - <View> - <YYYY-MM-DD>.csv", starts with a UTF-8 byte order mark (so Excel reads it), quotes as RFC 4180 and ends lines with CRLF.
- **AC-1134**: Cells are written so the importer reads them back: option labels, a name's full name, members by name, linked records by name, dates as `YYYY-MM-DD`, timestamps in UTC ISO 8601, numbers plain, money as `<CODE> <amount>` (what Currency's `fromText` reads), several values joined by ", ". Any text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so no spreadsheet runs it as a formula; numbers, dates and money are written plain.
- **AC-1135**: An export file is kept 7 days, then deleted by the daily cleanup; a download after that answers 404 with "This export has expired. Export the view again."

*Limits, access and quality*
- **AC-1136**: Every limit lives in the limits module and refuses clearly: rows, columns and bytes per import, 3 unfinished imports per workspace (`LIMIT_REACHED`), 1,000 rows and 1 MB per staging call, 100,000 rows per export, the record limit at each create (a full workspace refuses the rows past it, each with the reason, and the rest of the summary says so).
- **AC-1137**: Every import and export call is on the member door: an import needs write on the object, an export read on the view; an import or export the caller didn't start (and, for imports, without `jobs.manage`) is `NOT_FOUND`, as is one in another workspace.
- **AC-1138**: The server never trusts the browser's reading: a staged value is checked by its type's schema and the attribute's rules when written, a staged row is at most 64 KB and names only attributes of the import's object, and the import's columns and match choice are checked against the object when the import is created.
- **AC-1139**: The new tables (`imports`, `import_rows`, `exports`, `export_chunks`) force row level security with the standard policy, and a cross workspace read returns nothing (the guard tests).
- **AC-1140**: Every write an import or its undo makes goes through the engine, so value history, the audit columns and the change events are written in the same transaction; open tables of the object follow along live (records events per batch, coarse past 200 ids).
- **AC-1141**: Each step and the summary work by keyboard alone in visual order: the Steps bar names the current step, each column's Select is labelled by its header, error cells are named in the row's accessible text, progress is a labelled progress bar, and contrast meets WCAG AA in both themes.
- **AC-1142**: The first load of the web app stays within its 250 kB budget.
- **AC-1143**: A Playwright flow imports a 5,000 row People file end to end (upload, automatic matches, preview, start, progress, summary, undo), and the rows are in the table and in a second browser.
- **AC-1144**: On the local stack, 5,000 rows import in under 2 minutes, and while a 20,000 row import runs, the API's record reads and writes for other members stay within the scale budget's p95 (spec 0011).
- **AC-1145**: An import's staged rows and outcomes are deleted when its undo window closes (a phase of the daily cleanup), and a staged import never started is deleted after 24 hours.
- **AC-1146**: The import page reads and writes only through the data layer (`data.imports`, `data.exports`, `data.jobs`); the summary follows its job live through the jobs store.

## Decision

Build import as a browser side reader plus a server side item job, and export as a cursor job writing chunks to Postgres, all on spec 0008's runner and the engine's existing writes, with the eight recommendations above. See [rationale.md](rationale.md).

## Feature design

### Flow

1. **Upload** (browser): the file is read as bytes, decoded, split into rows by a small RFC 4180 reader in `packages/data/src/imports/csv.ts` (pure, no dependency), and checked against the limits.
2. **Match columns** (browser): `autoMatch(headers, samples, choices, reads)` (pure, in `apps/web/src/features/imports/matching.ts`, beside the field set it samples with) proposes a target per column; the member adjusts.
3. **Match records** (browser): the match attribute and the two rules.
4. **Preview** (browser, then server): every cell through `fieldTypeOf(type).fromText`; error rows set aside. On **Start import**: `imports.create`, then `imports.stage` for each chunk of ready rows (the server answers how many of the chunk's keys match a readable record), then `imports.start`.
5. **Run** (worker): the `records.import` job walks the staged rows.
6. **Summary and undo** (browser, then worker): `imports.get`, `imports.rows`, `imports.undo`.

### Data model

All tenant tables: `workspace_id` first, forced row level security with the standard policy, audit columns (spec 0004). Migration `0044_import_export.sql`.

**`imports`**
- `workspace_id`, `id` (uuid v7 the browser mints; primary key together).
- `object_id` (foreign key to `objects`), `file_name` (1 to 255 characters), `row_count` (the file's data rows), `error_rows` (rows the browser set aside).
- `settings` jsonb: `{ columns: [{ header, target }], matchAttributeId?, onMatch: 'fill' | 'overwrite' | 'skip', onNoMatch: 'create' | 'skip' }`, `target` being `{ attributeId, part?: 'first' | 'last' }` or absent for Don't import.
- `status`: `staging`, `started`, `undone`.
- `job_id`, `undo_job_id` (uuid, nullable; the jobs rows).
- `undo_until` (set at start: now plus 7 days), `created_by_member_id`, `created_at`, `updated_at`.
- Index `(workspace_id, status, created_at)` for the unfinished count and the cleanup.

**`import_rows`**
- `workspace_id`, `import_id`, `row_number` (the file's line, 2 for the first data row; primary key together); `id` (uuid, the job item id; unique with `workspace_id`).
- `values` jsonb: `{ [attributeId]: value }` typed values, or for a relationship attribute `{ names: string[] }`.
- `match_keys` text[]: the row's normalised keys on the match attribute (`uniqueKeyOf`).
- `outcome`: `pending`, `created`, `updated`, `skipped`, `refused`, `undone`; `record_id`; `error_code`, `error_message`.
- `before` jsonb: for an updated row, `{ [attributeId]: { value, versionId } }` as it was; `written` jsonb: `{ [attributeId]: versionId }` the import wrote. Both read by undo.

**`exports`**
- `workspace_id`, `id` (uuid v7 the browser mints), `object_id`, `view_id` (nullable), `query` jsonb (filter, sorts, attribute ids), `file_name`, `job_id`, `row_count`, `byte_count`, `expires_at`, `created_by_member_id`, `created_at`.

**`export_chunks`**
- `workspace_id`, `export_id`, `part` (primary key together), `body` text (at most about 1 MB a chunk).

### Contracts (`packages/contracts/src/imports.ts`, `exports.ts`)

`ImportSettings`, `ImportView`, `StagedRow`, the procedures below, `IMPORT_LIMITS` and the job kinds added to `JOB_KINDS`: `records.import` (heavy, cancellable), `records.import_undo` (heavy, not cancellable), `records.export` (heavy, cancellable). The CSV cell escaping (`csvCell`, `csvLine`) lives in `packages/contracts/src/csv.ts`, shared by the export job and the browser's error file.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `imports.create` | `id`, `objectId`, `fileName`, `rowCount`, `errorRows`, `settings`, `mutationId` | `ImportView` | member, write on the object | `NOT_FOUND`, `FORBIDDEN`, `CONFIG_INVALID` (a column names an attribute that isn't the object's or can't be written, two columns one attribute, a match attribute that isn't unique or isn't matched), `LIMIT_REACHED` |
| `imports.stage` | `importId`, `rows` (1 to 1,000 `{ rowNumber, values }`), `mutationId` | `{ staged, matched }` | the starter, import still `staging` | `NOT_FOUND`, `IMPORT_STARTED`, `CONFIG_INVALID` (row over 64 KB, unknown attribute), `LIMIT_REACHED` (more rows than the file said) |
| `imports.start` | `importId`, `mutationId` | `ImportView` with the job | the starter | `NOT_FOUND`, `IMPORT_STARTED` (answers the job already started on a retry), `CONFIG_INVALID` (nothing staged) |
| `imports.get` | `importId` | `ImportView` (settings, counts by outcome, job ids, `undoUntil`, `canUndo`) | the starter or `jobs.manage` | `NOT_FOUND` |
| `imports.rows` | `importId`, `outcome` (`refused`), `cursor` | a page of `{ rowNumber, code, message }` (200) | the same | `NOT_FOUND` |
| `imports.undo` | `importId`, `mutationId` | `ImportView` with the undo job | the same | `NOT_FOUND`, `IMPORT_RUNNING`, `IMPORT_UNDO_CLOSED` |
| `exports.start` | `id`, `objectId`, `viewId?`, `filter?`, `sorts?`, `attributeIds`, `timeZone`, `mutationId` | `ExportView` | member, read on the object (and the view) | `NOT_FOUND`, `FILTER_INVALID`, `EXPORT_TOO_LARGE`, `LIMIT_REACHED` |
| `exports.get` | `exportId` | `ExportView` (file name, job id, rows, expires) | the starter | `NOT_FOUND` |
| `GET /api/exports/:id/download` | `workspace` | the file | session, member door, the starter | 404 |

### Jobs (`packages/core/src/imports/`, `packages/core/src/exports/`)

- `records.import`, items mode, batch 100, member actor. Params `{ importId }`. A step reads its batch's rows, the import's settings and the object's attributes once, then for each row in its own savepoint: takes `pg_advisory_xact_lock` on `(workspace, attribute, key)` for each match key, finds the live record holding a key (the unique index) and checks it is readable (`visibleRecords`), then creates (`insertRecord`), updates (`updateRecord` with only the values the rule allows, `before` read first), or skips; it stores the row's outcome, record id, `before` and `written` in the same savepoint. A refusal stores its first code and message and the item is `refused`.
- `records.import_undo`, items mode, batch 100, member actor (the undoer), not cancellable. Items: rows `created` or `updated`. A created row's record is trashed with batch id = the import id (`deleteRecordsIn`, the engine's delete inside the write); an updated row's attributes are set back with `ifVersionId` = what the import wrote, attribute by attribute, a `VERSION_CHANGED` counted as kept. Rows become `undone`.
- `records.export`, cursor mode, member actor. The checkpoint is the page cursor and the next chunk number. A step reads up to 5 pages of 200 through `readPage` (the member's scope, so rules apply), turns them into CSV lines (`exportCell` per type, then `csvCell`), and appends one `export_chunks` row. The first step writes the header line; the last sets `row_count` and `byte_count`.

### Client (`packages/data/src/imports/`)

- `csv.ts`: decode (UTF-8 with Windows-1252 fallback), detect the separator, read rows (RFC 4180), with the limits checked as it reads.
- `stage.ts`: the staging chunks (1,000 rows and `TRANSFER_LIMITS.stageBytes` each).
- Matching (`autoMatch`, the synonyms, the sampled `fromText` check) and reading rows (`readRows`: each cell through the field set's `fromText`, the name parts joined) live in `apps/web/src/features/imports/` (`matching.ts`, `rows.ts`), since `fieldTypeOf` is in `@crm/ui`, which the data layer never imports.
- `data.imports`: `create`, `stage(importId, rows)` (chunks of 1,000, in order, each retried once on a network failure), `start`, `get`, `rows`, `undo`; `data.exports`: `start`, `get`, `downloadUrl(workspace, exportId)`. Both are thin calls; the import page follows its jobs through `data.jobs`.

### Screens (`apps/web/src/features/imports/`)

- `ImportScreen.tsx` (lazy, route `w.$slug.objects.$object_.import.tsx`): the Steps bar; Upload (FileDrop), Match columns (a Table of columns with a Select each and samples), Match records (a Select of the match attribute and two RadioGroups), Preview (totals, the SegmentedControl filter, a paged Table of rows with Pagination), then the progress Card (ProgressBar, counts, Cancel).
- `ImportSummary.tsx` (route `w.$slug.objects.$object_.imports.$importId.tsx`): the counts, the refused rows Table, Download refused rows, View records, Undo import with its confirm Modal, the undo's progress.
- The view's More menu gains Import CSV and Export CSV; the export's progress and Download ride the toast.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Auto match | target per column | header text against attribute `name` and `apiSlug`, then `fromText` over a sample |
| Preview split | new and matching counts | `imports.stage` answers: keys found on live readable records |
| Row values | typed values | the field set's `fromText` in the browser; checked again by the engine |
| Match | record id | `values.unique_key` on the match attribute, live, readable |
| Undo values | the old value | `import_rows.before`, guarded by `written` versions |
| Export cells | text | `exportCell` (contracts) over the engine's page read |
| Export columns | names and order | the view's visible columns, record name first |
| Download name | file name | object plural name, view name, the export's date |

### Key invariants

- No write skips the engine: imports and undo write only through `insertRecord`, `updateRecord` and the trash's delete, as the member.
- A match never names a record the member can't read; an export never holds a value the member can't read.
- A row is written at most once: its outcome is stored in the same savepoint as its write, and the job resumes after committed batches.
- An empty cell never clears a value.
- Only the starter (and `jobs.manage` for imports) sees an import or export.

### Security model

Imports need write on the object and run as the member, so every rule of spec 0009 and 0013 applies to each row. Staged data is validated on write, not on staging. Export cells are escaped against formula injection; the download checks the session, the door and the starter, sends `attachment` and `nosniff`, and names the file from sanitised names (letters, digits, spaces, dots, dashes and underscores). File type and size are checked in the browser before reading, and the server's own limits (rows per call, bytes per row, rows per import) hold whatever the browser sends.

### Critical test scenarios

- Happy path: 5,000 people with names, emails, a select and a phone, auto matched, previewed, imported, visible in a second browser; verifies **AC-1114**, **AC-1120**, **AC-1123** to **AC-1127**, **AC-1143**.
- Matching: a second import of the same file with a changed column fills only empty fields; with Overwrite replaces; with Skip changes nothing; duplicate emails in one file make one record; verifies **AC-1117** to **AC-1119**.
- Access: a member who can't read a matching record gets the row refused without its name; a read only field isn't offered; a member who may only read the object gets no Import CSV; verifies **AC-1119**, **AC-1137**.
- Undo: undo after a value was edited since keeps that value; records go to the trash and restore from it; verifies **AC-1128**, **AC-1129**.
- Cancel and resume: cancel at half; a batch made to fail once is retried and no row is doubled; verifies **AC-1125**, **AC-1126**.
- Export: a filtered view with a hidden field and a record rule exports only what the member sees; `=1+1` comes out as `'=1+1`; another member's download is 404; verifies **AC-1130** to **AC-1135**.
- Limits and guards: 100,001 rows, 251 columns, a 51 MB file, the fourth unfinished import, a 1,001 row staging call; RLS on the four tables; verifies **AC-1112**, **AC-1136**, **AC-1139**.

## Build plan

**Milestone 1: import end to end** (one thread through every layer)
1. Migration with the four tables, guard tests, limits, contracts, satisfies **AC-1136**, **AC-1139**.
2. Core: create, stage (match keys and the matched count), start, get, rows; the `records.import` kind, satisfies **AC-1117** to **AC-1119**, **AC-1123** to **AC-1126**, **AC-1138**, **AC-1140**.
3. API module and data layer, satisfies **AC-1137**, **AC-1146**.
4. Browser reader and matcher with unit tests, satisfies **AC-1112**, **AC-1114**, **AC-1120**.
5. Screens: Import CSV, the four steps, progress, summary; `pnpm size`, satisfies **AC-1111**, **AC-1113**, **AC-1115**, **AC-1121**, **AC-1127**, **AC-1141**, **AC-1142**.

**Milestone 2: undo**
6. `records.import_undo`, `imports.undo`, the summary's Undo, satisfies **AC-1128**, **AC-1129**.

**Milestone 3: export**
7. `records.export`, the download route, `exportCell`, the menu item and toast, satisfies **AC-1130** to **AC-1135**.

**Milestone 4: proof and cleanup**
8. Playwright flow at 5,000 rows, the scale check, the daily cleanup phase, satisfies **AC-1143** to **AC-1145**.

**Milestone 5: the remainders**
9. Relation columns (decision 7), Create missing options, New attribute, satisfies **AC-1116**, **AC-1122**.

## Consequences

**Positive**:
- One parser per type for paste and import; the server stays a validator.
- Undo is exact: the import knows every record it made and every value it changed.
- No new infrastructure: spec 0008's runner, the engine's writes, Postgres for files until R2.

**Negative / tradeoffs**:
- Staged rows and export files sit in Postgres for up to 7 days, which counts against the database's size (bounded by the limits and the cleanup).
- A very large file is read in the browser's memory (50 MB at most).
- Undo can't restore a value someone changed after the import; it says how many it kept.

**Neutral**:
- Excel files and exports past 100,000 rows wait for #32.

## Follow-up

- [ ] `.xlsx` import and export once a parser is chosen (#32 for storage).
- [ ] Exports past 100,000 rows on R2.
- [ ] Duplicate hints in the preview once #31 lands.
- [ ] Import into a list (entries with their own values).
- [ ] An Imports history page if members ask for one; until then each import's summary has its own address and its job is on the Background jobs page.

## Rationale

See [rationale.md](rationale.md).
