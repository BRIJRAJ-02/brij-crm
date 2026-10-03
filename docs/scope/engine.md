# Data engine

The core loop and everything that makes the data model flexible: objects, attributes, relations, computed attributes, layouts and lists. See [index.md](index.md) for the house rules and the full order.

## Slice 1: Core loop (the walking skeleton)

### 10. Core loop · in-progress · GA
The thinnest real thread through every layer: sign up, get a workspace, open People, add one attribute, create and edit records in a table, and watch each change arrive on a second screen. Nothing else yet, and already built only from tokens, library components and the client data layer.
**Done when:** a new user signs up with a verified email or Google, lands in their own workspace, creates and edits People records, and a second browser sees every change within a second; every write records who and when; it runs in production.
- [x] Design it (spec): `/architect core loop`
- [ ] Build it: `/develop core loop`
   - [ ] Signed in, in production, on an empty People page: errors, the edge guard, Better Auth by email code, the access door, the workspace bootstrap, the sign in library modules and the first routes (AC-27, AC-29 to AC-33, AC-41)
   - [ ] The People table: the store prototype gate, the record and attribute procedures, the data layer's windows and optimistic writes, and the screen with its two dialogs (AC-34 to AC-37, AC-40, AC-41)
   - [ ] Live: the outbox, the relay, Centrifugo channels and tokens, and the browser subscription, proven with two browsers in production (AC-38, AC-39, AC-41)
   - [ ] Finish and harden: Google sign in, session expiry, the keyboard, focus and contrast passes, and the full Playwright flow (AC-28, AC-31, AC-41)
- [ ] Verify it: `/check verify core loop`
- [ ] Test it: `/test core loop`
- [ ] Review it (fresh model): `/check review core loop`
- [ ] Document it: `/document core loop`
Spec [0005](../specs/0005-core-loop/index.md) · code in `apps/web/`, `apps/api/`, `packages/core/`, `packages/data/`, `packages/db/`, `packages/ui/`

## Slice 2: Objects and attributes

### 13. Objects and attributes · needs a decision
Let a workspace shape its own data: create custom objects and give any object attributes of any type, with the standard objects editable in exactly the same way.
**Done when:** an admin creates an object; adds attributes of every type (text, long text, number, currency, date, checkbox, select, multi select, status, rating, email, phone, link, location, member); marks one required or unique or gives it a default; renames, reorders, archives and restores both objects and attributes; each type renders through its one shared field design; everyone's table updates live; the object count goes through one central limits check.
- [ ] Design it (spec): `/architect objects and attributes`

### 14. Validation and type changes · needs a decision
Keep data clean and let the model evolve: rules on what a value may be, and safe changes to an attribute's type after records exist.
**Done when:** an admin sets format, min and max, or "required once status is X" rules, and a save that breaks one is refused with the reason; an attribute's type changes (for example text to select) on a million records in the background, with a preview of the values that will not convert, and nothing is lost.
- [ ] Design it (spec): `/architect validation and type changes`

## Slice 3: Relations

### 15. Relations
Connect records across objects (a person works at a company, a deal has many people), in any direction and any shape.
**Done when:** an admin adds a relationship between any two objects, or an object and itself, as one to one, one to many or many to many, and each side gets its own named attribute (for example Company · People and Person · Company); setting a link from either side updates the other in the same save, live for everyone; cardinality is enforced on both sides; deleting a record removes its links but never the records on the other side; a table can show, filter and sort by related records and by their attributes.
- [ ] Build it: `/develop relations`

### 56. Schema map · needs a decision
A visual map of the workspace's data model: every object as a card listing its attributes, and a line for every relationship between them, so anyone can see how People, Companies, Deals and custom objects connect.
**Done when:** the map shows every object the viewer may see, with its attributes grouped by type, and draws each relationship as a line labelled with both attribute names and the cardinality; clicking an object opens its settings and clicking a line opens the relationship; an admin can create a relationship by drawing a line between two objects; the map updates live as the model changes and stays readable with 50 objects.
- [ ] Design it (spec): `/architect schema map`

### 16. Computed attributes · needs a decision
Attributes that work themselves out: formulas on a record, rollups across relations (total deal value on a company), and lookups (the industry of a person's company).
**Done when:** an admin creates a formula, rollup or lookup attribute; it updates live when its inputs change, including through relations; it can be filtered, sorted and shown like any other attribute; recomputing across a million records stays inside the scale budget.
- [ ] Design it (spec): `/architect computed attributes`

## Slice 4: Record page and activity

### 18. Attribute groups and layouts
Organise attributes into sections (Contact info, Financials) and choose what each object's record page shows.
**Done when:** an admin groups and orders attributes into sections per object; the record page, create form and settings follow the grouping; attributes hidden from the page stay available in tables and filters.
- [ ] Build it: `/develop attribute groups and layouts`

## Slice 17: Lists and pipelines

### 51. Lists and pipelines · needs a decision
Collections of records with fields of their own, such as a hiring pipeline over People or a partner list over Companies.
**Done when:** a member creates a list over any object, adds records one by one or in bulk, and gives the list its own fields (like stage); one record can sit in many lists; each list has table and board views.
- [ ] Design it (spec): `/architect lists and pipelines`
