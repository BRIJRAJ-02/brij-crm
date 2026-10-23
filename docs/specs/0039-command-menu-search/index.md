# 0039. Command menu (⌘K) and global search

**Date**: 2026-10-20
**Status**: Proposed
**Numbering**: handed out by the coordinator on 20 October 2026 as 0036, renumbered 0039 on 21 October 2026 (0036 went to sign in and first run) (roadmap, Release 1, "Command menu (⌘K) over records, views and pages"; scope feature #33). This spec owns AC-1071 to AC-1110.

## Owner decisions needed

The owner accepted every recommendation below on 21 October 2026; each is now a decision.

Each has a recommendation, which the build follows unless the owner says otherwise, and a runner up.

1. **One menu or two.** *Recommended*: one menu. ⌘K opens it with actions, pages and search together (Linear, Raycast and Vercel work this way), and `/` opens the same menu in search mode, which leaves the actions out (spec 0034, AC-923). *Runner up*: Attio's two surfaces, Quick actions on ⌘K and a separate search on `/`, which means two components, and people have to learn which one holds what.
2. **Typo tolerance.** *Recommended*: Postgres `pg_trgm` word similarity, used only when the exact "contains" search finds fewer than a screenful, only for 4 or more characters, and only on each object's name. It reads through a second search function owned by `crm_search`, built the same way as `crm_search_text`. *Runner up*: contains only. That needs no new `security definer` function, but "acmee" then finds nothing. A search engine (Typesense, Meilisearch) waits, as the roadmap says: Postgres first, and an engine only if the million record test misses its budget.
3. **What a record search matches.** *Recommended*: each object's name, plus its email and domain attributes, at most 3 attributes per object. This is the record picker's set (spec 0014), and each of those attributes already has a trigram index. *Runner up*: every text attribute. That brings more noise and more statements per keystroke, and it can wait for evidence that people need it.
4. **Notes and comments.** *Recommended*: they wait for a later milestone of #33. Notes have no table yet and comments don't exist, so release 1 searches records, views, pages, settings pages and actions. *Runner up*: hold the menu until notes land.
5. **Recent items.** *Recommended*: stored on the server for each member (`member_recents`, the 20 newest, records and views), and read through the access door every time the menu opens, so a recent item the member can no longer see simply drops out. *Runner up*: browser storage of ids. That's lost on a new device, and the ids would still need a server read to get names and check access.
6. **How results are grouped.** *Recommended*: sections by kind (Recent, Records, Views, Pages, Settings, Actions), with each record row naming its object at the end ("Company"), as Attio does. Typed text orders the sections by their best match, kind order breaking ties (QA, 23 October 2026: see `verify.md`). *Runner up*: one section per object, as Linear's tabs do. That is long and mostly empty when one object matches.
7. **Theme in the menu.** *Recommended*: three actions, "Use light theme", "Use dark theme" and "Use system theme", which change the same saved choice as Settings › Preferences. The setting still lives in Settings; the menu is only a quicker way to reach it, as Linear's is. *Runner up*: only a "Go to Preferences" row, which keeps a strict reading of "every setting lives in Settings".

## Summary

⌘K (Ctrl+K elsewhere) opens a command menu from anywhere in a workspace, instantly and with no animation. With nothing typed it lists the member's recent records and views, the actions (create a record of any object, switch the theme) and every page. Typing searches the records of every object the member can read (by name, email and domain, with typo tolerance), the views they can see, the pages and the Settings pages, all in one list grouped by kind. The keyboard does everything: the arrows move, Enter opens or runs, Esc clears what is typed and then closes. A screen reader hears the field, each highlighted row and how many results there are. Search runs in Postgres through the access door, so hidden records, objects, views and fields never reach the browser, and it holds its budget at a million records. The menu loads in its own chunk, outside the first load.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0004 stored sort keys | `sort_keys` (the name key for prefixes and ranking), `crm_search_text`, the trigram index on `values` | hard prerequisite (landed) |
| Spec 0009 access, spec 0032 access rules | `objectLevel`, `attributeVisible`, `recordRuleSql`, `removeMember` | hard prerequisite (landed); stored rules apply through the same calls |
| Spec 0014 record picker | `searchedAttributes` and its 150 ms debounce pattern in the data layer | hard prerequisite (landed) |
| Spec 0020 saved views | `seesView`, the views table | hard prerequisite (landed) |
| Spec 0026 settings | the Settings pages list (`settingsNav`), Preferences for the theme | hard prerequisite (landed) |
| Spec 0034 sidebar | the Quick actions row and the search button that open this menu (AC-923) | ⌘K and `/` work from the keyboard; the frame shows no row |
| CommandPalette module (spec 0003) | the palette `Modal` and the inline searchable `Menu` | hard prerequisite (landed; extended here) |

## Requirements

**User stories**:
- As a member, I want to jump to any record, view or page from the keyboard without reaching for the sidebar.
- As a member, I want to find a company even when I misspell it, and find a person by their email.
- As a member, I want the things I opened last to be one key away.
- As a member using a screen reader, I want to hear what I'm on and how many results came back.
- As an admin, I want search never to show a member a record, field or view they aren't allowed to see.

**Acceptance criteria** (AC-1071 to AC-1104 used; the rest of the range is spare):

*Opening*
- **AC-1071**: ⌘K on a Mac keyboard (Ctrl+K elsewhere) opens the menu from any page inside a workspace, including Settings, whether focus is in a text field or not; pressed again while it is open, it closes the menu. `/` opens it in search mode, but only when focus isn't in a text field, an editor or a dialog.
- **AC-1072**: Opened from the keyboard, the menu appears instantly (no scale, no fade). Opened by pointer from the sidebar, it grows in like any modal. Closing uses the exit fade. Under reduced motion only fades remain.
- **AC-1073**: The menu opens with its search field focused and empty, and Esc first clears what is typed (as the search field does), then closes it and returns focus to where it was (owner default, 21 October 2026). Opening it again starts empty.
- **AC-1074**: The menu's code (the palette, its sections, the search client) is not in the first load. It loads on first use, or earlier while the browser is idle after the workspace frame paints, so the first ⌘K normally finds it ready. If it isn't ready, the key still opens it as soon as it loads, at most once per press.

*With nothing typed*
- **AC-1075**: The menu shows, in order: Recent (up to 6 of the member's most recently opened records and views, newest first), Actions (Create a <object> for each object the member may write, then the theme actions), and Go to (each object's page, Bookings, Captures, Trash and Settings).
- **AC-1076**: A recent record shows the record's avatar (round for a person, square initials in the record's hue for any other record, as RecordChip draws it everywhere; owner default, 21 October 2026), its name and its object's singular name; a recent view shows the view's name and its object's plural name. Only records still live and readable, and views still visible to the member, are shown (the server resolves them).

