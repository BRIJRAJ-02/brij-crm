# Imports

Spec 0040, milestones 1 to 4. A CSV into any live object, through the browser's reader and the `records.import` job.

## The import page (`/w/$slug/objects/$object/import`, ImportScreen)

- **Purpose**: bring a spreadsheet of records into one object, seeing what each row will do before anything changes.
- **Main task**: choose a CSV, check where its columns go and how rows find records, read the preview, then start.
- **Leaves out**: relation columns, creating options or attributes from the file (milestone 5), and other file types.

## An import's summary (`/w/$slug/objects/$object/imports/$importId`, ImportSummary)

- **Purpose**: one import's page: its progress while it runs, then what it did, kept for its 7 day undo window.
- **Main task**: see how many rows were created, updated, skipped and refused, and why; undo the import if it was wrong.
- **Leaves out**: editing the import's settings, running it again, and the imported records themselves (View records).

## Notes

- The view's More menu holds Import CSV for members who may write the object (`object.access`). Both pages load in their routes' own chunks, with the CSV reader (`@crm/data/imports`), outside the first load.
- Four steps in a Steps bar: Upload (FileDrop; the reader refuses by type, size, rows, columns, an empty file or an unclosed quote, each with what to do), Match columns (a Table of columns, three sample values and a Select each), Match records (the unique attribute rows find records by, Email addresses on People and Domains on Companies by default, then the two rules) and Preview (totals, All, Ready or With errors, a paged Table, Download rows with errors).
- `matching.ts` proposes each column's attribute by header, API name and a short synonym list, then keeps it only when half or more of a 50 value sample reads as the type. One attribute takes one column, and a name whole never sits beside its parts.
- `rows.ts` reads every cell through the field set's `fromText` (the parser paste uses), in the browser's language and time zone, with members by email or name and phones through the phone library. Empty cells are left out, so they never clear a value. A row with a cell that can't be read is an error row, and none of its cells import.
- Start import confirms, then makes the import, sends its ready rows in chunks (`data.imports.stage`, a progress bar with Stop, which asks first), starts its job and opens the summary. Leaving before then asks first and drops the file.
- The summary follows the job live (`useJob`): progress with Cancel (asks first), then the counts, the refused rows paged with Show more and Download refused rows, View records, and Undo import (a danger confirm) while undo is open: the `records.import_undo` job moves the created records to the trash (the import's id their batch) and puts changed values back, keeping any edited since ("1 value changed since, kept." on its row). The jobs' end toasts link here.
- `e2e/import.flow.ts` runs the whole loop (5,000 rows at 1280 by default, 300 at phone width; CI runs 1,000 to stay in its time), with axe in light and dark at each step.
- The lean pass: the title sits in the bar ("Import people", "Import of people.csv"), the Steps bar names each step, cards keep short copy, and an InfoTip explains the parts that confuse: how rows find records (Match records), what the Row numbers mean (Preview), and Not imported against Left out for errors, with what undo does (summary). Counts of none are left out.
- Leaving with a file loaded, or while rows send, asks in a danger Modal (the router's blocker with its resolver); closing the tab asks the browser's way. Focus goes to the page title at each step, since the pressed button's Card goes.
- Rows are read a slice of 2,000 at a time on the way to the preview (a progress bar on Match records), once per file and set of targets.
- The Background jobs page links an import's job to its summary (View import) and a finished export to its file (Download), from the job's result (`importId`, `exportId`).
- Export CSV (the view's More menu, every member who can read it) starts a `records.export` job with the view as it stands; its end toast offers Download.
