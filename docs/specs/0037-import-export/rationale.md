# 0037. Import and export: rationale

## Context

Release 1 is done when a Playwright flow imports 5,000 rows, among other things (`docs/plan/roadmap-2026-10-20.md`). Scope #30 asks for more: columns mapped to attributes (or new ones made inline), a preview of how each value will be stored, matching on a unique attribute that fills blanks and never erases, relation columns linking existing records, 100,000 rows in the background with progress, undo, and any view out as CSV with access rules applied.

What exists: spec 0008's job runner (item and cursor kinds, slices, leases, retries with backoff, cancel, progress events at most once a second, fairness between workspaces, the Background jobs page and its toast), the engine's writes (`insertRecord`, `updateRecord`) that already carry value history, validation rules, the unique index, the record limit and the outbox, the door (`checkObject`, field and record rules), the trash with batch ids (spec 0022), saved views with a keyset page read (spec 0020), and the field set's `toText` and `fromText` per type, which paste already uses. There is no file storage yet (R2 arrives with #32), the request body limit is 1 MB, and production runs on Neon's free plan, which the owner keeps.

Forces: one parser per type; every write through the one service layer and the door; slow work in jobs; hidden means absent in exports too; the 250 kB first load (it is about 246 kB today); WCAG AA; the Neon plan's size.

## Options considered

### Option 1: read in the browser, stage typed rows, write in an item job (chosen)

The browser reads the CSV, the field set turns each cell into a typed value, the ready rows are staged in Postgres in chunks, and a `records.import` item job writes them through the engine.

**Pros**: one parser per type, already tested for paste; an instant, complete preview with per row errors before anything is sent; no file storage; the server validates every value again as it writes, so a tampered browser gains nothing; item jobs give a known total, per item outcomes and resumption for free.
**Cons**: the file is read in the browser's memory (bounded at 50 MB); staged rows take database space for the undo window.

### Option 2: upload the file, parse in the worker

**Pros**: the browser does little; a very large file never sits in a tab.
**Cons**: needs R2 first; needs the text rules again on the server (members, phones, locale dates), so one type would be parsed in two places; the preview needs a round trip per change of mapping.

### Option 3: write rows inline from the browser in batches (`records.setValuesBatch` style)

**Pros**: no job; simple.
**Cons**: stops when the tab closes; no fairness, cancel or progress for others to see; hits the API's per request limits; can't undo as one unit. The house rule says imports are jobs.

### Export: Option A, a cursor job writing chunks to Postgres (chosen); Option B, a CSV built in the browser from the record store; Option C, a streamed response built per request

A builds the file as the member through the engine's page read in the background, which is the house rule for slow work, keeps the file for a download link, and needs no storage service; it costs database space for 7 days, bounded at 100,000 rows. B can't reach rows the tab hasn't loaded and would hold a whole object in memory. C ties a request up for a minute on a big view and can't be resumed or cancelled.

## Rationale

Option 1 is the only one that keeps one parser per type and still validates on the server, and it needs nothing that doesn't exist yet. The item job maps exactly onto an import: each staged row is an item with its own outcome, the total is known for the progress bar, a retry resumes after the last committed batch, and the runner's slices keep imports fair between workspaces. Storing each row's outcome, its record, the values it replaced and the versions it wrote in the same savepoint as the write makes undo exact and makes a replayed batch harmless. Export as a cursor job is the same machinery the other way round.

Calls made without a question, each with its runner up:
- Batches of 100 rows (runner up: 500): a batch is one transaction holding row locks and unique keys; 100 keeps it under a second, so a cancel and other workspaces wait little.
- An error row is left out whole (runner up: import its readable cells): a half imported person is harder to find and fix than a row in the error file. The server's own refusals work the same way.
- The match key is locked per row with a transaction advisory lock (runner up: rely on the unique index alone): two imports of one email at the same moment then meet in order, and the second updates instead of being refused.
- A match must be readable (runner up: match any record and refuse at the write): a member must never learn a hidden record exists from a preview count.
- Undo keeps values changed since (runner up: put everything back): it never destroys a teammate's later work, and says how many it kept.
- Export cells escape formulas with a leading apostrophe on text only (runner up: escape every cell): numbers and dates stay numbers in a spreadsheet, and a typed number can't hold a formula.
- A UTF-8 byte order mark on exports (runner up: none): Excel otherwise reads accented names wrongly; other tools ignore it.
- The import screen is a full page under the object, not a modal (runner up: a large modal, as Calendly's): the owner's full width rule, room for 250 columns, and an address for the summary.

## Evidence

- **Attio** (Mobbin, web, "Importing a CSV", "Resolving issues (import)", "Creating missing options"): four steps in a bar (Upload file, Map columns, Review values, Preview import); each file column on a row with an arrow to a "Select attribute" picker and a data preview of the column's values beside it; a review step grouping values that need attention, with "Create 3 missing select options"; a preview with "3 will be created, 0 will be updated" and a confirm "Start import"; Import / Export on the table's header with "Export view as CSV", "Export view as Excel" and "Import CSV". The model for our steps, the column list, Create missing options and where the actions sit.
- **HubSpot** (Mobbin, web, "Importing a file"): Type, Upload, Map, Details steps; a mapping table with Column header, Preview information, Mapped, Import as and Property, a "Don't overwrite" choice per column under Manage existing values, "0 errors found, of 3 rows scanned", "You have 2 unmapped columns" with "Don't import data in unmapped columns"; a summary with Import rows, New records, Updated records and "Import completed with no errors". The model for the overwrite choice, the error count before import and the summary.
- **folk** (Mobbin, web): a full screen "Add contacts to folk" table with All, Valid and Invalid counts as filters, and an "Import finished, 16 contacts imported" notice afterwards. The model for the preview's All, Ready and With errors filter.
- **Notion** (Mobbin, web, "Importing a CSV file"): one upload step, then "Map CSV headers", creating a database or merging into an existing one; a CSV becomes a table at once. Shows how little a simple import needs to ask.
- **Calendly** (Mobbin, web, contacts import, found instead of folk's mapping step): "Match your data to a column", a checkbox per CSV column, the field picker marking fields "Already selected", "Add a custom field" in the picker, and "10 / 11 columns will be imported". The model for one attribute per column, New attribute in the picker, and the count line.

## References

**Project sources**: scope #30 (`docs/scope/data-in-out.md`), the roadmap's Release 1 line, spec 0003 (the field set's text conversion), spec 0004 (engine, unique keys, limits), spec 0008 (jobs, fairness, the daily cleanup), spec 0009 (the door), spec 0013 (validation rules), spec 0020 (views, the page read), spec 0022 (trash batches, bulk jobs).

**Practices**: RFC 4180 (CSV); OWASP "CSV Injection"; idempotent job steps with outcomes stored beside the write; WAI-ARIA progressbar.
