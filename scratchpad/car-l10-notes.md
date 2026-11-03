# Car car/0037-l10: the CI repair, 3 November 2026

CI run 41529660739 (commit 0b02c9866) was red on `check`, `core`, `tests`, `visual`, `stories (webkit)`;
`stories (firefox)` was cancelled.

## L10's own breakage, fixed here

- **apps/web browser tests (12 of them, 3 files)**: one cause. `LinksScreen` now reads
  `data.managedPages.view(slug)` and `NewPageDialog` mints `data.managedPages.newId()` in a `useState`
  initialiser, and the three harnesses hand the screens a partial `DataLayer` cast with
  `as unknown as DataLayer`, so both threw `Cannot read properties of undefined`. The harnesses now stub
  `managedPages`. One shared helper, `emptyCaptureList` in `src/testing/renderInApp.tsx`, holds a single
  snapshot object for the life of the view: the first version built a fresh snapshot per call and
  `useSyncExternalStore` re-rendered for ever ("Maximum update depth exceeded"). Each harness keeps one view
  in a module constant for the same reason.
- **apps/web `history-lines.test.ts`**: `managed_page.changed` is a listed audit action with a sentence, so the
  guard wants it written out. Two examples added, one per branch of the sentence (no one moved, and people moved).
- **packages/core `access/table.test.ts`**: the six new managed services had no access-table entry.
  `createManagedPage` and `deleteManagedPage` require `booking.admin` outright, so they are plain `permission`
  entries and the existing walk covers them. `list`/`get`/`update`/`setMembers` are `booking.manage` first, then
  `booking.admin` or one of the template's editors, with a template out of reach answering `NOT_FOUND`: that is a
  shape no existing entry kind had, so a `managedPage` kind was added with its own walk case (a key without
  `booking.manage` is FORBIDDEN; a plain member meets the owner's template as absent and lists none).
  `lockedPartOfWrite` is pure, so it joins `NO_SCOPE`.
- **packages/core `access/scheduling-scan.test.ts`**: `booking/managed.ts` names `booking.admin`, which is right —
  a managed page is the workspace's own booking page, a thing, exactly like `booking/pages.ts`. Listed with that
  reason.
- **apps/api `writes.test.ts`** (not in the brief, found in the run's log): the six `managedPages` procedures were
  neither reads nor writes. `list` and `get` are reads; the four writes have cases proving one poke each and no
  outbox row (a template and a member page are settings, not CRM data), with `WRITES_MADE` counts for the three
  that make a template first.

## Not L10's, left alone

- **`check`**: the only failing step is `pnpm size`. First load JS is 255.71 kB against a 252 kB budget. The base,
  `origin/car/0037-car3-ci` at 1d34c313f, was already 255.07 kB over the same budget (run 41461955042), while main
  is green. So the overflow arrived with the car's base, not with L10, which adds 0.64 kB on top. Raising the
  budget or trimming first load is the coordinator's call; nothing here touches `.size-limit.js`.
- **`visual (chromium)`**: 7 `MatchCalendar` stories. `45bcac5ac` on main changed that module's copy and strings
  without reshooting its baselines; its own CI run was cancelled and every main run since has *skipped* `visual`
  (the ui filter), so it was never caught. L10 changes no file under `packages/ui`. Baselines deliberately NOT
  regenerated: another chat owns that fix, and `--update` here would pin whatever renders now.
- **`stories (webkit)`**: the page crashed out of memory (`VITEST_BROWSER_CONNECTION_CLOSED`) after 73 of 178
  files, with no test failure. The known distribution, not a new break; `stories (firefox)` was cancelled behind
  it, and Firefox is ignored by standing decision.
