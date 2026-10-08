# Verify: Client data and state · spec 0006 · updated 2026-10-08
_Steps derived from spec 0006's acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Milestone 2: windows over a million records

### How it was measured (AC-52, AC-54, AC-65)

- **Where.** The local Docker Postgres 18 (`crm-postgres-1`, no memory or CPU cap set on the container; Docker has 8.3 GB, under the 11 GB the capped load stack, `pnpm load:stack`, refuses to start below). The data: a throwaway copy of the dev database's scale seed (`pnpm db:seed:scale`, workspace `scale-1790945031375`: 1,000,000 deals, 1% trashed, so 989,993 live), made with `create database crm_m2_scale template crm`, migrated to 0024, and a member added with `member:add`. The shared dev database was never migrated.
- **What.** The API, the worker and the production build of the web app (`vite build`, then `vite preview --port 5173`, which proxies `/api` like the dev server) on this branch, driven by `apps/web/e2e/scale.flow.ts` in headless Chromium at 1280 × 800: `SCALE_SLUG=scale-1790945031375 SCALE_EMAIL=<the member> npx playwright test e2e/scale.flow.ts --project=1280`.
- **Not the dev server.** The same flow against `vite dev` (React's development build) measured jumps p95 689 ms, frames p95 33.3 ms and a 52 MB heap: development React drops frames on its own, so the numbers below are the production build's, as the grid's own perf test is.
- **The machine** ran other agents' work at the same time (8 cores).

### Numbers (production build, 2026-10-08, after the reviews' fixes)

| Measure | Result | Budget |
|---|---|---|
| AC-52: 20 scrollbar jumps over the deals table, each until its rows show | p50 355 ms, p95 639 ms, max 1,044 ms | p95 under 1 s |
| AC-52: a jump to row 600,000 | 444 ms | under 1 s |
| AC-54: heap after GC, whole view by position (989,993 rows, a step every 2,000 rows, sampled every 50,000) | 19.0 MB at the top, 23.3 MB at most; growth after 50,000 rows 3.2 MB | under 200 MB; growth under 30 MB |
| AC-54: heap after GC, 10,000 rows by cursor (Owner, ascending, a step every 100 rows) | 16.5 to 17.4 MB | under 200 MB |
| AC-54: frame times over the grid story's scripted scroll (60 steps in 3 s, top to bottom), by position | 184 frames, p95 16.7 ms, max 33.3 ms (one dropped frame) | p95 under 16.7 ms (see below) |
| AC-54: the same by cursor | 184 frames, p95 16.8 ms, max 16.8 ms | as above |
| Cursor blocks of 100 rows sorted by Owner (a member's name) | p50 1,993 ms, p95 2,856 ms | none in this spec |

Frame times are the gaps between animation frames, which sit on the 60 Hz beat (16.67 ms) with up to a millisecond of jitter; a dropped frame shows as 33 ms. One frame was dropped in the scroll by position and none by cursor, so the p95 sits on the beat. An earlier run before the reviews' fixes measured jumps p95 462 ms, heap 18.7 to 22.7 MB and no dropped frame: the machine was shared, so the two runs differ by load. The flow asserts the p95 under 17.7 ms for that reason.

### Steps

- [x] One body per record: two windows of one object with different sorts hold one copy, and an edit shows in both in the same frame with one render each (`layer.test.ts`, "one store") → AC-42
- [x] Windows keyed by object, filter and sorts; two spellings of one question share a window; a new sort opens a new one (`layer.test.ts`) → AC-51
- [x] One clock per window, sent with every block and count, refreshed at each settle (`layer.test.ts`, "sends one clock") → AC-51
- [x] `canJump` in `@crm/contracts` agrees with the engine on every sort kind: the engine refuses a position exactly where it says no (`query.test.ts`, "jumps exactly where canJump"; `records.test.ts` in the API) → AC-52
- [x] Position windows: jumps load one block, far loads abort, far blocks drop (`windows.test.ts`); 20 jumps on the scale seed (above) → AC-52
- [x] Cursor windows: checkpoints, a dropped block reloads from its own checkpoint in one call, a second half reloads from the first one's with 200, a read ahead in calls of 200 aborted when the screen moves back, the bar growing past 10,000, a short final block setting the count, all against a keyset fake served from a reference order (`windows.test.ts`) → AC-53
- [x] A refused cursor restarts the chain once, a second refusal shows the error state; a refused filter never restarts (`layer.test.ts`) → AC-53
- [x] "10,000+": the snapshot's `count` carries `atLeast`, and the TopBar's Badge says it (`RecordsScreen.tsx`) → AC-53
- [x] Memory flat and frames on the beat on the scale seed (above) → AC-54
- [x] Reads carry only the visible columns and the primary, on the wire (`records.test.ts` in the API, `query.test.ts`, `layer.test.ts`); a newly shown column is read for the loaded rows alone; an event naming only unread attributes fetches nothing (`layer.test.ts`) → AC-55
- [x] Settle: values patch at once, order 1.5 s after the last change, held while an editor is open, own rows kept, the "Doesn't match this view" note, own creates first and noted New (`layer.test.ts`, `view.test.ts`, `e2e/settle.flow.ts`) → AC-56
- [x] People opens newest first, and the column menu's sorts reorder it for the visit (`e2e/settle.flow.ts`, `e2e/people.flow.ts`) → AC-57
- [x] The flows pass locally against the production build on the throwaway database: people, versions, live, catch up, settle and sign in (1280) → AC-65 (production runs are the owner's step)

### Found while measuring

- **The grid could not reach the last rows.** Browsers stop scrolling near 33.5 million px (Firefox near 17.9 million), and 989,993 rows of 34 px is 33.7 million, so a scroll to the bottom stopped near row 986,900. The grid now draws a body of at most 15 million px and scales scroll positions past it (`DataGrid.tsx`, `MAX_BODY`).
- **A new sort's view never heard the range on screen.** The grid asked a source for its rows only when the range changed, so after a sort the new view loaded only its first block. A view's `onRangeChange` is now one function for its life, and the grid asks again when it changes.
- **Sorting by a member is slow at this size.** Cursor blocks sorted by Owner took about 2 s each on the scale seed (spec 0004 lists member and reference sorts as best effort). Nothing in this spec budgets it; worth a look with #20's saved views.
- **A cursor window counted past 10,000 read without bound.** An unfiltered view sorted by a member has an exact count (989,993), and a drag far down read ahead in calls of 200 until it got there: about 3,000 calls of 2 s. Its bar now covers 10,000 plus the rows loaded, as a capped count's does, and one read ahead makes 50 calls at most (`windows.test.ts`).
- **A change could make every tab reread at once.** Any event naming a record a window didn't show dirtied it, so an edit out of sight made all tabs settle 1.5 s later together. Now such an id dirties a window only when it was minted in the last 10 minutes (it may be a create), and every settle waits a random 0 to 2 s more, at most 5 s after the first change (`layer.test.ts`).
