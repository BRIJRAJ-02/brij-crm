# 0049. Duplicate warning and record merge: rationale

## Context

Duplicates are the most common data quality complaint in any CRM. People arrive from the app, imports, forms, booking and calendar sync, and the same person or company gets entered twice. Today Email addresses on People and Domains on Companies are unique, so an exact second email is refused, but two "Jane Doe" records at Acme, or a person entered once with each of two emails, slip through, and nothing lets a member join them afterwards. Scope feature #31 asks for suggestions with a reason, a merge that loses nothing, a remembered "not a duplicate", and imports that avoid new duplicates.

The forces:

- **Scale budget**: a million records per workspace, so pairs must come from indexed lookups, never a full scan per request.
- **Hidden means absent**: a duplicate hint must never reveal a record or value the reader cannot see.
- **One write path**: a merge must write history, audit and change events like any edit, so it goes through the engine.
- **Owner preferences**: default and act, few steps, no blocking dialogs, and confirm before ending actions.
- Many tables point at a record (values, links, list entries, notes, comments, files, tasks, meetings, attendees, form submissions, bookings, notifications, routing assignments), several with uniqueness that collides when two records' rows meet.

## Options considered

**Option 1: exact match keys at read time, side by side merge, remembered dismissals (chosen).** An immutable normalising function feeds two partial expression indexes, so a check or a page of pairs is an index lookup. The merge runs in one engine transaction.
- Pros: clear reasons, no false alarms, no stored derived pairs to go stale, live with every write.
- Cons: misses near spellings; two more indexes on values.

**Option 2: a background job computing a pairs table.** A nightly or event driven job stores scored pairs.
- Pros: room for fuzzy scoring; the review page is a plain table read.
- Cons: stored derived data goes stale between runs; a job per workspace; the add warning still needs a live check anyway.

**Option 3: fuzzy matching with trigram similarity.** Use `pg_trgm` through `crm_search_similar` for names.
- Pros: catches "Jon" and "John", "Acme" and "Acme Corp".
- Cons: false alarms the owner wants to avoid; similarity across pairs at a million records is expensive.

**Merge sub choices**: a side by side picker (chosen by the owner) against "keep the primary, fill blanks". Undo against no undo: no undo was chosen, because reversing moved rows needs a full merge log. The dialog states the outcome plainly, which is the confirm the house rule asks for before an ending action. Unmerge is a follow-up.

## Rationale

The owner chose, on 31 October 2026: an inline hint that never blocks saving, exact email, domain or name matching, a side by side picker, and coverage across a review page, imports, a record page banner and every object.

Exact keys checked at read time fit the scale budget and the "never compute and store derived values" rule, and they give a reason a member trusts. The warning names an email's holder only to a reader who may see it, which keeps spec 0040's rule that a refused key never reveals a hidden record. The merge goes through the engine so value history, audit entries and change events need no new path. Trashing the merged record with a pointer, instead of deleting it, keeps its history readable from the kept record and lets old links and bookmarks redirect.

The 10,000 item cap keeps a merge inside one request's time. A background job is the runner up for very large records, left as a follow-up because such records are rare.

## References

**Project sources**

- Spec 0040 (import, AC-1117 to AC-1119 and its "#31 duplicates" row), spec 0022 (trash and purge), spec 0014 (relationships), spec 0059 (company filing by domain)
- `packages/db/src/schema/records.ts` (values, record_links, list_entries and their unique indexes), `packages/core/src/engine/purge-dependents.ts` (the tables that point at a record)
- Scope feature #31, `docs/scope/data-in-out.md`
