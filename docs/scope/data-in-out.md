# Data in and out

Getting data in, keeping it clean, finding it, and getting it out again: import, export, merge, files, search, the public API, webhooks and backups. See [index.md](index.md) for the house rules and the full order.

## Slice 8: Data in and out

### 30. Import and export · needs a decision
Bring data in from CSV and Excel, and take any view out again.
**Done when:** a member maps columns to attributes or creates new ones inline, previews how each value will be stored, and matches existing records on a unique attribute (filling blanks, never erasing); relation columns link to existing records; 100,000 rows import in the background with progress; an import can be undone; any view exports to CSV or Excel with access rules applied.
- [ ] Design it (spec): `/architect import and export`

### 31. Duplicate detection and merge · needs a decision
Find records that are the same person or company, and merge them without losing anything.
**Done when:** likely duplicates are suggested with the reason; a merge keeps every value, link, note, task, comment and history entry from both records; a "not a duplicate" answer is remembered; imports and email sync avoid creating new duplicates.
- [ ] Design it (spec): `/architect duplicate detection and merge`

### 32. File attachments · needs a decision
Keep files with the records they belong to.
**Done when:** a member uploads files onto any record or into a file attribute; images and PDFs preview; every download checks access; storage used goes through the central limits check.
- [ ] Design it (spec): `/architect file attachments`

### 33. Global search · needs a decision
Find anything from one box, and jump anywhere from a command menu.
**Done when:** search covers every object's records, text attributes, notes and comments; results respect access; results appear while you type at a million records; a new record is findable within seconds.
- [ ] Design it (spec): `/architect global search`

## Slice 9: Developer platform

### 34. Public API and keys · needs a decision · GA
A documented API over the whole engine, so customers can build on their CRM.
**Done when:** an admin creates a scoped workspace key that is shown once and stored hashed; generic endpoints cover objects, attributes, records, relations, lists, notes, tasks and comments; every call goes through the same access door as the screens; calls are rate limited by plan; reference docs are published.
- [ ] Design it (spec): `/architect public API and keys`

### 35. Webhooks · needs a decision
Tell other systems when something changes.
**Done when:** an admin subscribes a URL to record, relation, note and comment events; deliveries are signed, retried with backoff and logged; an endpoint that keeps failing is paused and the admin is told.
- [ ] Design it (spec): `/architect webhooks`

## Slice 10: Trust and launch

### 37. Backups and full export · needs a decision · GA
Recover from mistakes or outages, and let customers take all their data whenever they want.
**Done when:** the database can be restored to any point within the retention window the spec sets, and a restore has been rehearsed end to end; an owner downloads a full workspace export (every object, record, relation, note, comment and file) as a background job.
- [ ] Design it (spec): `/architect backups and full export`