*Searching*
- **AC-1077**: Typing searches after a pause of 150 ms from the last key, and a newer query aborts the request before it. Pages, Settings pages and actions filter in the browser at once on every key, while records and views come from the server.
- **AC-1078**: Records match on each readable object's name, and on up to two email or domain attributes, but only attributes the member can see. With 1 or 2 characters the names that start with them match. With 3 or more, any of those attributes that contains the text matches. With 4 or more, if fewer than 20 records matched, names that are close (word similarity, a typo or a missing letter) are added after them.
- **AC-1079**: Record results come in this order: names that start with the text, then names with a word that starts with it, then other contains matches, then close matches by similarity, each group by name. At most 20 records come back.
- **AC-1080**: A record row shows the record's avatar (as in AC-1076), its name, its first email or domain as a quiet second line when the object has one the member can see, and its object's singular name at the end.
- **AC-1081**: Views match by name (contains, ignoring case) across every object the member can read, shared views and the member's own private ones only, at most 8, the default views of objects first, then by name.
- **AC-1082**: Pages and Settings pages match on their name and a few synonyms ("Preferences" also on "theme", "appearance"; "Trash" on "deleted"; "Objects" on "attributes", "fields"). Only Settings pages the member may open are listed (`visibleSettingsNav`).
- **AC-1083**: While the server search is out, the Records section shows one row reading "Searching…", and the result count waits. If the search fails, that row reads "The search didn't finish. Try again." and the browser side sections still show. If nothing matches anywhere, the menu says "Nothing matches “<text>”".
- **AC-1084**: A record created or renamed by anyone becomes findable by the next search after its write commits (no index to catch up).

