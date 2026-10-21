# 0039. Command menu and global search: verify

## AC-1093: statements per search, and their speed

### How many statements a search makes

Counted from Postgres's own statement log (`log_statement = all` for the test login, on 21 October 2026) while `packages/core/src/search/search.test.ts` ran its searches. Each search is one transaction:

| Step | Statements | When |
|---|---|---|
| The workspace setting (`set_config`) | 1 | always |
| The searched objects, then their attributes | 2 | always |
| Prefix (1 or 2 characters) or contains (3 or more) | 1 | always |
| Typo (`crm_search_similar`), ranked in the same statement | 1, inside `savepoint`, `set local statement_timeout` and `rollback to savepoint` | 4 or more characters, fewer than the limit matched |
| The found records' displays (`readRecords`: records, objects, values) | 3 | some record matched |
| Each record's second line (`detailsOf`) | 1 | some record matched |
| Views | 1 | always |

So a search makes at most 9 data statements, plus the workspace setting and the typo step's three control statements, and a search that finds nothing makes 4. None of these steps runs once per object: each walks every readable object in one statement, so the count is the same for a workspace with 3 objects or 300.

The spec's "at most 5 statements" was written before the security and speed reviews asked for the door to be applied inside each candidate statement (so the number of round trips never depends on what is hidden) and for the displays to come through the same `readRecords` every screen uses. Proposed wording for **AC-1093**: "One search makes a fixed number of statements however many objects the workspace has: at most 9 data statements, plus the workspace setting and the typo step's savepoint."

### Speed

The million record seed run is waived on the current Neon plan (owner, 12 October), so the numbers below come from the state and performance reviewer's run on a local Postgres holding about a million deals, warm, as the app role with row level security on:

| Statement | Time |
|---|---|
| Contains, a common word and a rare word | 37 to 55 ms |
| Typo (`crm_search_similar` with its ranking) | 43 to 95 ms |
| The ranking and door step over the candidates | 1 to 12 ms |

Every statement is inside the 150 ms budget there. The candidate budgets in `search.ts` (`CONTAINS_BUDGET` 1000, `PREFIX_BUDGET` 500 keys per object, `SIMILAR_CANDIDATES` 100) bound the work whatever the workspace holds. Rerun on the million record seed if the plan changes.

## AC-1094: the typo step's own timeout

`packages/core/src/search/search.test.ts`, "answers the exact matches when the typo step runs out of time": the test makes `crm_search_similar` sleep 2 seconds, searches "acmee", and gets the exact match (Acmee Labs) with no typo matches and no error, in under 1.5 s. It then puts the function back exactly as it was (`pg_get_functiondef`) and the typo finds Acme Inc again.

## AC-1095: the read gate

`apps/api/src/modules/search.test.ts`, "the read gate": six searches held on a lock fill the workspace's six places; a seventh search, a `records.query` and a `recents.list` each get 429 `TOO_MANY_REQUESTS`; aborting the six frees their places, and six searches then run.

## Access (AC-1089 to AC-1092, AC-1103)

`packages/core/src/search/search.test.ts`, "hidden means absent" and "recent items": an object at none, a hidden email field, records outside a rule, the trash, another member's private view and a second workspace with the same names never show; a hidden name is never searched (no prefix, contains or typo on it). The guard tests cover `member_recents` (row level security forced, a policy, a cross workspace read returning nothing).

## The menu in the browser

- `apps/web/e2e/command.flow.ts`: ⌘K opens the menu with focus in its field; typing finds a person, Enter opens their page and closes the menu; a slash typed in a text field stays a slash and opens nothing; `/` elsewhere opens search and Esc closes it; the person just opened shows under Recent; Create a person opens the New person dialog. axe in light and dark on the open menu and on a search, at 1280 and 375. Passed locally on 21 October 2026 against an API on 3340 and Vite on 5330, and runs in CI's `flows` job.
- The library's CommandPalette stories (sections, searching, failed, try again, nothing matches) run in Chromium, Firefox and WebKit with axe in both themes, and Sections, Section Searching and Section Failed have screenshots.

## AC-1101: size

Owed: CI's size job on this branch's next green run gives the first load against `main`'s, and the menu's chunk.
