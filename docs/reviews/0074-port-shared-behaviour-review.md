# Review, feat/port-3, 2026-11-13

**Reviewed by**: Opus 5.5 in a fresh context (the commit trailers say the author also ran on Opus 5.5, so this is an unanchored read, not a cross model one)
**Scope**: 111 files, `feat/port-2..feat/port-3` (spec 0074, batches 1 to 5, stacked on phase 2)
**Verdict**: Approve with nits

## Summary

The branch puts ShareSheet behind every share dialog and adds Share where there was none (booking pages, the workspace link, team pages, the business page), puts PublishBar at the head of every editor (the booking page in its one step form, with ⌘↵), dresses guest page popups in the page's brand through PopupHost, rebuilds the record panel so it draws at once from the store with each section loading on its own, adds J and K and "n of N", makes Download one press, holds the share sheet open during a download, and splits `handle-address.ts` out of `handles.ts` so guest pages stop carrying the app's handle code.

The work holds up. The record panel's async logic is careful: late sections for a record already stepped past are dropped (`isCurrent`), a held ↓ opens only where it stops (`STEP_SETTLE_MS`), parts are matched to the record they belong to, and `records.one` really is served from the store with no read when a view holds the record (`packages/data/src/records/one.ts:191`). The `handle-address.ts` split is a byte for byte move (I diffed the patterns, the 87 reserved words and `handleAddressOf`). Every new address still passes `shareableUrl` inside ShareSheet or `safeHref` inside ButtonLink, the Wallet link is limited to `https:`, the QR file name is slugged in `downloadQr`, and no raw HTML was added. All six publish surfaces leave the checks to the server (AC-7421) and hide the bar from readers (`canManage`, `draft.canEdit`, `!isLocked`).

No blockers and no majors. The minors are a business page Publish that is offered when it is sure to be refused (and then loses its Fix link), an unexpected error's raw text reaching the discard confirm, an unnamed Share button repeated on every card for readers, a Private team page shared with no word about it, and a first load line the spec doesn't record.

What I ran (through `heavy.sh`, Chromium only): `pnpm size` (passes; numbers below); typecheck of `@crm/web`, `@crm/ui`, `@crm/data` (clean); browser tests `Menus.browser.test.tsx` and `RecordPeek.browser.test.tsx` (22 pass); unit tests `step-keys.test.ts`, `index.test.ts`, `forms/draft.test.ts`, `records/params.test.ts` (55 pass). Not run: the flows, Firefox, WebKit, the screenshots, the other browser tests and stories, `pnpm check`.

## Owner gates

**Load time (guest pages)**: met, measured. `pnpm size` on this tip: hosted form 205.72 kB JS and 18.61 kB CSS (phase base 205.90 and 18.57), booking page 188.71 kB JS and 19.40 kB CSS (base 188.89 and 19.37). Each guest page as a whole is about 140 to 150 B lighter: CSS up 30 to 40 B, JS down 180 B, as the caller said. The two budget lines came down to the measurement plus under 0.5 kB.