*Choosing*
- **AC-1085**: Enter or a click on a row opens it: a record opens its record page, a view opens on its object's page, a page or Settings page opens, and an action runs. The menu closes before the route changes.
- **AC-1086**: "Create a <object>" opens that object's page with its new record dialog open, the same dialog as the page's New button. It is listed only for objects the member may write.
- **AC-1087**: A theme action applies at once, saves the choice as Settings › Preferences does, and says so in a toast ("Dark theme on"). The current choice is marked with a check.
- **AC-1088**: Opening a record page or a view (from the menu, the sidebar, a link or a table) records it as recent for the member: once per item per 10 seconds per tab, after the page shows, without waiting for an answer. Failing to record it is silent.

*Access*
- **AC-1089**: Hidden means absent. An object at `none`, a hidden field, a record outside a record rule, a trashed record and another member's private view never appear as results, as recent items, or as counts. Nothing in the answer hints that they exist, and a search for a hidden record's exact name answers the same as a search for nothing.
- **AC-1090**: A search on a hidden field's text never runs: the server leaves hidden attributes out before it searches, so the speed of a search doesn't reveal what a hidden field holds.
- **AC-1091**: `recents.visit` refuses nothing it can't see. A record or view the member can't see is quietly not stored (the same answer as success), so the call can't be used to probe ids. Recents are only ever read back through the door.
- **AC-1092**: Removing a member deletes their recent items (spec 0009's `removeMember`); deleting a view removes it from everyone's recents (cascade); a purged record drops out on read, and its row ages out under the 20 row cap.

*Scale and speed*
- **AC-1093**: On the million record seed (spec 0004, `pnpm db:seed:scale`), every search statement takes under 150 ms at p95 warm in the database call, including a common word, a rare word, a 2 character prefix and a typo of a rare word. One search makes a fixed number of statements however many objects the workspace has: at most 9 data statements, plus the workspace setting and the typo step's savepoint (counted in `verify.md`).
- **AC-1094**: The typo step runs under a 300 ms statement timeout of its own inside a savepoint; when it runs out, the search answers the exact matches it has, never an error.
- **AC-1095**: `search.query` shares the workspace read gate with `records.query` (6 at once per workspace per process) and is cancelled with its request.
- **AC-1096**: `recents.list` reads one indexed range (`member_recents` by member and time) and resolves at most 20 ids; `recents.visit` is one upsert plus one prune by the same index.

*Keyboard and screen readers*
- **AC-1097**: The menu is a modal dialog named "Command menu" (search mode: "Search"). Its field is a combobox, and the rows are a menu with one group per section, each group named by its heading. Up and Down move the highlight across sections, Home and End jump, Enter chooses (the top row when none is highlighted), Esc clears what is typed and then closes, and Tab does nothing that takes focus out of the dialog.
- **AC-1098**: A polite live region says how many results show once the server answers ("12 results", "No results"), and says "Searching…" only when a search has taken longer than 500 ms, so typing quickly doesn't make it chatter.
- **AC-1099**: The footer names the keys (↑↓ to move, ↵ to choose, Esc to close), and actions show their own shortcut. Every row and the field meet WCAG AA contrast in both themes, and forced colours outline the highlighted row.

*Quality*
- **AC-1100**: The menu reads only through the data layer (`data.search`), and nothing about it goes into the record store.
- **AC-1101**: The first load stays at or under the size it had before this spec (it is not allowed to grow), and the menu's own chunk is under 15 kB gzipped.
- **AC-1102**: The library's CommandPalette gains sections, a status row and a live count. Its README and stories cover every state: empty with recent items, results in sections, searching, search failed, nothing matches, loading, and opened from the keyboard.
- **AC-1103**: A guard test proves `member_recents` forces row level security with a policy, and that a cross workspace read returns nothing. A new search function joins the guard test's list of `security definer` functions and stays owned by `crm_search`.
- **AC-1104**: The pages the menu lists are checked by a test that each one's address resolves to a route, so a renamed route can't leave a dead row (as spec 0034's AC-944 does for the sidebar).

## Decision

Build the recommendations: one CommandPalette based menu in its own chunk, opened by ⌘K and `/` from the workspace frame. A new `search.query` procedure answers records and views in one call: prefixes through `sort_keys`, contains through `crm_search_text` for all searched attributes in one statement, and typo matches through a new `crm_search_similar` function owned by `crm_search`. All of it is filtered by the access door in the same statement that ranks it. Pages, Settings pages and actions are matched in the browser. Recent items live in a new `member_recents` table, written by `recents.visit` and read by `recents.list` through the door. See [rationale.md](rationale.md).

## Feature design

### Data model

**`member_recents`** (tenant table: `workspace_id` first, forced row level security with the standard policy)
- `workspace_id`, `member_id`, `kind` (`record` or `view`, a check), `target_id` uuid, `visited_at` timestamptz default now.
- Primary key `(workspace_id, member_id, kind, target_id)`, so a revisit updates `visited_at` in place.
- Index `(workspace_id, member_id, visited_at desc)` for the read and the prune.
- Foreign key `(workspace_id, member_id)` to members. `target_id` has no foreign key (it points at two tables); a view's delete removes its rows in the same transaction (`deleteView`), and reads skip what doesn't resolve.
- At most 20 rows per member: each visit deletes the member's rows past the 20th newest.
- No audit columns beyond `visited_at`: like `member_view_state`, it is the member's own bookmark, not workspace data, and it has no outbox row.

**`crm_search_similar(search_attributes uuid[], search_pattern text, search_limit integer)`**: `security definer`, owned by `crm_search`, `search_path = pg_catalog, pg_temp`, a standard SQL body (`begin atomic`). It returns owner ids (`setof uuid`, never text) in the session's workspace whose current text for one of the attributes passes `lower(pattern) <% lower(left(text_value, 2048))` (pg_trgm word similarity, threshold 0.5, set on the function), at most `least(greatest(limit, 1), 200)`, in no particular order: with no `ORDER BY` a common match stops at the limit instead of scoring every candidate, and the rank statement orders the few it gets by `word_similarity` (a build call, 21 October 2026). It matches nothing when no workspace is set. It is executable by `crm_app` only. It reads through the existing `values_text_trigram` index (`%>` is a GIN trigram operator).

### Services (`packages/core/src/search/`, new)

- `searchWorkspace(scope, { query, limit? }, signal)`: inside `withCancel`, under a 3 second statement timeout:
  1. Readable live objects (`objectLevel` not `none`, not archived), each with its primary attribute and up to two email or domain attributes the reader can see (`searchedAttributes`, moved out of `record-search.ts` and shared).
  2. Records, by the length of the trimmed query:
     - **1 or 2 characters**: one statement over `sort_keys` with the bounded text key range for every readable object's primary attribute, joined to live records, limited to 20.
     - **3 or more**: one statement `select … from unnest($attributes) a, lateral crm_search_text(a, $q, 200)`. Its ids are ranked in a second statement that joins live records of readable objects, the record rules (`recordRuleSql` per object, combined with `or` across objects) and the name key, ordered as AC-1079, limited to 20.
     - **4 or more and fewer than 20 found**: inside a savepoint with `statement_timeout = 300ms`, `crm_search_similar` over the readable primary attributes, then the same rank statement (by score), skipping ids already found. A timeout rolls back to the savepoint and answers what it has.
  3. Displays through `readRecords(…, { attributeIds: [], visibleAlready: true })`, and the second line through one read of position 0 `values` for the searched email and domain attributes.
  4. Views: one statement over `views` joined to `objects`, on readable live objects, `seesView`, `lower(name) like` the escaped pattern (contains), limited to 8, ordered as AC-1081.
- `listRecents(scope)`: the 20 newest rows for the caller, then the records through `readRecords` (live, visible) and the views through the views query (visible, on readable live objects), in visit order.
- `visitRecent(scope, { kind, id })`: checks visibility the way a read would (a record by `readRecords`, a view by `readView`), then upserts and prunes. Something not visible is quietly not stored (AC-1091).
- `deleteMemberRecents(context, memberId)`, called by `removeMember`; `deleteView` deletes the view's rows; a purged record's row drops out on read and ages out under the 20 row cap.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `search.query` | `query` (0 to 200 characters), `limit` (1 to 20) | `{ records: SearchHit[], views: ViewHit[] }`; a `SearchHit` is `{ ref: RecordRefDisplay, objectId, detail?, match: 'prefix' \| 'word' \| 'contains' \| 'similar' }`, a `ViewHit` is `{ id, objectId, name, kind, isDefault }` | member (`member` base, read gate) | `QUERY_CANCELLED` |
| `recents.list` | none | `{ items: ({ kind: 'record', ref } \| { kind: 'view', view: ViewHit })[] }` | member | none |
| `recents.visit` | `kind`, `id` | void | member; the row is always the caller's own | `INPUT_INVALID` |

`recents.visit` stores no outbox row and joins the list of writes that don't go through `commitWrite`, next to `views.markOpened`.

### Client (`packages/data`)

- `data.search` (its module loaded with `import()` on first use, never in the first load):
  - `createGlobalSearch(workspace)`: `ask(query)` with the 150 ms pause, aborting the request before it, kept answers per query for the menu's life, and a `getSnapshot`/`subscribe` state of `{ query, status, records, views }`.
  - `recents(workspace)`: a fresh `recents.list` every time the menu opens (small, and it must reflect access now).
  - `visit(workspace, kind, id)`: at most once per item per 10 seconds per tab, fire and forget.
- Results are displays only and never enter the record store (AC-1100).

### Screens (`apps/web/src/features/command/`, new)

- `useCommandShortcut` in the workspace frame (first chunk of the frame, a few hundred bytes): it listens for ⌘K and `/`, and keeps an `open` state with its mode. It loads `CommandMenu.tsx` with `lazy()`, starts that load when the browser is idle after the frame paints, and draws the menu only once it has been opened.
- `CommandMenu.tsx`: builds the sections from the data layer's search state, the objects and access from the `/w/$slug` match, `settingsNav`, the theme controller and the router. It hands them to `CommandPalette`.
- `commands.ts` (pure, unit tested): the page and Settings lists with their synonyms, the action list, browser side matching and ordering, and the hrefs (including the route walking test of AC-1104).
- The record page and the view route call `data.search.visit` once they show (AC-1088).
- "Create a <object>" navigates to the object's page with `?new=1`, which the object page reads to open its new record dialog.

### Library (`packages/ui`, through `design-system-guardian`)

`CommandPalette` gains:
- `sections`: an ordered list of `{ id, label, items }`, drawn as `MenuSection`s inside the searchable `Menu`. The old flat `items` API stays for "Choose record".
- `status`: a row inside a section for `searching` or `failed`.
- a polite live region with the result count (AC-1098), with copy in `strings.ts`.
- `mode`: the dialog's name ("Command menu" or "Search") and the field's placeholder.
- `isChecked` on a row (the current theme).

No new component: sections are a variant of the existing module, because a second palette would be a second look for the same element.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Record row name | the record's display name | `readRecords` (the primary attribute; "Unnamed <singular>" when empty) |
| Record row second line | first email or domain | position 0 `values.text_value` of the first searched email or domain attribute the reader can see |
| Record row kind | object singular name | `objects.singular_name` through `objects.list` (already in the frame) |
| Record avatar | name, hue and kind | `RecordRefDisplay` (`hue`, `kind`) |
| View row | view name, object plural name | `views.name`; object from `objects.list` |
| Recent order | newest first | `member_recents.visited_at` |
| Pages and Settings | name, href, icon | `objects.ts` and `settingsNav` (one list each, shared with the sidebars) |
| Create actions | which objects | objects whose level allows writes (`access.mine` permissions and object levels) |
| Theme check | current choice | the theme controller (`theme.get()`) |
| Result count | number | the number of rows shown, across all sections |

### Key invariants

- Every record and view in an answer passed the access door in the statement that produced it. Nothing is filtered after the fact in the browser.
- Hidden attributes are never searched (AC-1090).
- A `member_recents` row is written only for something the member could see at the time, and it is read back only through the door.
- The menu's code and the search client never reach the first load.

### Security model

Any active member can search and keep recents. API keys have no recents (no member), and search answers the same door filtered results for them once #34 opens the API. The two `security definer` functions only return owner ids in the session's workspace, which a later statement filters through row level security and the door. Neither returns any text.

### Critical test scenarios

- Happy path: "acme" finds Acme Inc (company), ada@acme.com (person by email) and the "Acme deals" view; "acmee" finds Acme Inc by similarity; verifies **AC-1078**, **AC-1079**, **AC-1081**.
- Access: with a record rule (own records) and a hidden email field, a member searching a colleague's deal name or a hidden email gets nothing, and a recent visit to a now hidden record drops out; verifies **AC-1089**, **AC-1090**, **AC-1091**.
- Tenancy: two workspaces with the same names, and each sees only its own; the guard tests for `member_recents` and the function list; verifies **AC-1103**.
- Scale: `explain analyze` of each statement on the million record seed, recorded in `verify.md`; verifies **AC-1093**.
- Keyboard: open with ⌘K, type, move, Enter opens the record, focus lands on its h1; `/` in a text field types a slash; axe clean in both themes; verifies **AC-1071**, **AC-1073**, **AC-1097**.
- Size: `pnpm size` before and after; verifies **AC-1101**.

## Build plan

**Milestone 1: search through every layer**
1. Migration: `member_recents` with its policy and index; `crm_search_similar` with its owner checks; the guard tests, satisfies **AC-1092**, **AC-1103**.
2. Contracts and core: `searchWorkspace`, `listRecents`, `visitRecent`, `deleteMemberRecents`; unit and access tests, satisfies **AC-1078** to **AC-1081**, **AC-1084**, **AC-1089** to **AC-1092**, **AC-1094**.
3. API: `search.query` in the read gate, `recents.list`, `recents.visit`, satisfies **AC-1095**, **AC-1096**.
4. Data layer: `data.search` with the debounce, abort and visit throttle, satisfies **AC-1077**, **AC-1088**, **AC-1100**.

**Milestone 2: the menu**
5. Library: CommandPalette sections, status row, live count, mode, checked rows; stories for every state; the guardian, satisfies **AC-1097** to **AC-1099**, **AC-1102**.
6. Screens: the shortcut hook, the lazy menu with idle prefetch, `commands.ts` and its tests, Create and theme actions, recording visits, satisfies **AC-1071** to **AC-1076**, **AC-1082**, **AC-1083**, **AC-1085** to **AC-1088**, **AC-1104**.
7. Size and speed: `pnpm size`; EXPLAIN on the scale seed into `verify.md`; `security-access-reviewer`, `state-performance-reviewer`, `ux-interaction-reviewer`, satisfies **AC-1074**, **AC-1093**, **AC-1101**.

## Consequences

**Positive**:
- One place to go anywhere, and a search that already respects every access rule spec 0032 stores.
- No new service: search is a few indexed statements in the database we already run.
- Recent items follow the member to any device.

**Negative / tradeoffs**:
- A second `security definer` search function, so one more hole in row level security to keep narrow, guarded by the same tests as the first.
- Typo tolerance covers names only, and is skipped past its 300 ms budget, so on a huge workspace a typo of a common word may find nothing.
- A write per record page or view opened (throttled, small), on a table that grows by at most 20 rows per member.

**Neutral**:
- The sidebar lane (spec 0034) adds the Quick actions row and the search button that open this menu; until then the menu is keyboard only.

## Follow-up

- [ ] Notes and comments in search, once they have tables (#33's remainder).
- [ ] Match highlighting in rows (bold the matched part), once the Menu row can take a highlighted label.
- [ ] Search inside Settings by setting name (rows within pages), when Settings has more than pages.
- [ ] A search engine, only if the million record run misses AC-1093.

## Rationale

See [rationale.md](rationale.md).
