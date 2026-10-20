# 0036. Command menu (⌘K) and global search: rationale

## Context

The library already has a `CommandPalette` module (spec 0003), a palette `Modal` that opens instantly from the keyboard, and an inline searchable `Menu` built on React Aria's Autocomplete. The app doesn't use any of them yet. The record picker (spec 0014) already searches one object's records through the access door. It uses three paths: recent with nothing typed, a bounded `sort_keys` range for one or two characters, and `crm_search_text` (the one `security definer` function, spec 0004 AC-24) for contains. Nothing searches across objects, views or pages.

Forces:
- **Hidden means absent** (spec 0009, spec 0032 AC-854): the command menu is named as a surface where a hidden object, field or record must never show.
- **Row level security stops Postgres using operators that aren't leakproof as index conditions.** That is why contains already goes through a definer function, and typo matching (`<%`) has the same problem.
- **The first load is at its 250 kB budget** (measured at 250.9 kB on 9b1edcf3, just over), so the menu must load apart.
- **Opening from the keyboard is instant** (the design system's motion rules).
- **Postgres search first** (roadmap decision, 20 October 2026); an engine only if the million record test misses.
- **Every setting lives in Settings** (owner rule).

## Options considered

### Option 1: Postgres search behind one procedure, a library palette with sections, a lazy chunk (chosen)

`search.query` answers records and views in at most 5 statements, whatever the number of objects: prefixes over `sort_keys`, contains through `crm_search_text` for every searched attribute in one `unnest … lateral` statement, typos through a second definer function, and the door applied in the ranking statement. Pages and actions are matched in the browser.

**Pros**: no new service; access is enforced in the same statement that ranks; a new record is findable as soon as it commits; it reuses the picker's tested paths.
**Cons**: one more definer function; typo matching is limited to names and to a time budget.

### Option 2: a search engine (Typesense or Meilisearch) fed from the outbox

**Pros**: typo tolerance and ranking for free; fast on any text.
**Cons**: a new stateful service to run, back up and secure; the access door would have to be copied into the engine's filters, or results post filtered (which leaks counts and timing); indexing lag breaks "findable within seconds" under load; the roadmap defers it until Postgres misses its budget.

### Option 3: the client fans out `records.search` per object

**Pros**: no new server code.
**Cons**: one request per object per keystroke, each needing its own read gate slot (6 per workspace), and no ranking across objects.

### Option 4: a `tsvector` column per record

**Pros**: word stemming and ranking.
**Cons**: names and emails aren't prose, so stemming doesn't help; it means a new column kept in step on every write and a backfill of a million rows; and it gives no typo tolerance.

## Rationale

Option 1 meets the access rule without copying it anywhere, and it reuses the two search paths the picker already measured at a million records. The cost of typo tolerance is one more definer function. It is built exactly like the first: a standard SQL body, a fixed `search_path`, owned by `crm_search`, returning ids only, and listed in the guard test. That keeps the hole as narrow as the one already accepted.

Calls made without a question, each with its runner up:
- **The 1 to 2 character path reads names only, by prefix** (runner up: contains), because a trigram needs 3 characters, and two letters contained anywhere match nearly everything.
- **The typo step runs only under 20 exact hits and from 4 characters** (runner up: always), because similarity over common words is the costly query, and exact matches are what people usually want.
- **Threshold 0.5 for word similarity** (runner up: pg_trgm's 0.6 default), so one wrong letter in a 5 to 8 letter word still matches.
- **20 records and 8 views at most** (runner up: paged results), because the menu is for jumping, not browsing; the object's table is for browsing.
- **Recents keep 20 per member, show 6** (runner up: show 10), as Linear and Raycast show a short list.
- **A visit is recorded by the page, not by the read** (runner up: inside `records.one`), because a function named like a read must never write (crm-data-model-access rule 7).
- **The menu prefetches its chunk on idle** (runner up: on hover of the Quick actions row only), so the first ⌘K is instant without growing the first load.
- **`/` doesn't open the menu inside a text field** (runner up: always), because people type slashes into fields.

## Evidence

- **Attio** (Mobbin, web): Quick actions with ⌘K and a separate search button on `/` at the top of the sidebar. Its "Choose record" palette has rows with a logo, the name, the domain in grey and the object as a tag at the end, a "Records" heading, and a footer naming ↑↓ Navigate and the action key. This is the model for the record row and the footer.
- **Linear** (Mobbin, web): search with results in one list, each row with its kind at the start ("Project", "Initiative", an issue key) and the matched word in bold, filter tabs (All, Issues, Projects, Documents), and a relative time at the end. Its menus group commands under headings. This is the model for mixing kinds in one list and for the match highlight (follow-up).
- **Vercel** (Mobbin, web): "Find…" (F) in the sidebar opens a dropdown where each row is the name with its kind or scope underneath ("Project", the team's name), and a fallback row hands the query to an assistant. This is the model for the second line.
- **Raycast style palettes** (Mobbin, Gumloop and Replit as the nearest captured examples): one field reading "Type a command or search…", actions first, then sections of results under quiet headings, and shortcuts at the end of each row. This is the model for the empty state (Recent, Actions, Go to) and for sections.

## References

**Project sources**: spec 0003 (CommandPalette, Modal palette variant, motion rules), spec 0004 and `0004-stored-sort-keys.md` (sort keys, `crm_search_text`, the scale seed), spec 0009 and spec 0032 (the door, AC-854), spec 0014 (the record picker's search), spec 0020 (views and `seesView`), spec 0026 (Settings pages), spec 0034 (AC-923, Quick actions and search in the sidebar), `docs/scope/data-in-out.md` (#33), `docs/plan/roadmap-2026-10-20.md`.

**Practices**: the WAI-ARIA combobox pattern with a listbox or menu popup; `pg_trgm` word similarity (`<%`, `word_similarity_threshold`) and GIN `gin_trgm_ops`; leakproof operators under row level security.