**Security**: met. Nothing here takes new untrusted input on a guest page; PopupHost only moves where overlays mount. Every shared or encoded address goes through `shareableUrl` (ShareSheet and ShareColumn) or `safeHref` (ButtonLink, ReadyPanel's onward row). Publish, discard and restore still go to the same server calls. No new reads cross a workspace: every new read in the record panel is slug scoped through the data layer.

**Scalability**: met. The panel opens no read for the record a view holds; sections open once per settled record, never per key repeat; the count hooks take a source still opening without calling hooks conditionally. No list lost its virtualisation (the records table and board are untouched apart from passing `state.count`).

**Accessibility**: met with one minor (the unnamed Share buttons). J and K stay out of fields, listboxes, grids, menus and spinbuttons, and Shift refuses them (`step-keys.ts`); a step is said through a polite status; the panel's place is its `aria-describedby`; PublishBar's refusal is `role="alert"`; focus after Publish or Discard lands on the bar's status line, never the body; the share sheet keeps Done focused and waits for a download rather than dropping it.

## Minor

### 🟡 The business page offers a Publish it knows will be refused, and pressing it loses the Fix link, `apps/web/src/features/hospitality/BusinessPageScreen.tsx:317` and `:383`

**Problem**: the old header disabled Publish while `view.problem` was set. PublishBar only disables Publish when its status is `published` (`PublishBar.tsx:297`), so with a known problem and any change waiting, Publish is enabled. When pressed, the server refuses, `publish()` sets `said` to the error (`:276`), and `problem` then prefers `said` (`:318`), which has no `fix`.

**Why it matters**: a business with no services edits its page. The bar says "Add a service first · Fix services" next to an enabled Publish. They press Publish; the server refuses; the bar now says the refusal with no Fix services link, and it stays that way until they publish or discard again. Nothing breaks on the server, but the one way forward is taken away right after a press that was always going to fail. That's not "foolproof" (owner, 5 Nov).

**Suggested fix**: when `said` is an error and `view.problem` is set, keep the fix from `view.problem` (or prefer `view.problem` over `said` when the codes match). Optionally let the business page pass something like `isPublishDisabled` to PublishBar while `view.problem` holds.

### 🟡 An unexpected error's raw message reaches the discard confirm, `packages/ui/src/modules/PublishBar/PublishBar.tsx:162`

**Problem**: a rejected `onDiscard` shows `error.message` for any `Error`. The forms confirm this replaces (`FormConfirms.tsx`, deleted) only showed the message of an `isDataError` and the generic line otherwise. The forms editor's `discard()` (`FormEditor.tsx:684`) awaits `flush()` and `saveDraft`, and can rethrow whatever those throw.

**Why it matters**: a client bug (a `TypeError` in a flush, say) shows the person "Cannot read properties of undefined (reading 'revision')" in a danger callout. The house error rule is a plain `{ code, message }` for expected failures; anything else should read as the generic line.

**Suggested fix**: the library can't import `isDataError`, so let the caller say it: the forms editor maps a non `DataError` to a plain `Error(strings.failedText)` before rethrowing, or PublishBar takes an optional `discardMessage(error)` the caller fills.

### 🟡 Readers get a "Share" button on every card with no page in its name, `apps/web/src/features/booking/LinksScreen.tsx:203`

**Problem**: a reader who can't change a page now gets a standalone Share button on each card, labelled only `strings.share`. The ⋯ button beside it for editors is named per page (`strings.more(page.title)`).

**Why it matters**: a screen reader user listing buttons on Bookings › Pages hears "Share, Share, Share" with nothing to tell the cards apart (WCAG 2.4.6, and the house's own habit of naming the ⋯ per card).

**Suggested fix**: label it with the page, as the ⋯ is (for example `strings.shareNamed(page.title)`), keeping "Share" as the tooltip.

### 🟡 A Private team page is shared with no word that visitors can't open it, `apps/web/src/features/link-page/TeamPagesScreen.tsx:405`

**Problem**: Share is offered on every row with a handle, whatever `page.isLive` says (the row's own Badge says Private), and the sheet gets no `footer`. The link page's sheet says "Private. Only you can open it." (AC-7404) and the booking page's sheet says it isn't live (`BookingShareSheet.tsx`, `notLive`).

**Why it matters**: an admin shares a teammate's Private page and prints its QR code; every scan lands on a page visitors can't see, and nothing in the sheet warned them. Same look and behaviour everywhere is the point of the phase.

**Suggested fix**: pass `footer` with the private line when `!shared.isLive`, as the link page does (the turn on Live action can stay off here, since it is the teammate's page).

### 🟡 The app's first load line isn't recorded at its final number, `docs/specs/0074-port-shared-behaviour/index.md` (Batches 2 to 5 measurements)

**Problem**: `pnpm size` on this tip says first load JavaScript is 296.68 kB. The spec records 296.64 kB after batch 5's first commit and says the review fixes after it are "in the final `pnpm size`", but gives no final number. The phase's recorded base was 296.61 kB at `48d2373ad`, which is older than the phase 2 tip, so I can't say how much of the 70 B is this phase's (phase 2's review fixes landed after `48d2373ad`). The AppShell change in `159c0e55d` is the likeliest first load change in this branch, but I didn't build the older commits to prove it.

**Why it matters**: AC-7417 allows 20 B per batch and the spec promises "Where a line grew past 20 B it is said here rather than hidden". The line is well inside its 297 kB budget; this is about the record, not the budget.

**Suggested fix**: measure `feat/port-2`'s tip and this tip, and write both into the batch 5 column.

## Nits

- `apps/web/src/features/records/RecordPeek.browser.test.tsx:73`: AC-7425's test counts calls to a mocked `records.one`, so it proves the panel calls it once, not that no request goes to the server. The real guarantee lives in `records/one.ts:191`; a data layer test that a held record's subscription makes no `refetch` would make AC-7425 load bearing.
- `apps/web/src/features/menus/MenusScreen.tsx:797` and `packages/ui/src/modules/PublishBar/PublishBar.tsx:140`: after a menu's first publish, two `focusLater` calls compete (Share in the header, and the bar's status line). The comment at `:800` says focus goes to Share; AC-7428 and the passing test say the status line. It works because the bar's handler moves focus during the publish, so the sheet's own focus return lands there. Drop one of the two so the code says what happens.
- `apps/web/src/features/records/strings.ts:13`: "3 of 120" formats with `toLocaleString()` and no locale, so it follows the browser's default rather than the language the app's `UiProvider` uses. Pass the locale through, as the business page's `liveSince` does.

## Strengths

- `openPeekCore` and `openPeekParts` split cleanly; the `isCurrent` guard and the `recordId` on `parts` together rule out a late section landing on the wrong record.
- `stepOf` keeps the arrow rules and the letter rules apart, with Caps Lock handled and Shift refused; a tested pure function.
- ShareSheet's busy close (Esc, outside and Close wait; Done closes once the file is saved) is small and correct.
- The `handle-address.ts` split won back more than PopupHost cost, with every importer of `handles.ts` unchanged.
- The link page's size container moved off the root so its dialogs measure against the window; the README says why.

## Not checked

Firefox and WebKit, the visual screenshots (owed per the spec), the flows the batch edited (CI runs them), the stories and other browser tests, and AC-7426's measurement (owed at the phase 1 merge, as the spec says).
