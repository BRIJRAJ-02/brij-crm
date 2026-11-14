# Review, feat/port-3 (port phases 1, 2 and 3 combined), 2026-11-14

**Reviewed by**: Opus 5.5 in a fresh context. The commit trailers say the author also ran on Opus 5.5, and the cross model reviewer could not be started in this session (the agent launch failed twice), so this is an unanchored read on the same model, not a cross model one. For a second opinion from a different model, switch with `/model` and run `/check review` again.
**Scope**: 565 files (screenshots left out), `origin/main...feat/port-3` (main is 2a72fd06c, phase 0, already live). Weighted to what is new since `docs/reviews/0073-*.md` and `docs/reviews/0074-*.md`, and to how the three phases meet: merge resolutions, look against behaviour, the brand reaching guest buttons, popups and focus rings, and token names after phase 0's rename.
**Verdict**: Changes requested

## Summary

The three phases fit together well. Every guest root that hosts popups (the hosted form, BookingFrame, MenuList, LinkPage, GuestLook) points the same names at its brand (accent, on accent, accent text, focus ring) and sets the guest `size-bar` on its PopupHost, so a sheet or menu opened on a guest page wears the page's colour and its rings; Button's primary takes the page's accent through one chain; the merge notes of phase 1 were applied (BookingReceipt's primary, BookingFrame's ring, the LinkListToolbar import), and BookingFoot's split kept its rail card through a wrapper. No changed stylesheet reads a custom property that is defined nowhere, so phase 0's rename left no dangling names.

The one major is about the record, not the code: phase 1's load debt table leaves out the pages that grew most. The records table (the screen people live in) is about 4.7 kB over its base, the record page 3.6 kB, the inbox and tasks 2.4 to 2.7 kB, and the public insights page 0.9 kB, and none of them has a recorded figure, so the rule "each screen phase pays its page back to its `f81623f0c` figure" has nothing to hold those pages to. One minor: the business page now holds Publish back silently before an address is claimed.

What I ran (no builds, no tests, the shared lock was held): `scratchpad/t3m.mjs` over the built `apps/web/dist` (built 13 Nov 22:53 from 2073bf2cf; the only later commits are a story and an empty `[reshoot]`), against `scratchpad/port1-base-dist` (`f81623f0c`), `port1-3dF-dist` (phase 1's tip, 97063690d) and `m12/merged-dist` (an earlier port-12 build); a scan of every changed stylesheet's `var(--name)` against every custom property defined in the repo. Everything else is from reading the code.

## Owner gates

**Load time, guest pages**: met. Against `f81623f0c`, CSS and JavaScript gzipped, entry plus static imports: booking page 19,503 → 19,328 B CSS and 189,360 → 188,773 B JS (762 B lighter); hosted form +781 CSS, −167 JS (+614 B, recorded debt +880); menu page 30,098 → 26,101 CSS and 240,259 → 234,780 JS (9.5 kB lighter, BookingFoot's split); reserve page +829 CSS, −494 JS (+335 B, recorded +1,202). The app's first load (`index.tsx`): +11 B CSS, −243 B JS.

**Load time, signed in pages**: not met as recorded. See the major below.

**Security**: met, as far as I read. Every new address still goes through `shareableUrl` (ShareSheet, ShareColumn) or `safeHref` (ReadyPanel's onward row, ButtonLink); the QR centre picture goes through `safeImageSrc` in QrCode before `qr-file.ts` inlines it; download names are slugged (`qrFileName`); the three new `innerHTML` lines in `embed/v1.js` write constants only. The guest pages read `handleAddressOf` from `@crm/contracts/handle-address`, the same function as before. The Wallet pass on Team pages is main's, already live.

**Scalability**: met. The records table still passes its source's count to `stepsAround` (`RecordsScreen.tsx:540`) and nothing else in the table or board changed; Share on each booking page card sets one piece of state and opens one sheet, never a read per card; the count hooks take an undefined source without calling hooks conditionally (`packages/data/src/react.ts`); AppShell's one ResizeObserver does no work while nothing moves.

**Accessibility**: met with the earlier reviews' open points (the canvas hover about 1.02:1, a hover only). The guest focus rings take the brand's line colour, which the brand pickers already hold at 3:1; BookingFoot's ring reads `--accent-text`, which LinkPage now maps to its brand (a0ac128c8); the QR pair is a named group with each button named for its file; the token contrast test covers `text-tertiary` on every surface.

## Major

### 🟠 Phase 1's load debt leaves out the pages that grew most, `docs/specs/0072-port-library-parity/rationale.md:401` ("Load debt")

**Problem**: the table lists 15 pages. Its "An object's records" row measures `w.$slug.objects.$object`, which is only the loader that sends you on to a view (`apps/web/src/routes/w.$slug.objects.$object.tsx:12`), so the records table itself (`objects.$object_.views.$viewId`) has no `f81623f0c` figure. Phase 3's table records that route only against port-12 (+325 B). Measured against `f81623f0c` on the current build (CSS, JS, gzipped bytes):

| Page | CSS | JS | Over the base | Phase 1 alone (to 97063690d) |
|---|---|---|---|---|
| Records table (`objects.$object_.views.$viewId`) | 62,660 → 66,632 | 835,110 → 835,844 | **+4,706** | +4,032 CSS, +150 JS |
| Record page (`objects.$object_.$recordId.$tab`) | 58,444 → 61,969 | 784,947 → 785,042 | **+3,620** | +3,658, +98 |
| A list's view (`lists.$list_.views.$viewId`) | 50,999 → 53,923 | 759,392 → 759,631 | **+3,163** | |
| Inbox | 43,471 → 46,109 | 650,873 → 650,930 | **+2,695** | +2,771, +78 |
| Tasks | 42,607 → 44,931 | 646,377 → 646,456 | **+2,403** | +2,457, +76 |
| Import (objects and lists) | 48,846 → 51,556 | +76 | **+2,786** | |
| Settings › Trash | 50,427 → 52,821 | +132 | **+2,526** | |
| Home | 32,358 → 33,386 | −119 | **+909** | +1,175, 0 |
| Public insights (`public.insights`, signed out) | 24,963 → 25,999 | −168 | **+868** | +1,031, 0 |
| Status (`status`, signed out) | 13,424 → 13,776 | −251 | **+101** | +347, −48 |

Every other signed in route moves the same way (+1.5 to +3 kB of CSS each); the full list is in `scratchpad/review/p13-allroutes.txt`.

**Why it matters**: the owner's rule for this debt is that each screen phase "pays that page's debt back before it lands: the page's line ends at or under its `f81623f0c` figure above". For the records table, the record page, the inbox and tasks there is no figure above, so phase 5 (records) could land at today's +4.7 kB and still pass every recorded line. The owner gate for this review ("no page's first load grows except the recorded load debt") fails on paper for these pages. Public insights is a signed out page whose growth nobody has named.

**Suggested fix**: record one row per route (the `t3m.mjs` run over every `?tsr-split=component` key is enough) as the payback baseline, with the records table, the record page, inbox, tasks and the two signed out pages called out; or have the owner confirm that "trim, then accept the rest" covers every route, and point the rule at that full list. No code change is needed.

## Minor

### 🟡 The business page holds Publish back without saying why until an address is claimed, `apps/web/src/features/hospitality/BusinessPageScreen.tsx:320` and `:386`

**Problem**: dcc9c6d21 disables Publish whenever `view.problem` is set (`:386`), but the bar is only told the problem when `view.handle !== undefined` (`:320`). With no address claimed yet, `problem` is undefined, the bar's status is `draft`, and Publish is drawn disabled with no line beside it.

**Why it matters**: a new business with no services opens Business page. The bar says "Not published yet" next to a Publish that can't be pressed, and nothing says "Add a service first". Before this commit Publish was pressable and the server's refusal said why. That is the opposite of "foolproof" (owner, 5 Nov).

**Suggested fix**: tie the two conditions together: disable Publish only when the problem is also said (`view.handle !== undefined`), or say the problem whether or not an address is claimed.

## Nits

- ⚪ `packages/ui/src/modules/ShareSheet/ShareSheet.tsx:195`, "Put it on your site" pressed while a QR file is being made queues the sheet's close (`changeOpen(false)` while `isSaving`) but the onward link navigates at once; harmless (the screen goes), but the close and the move no longer happen together as the comment at `:150` describes.
- ⚪ `packages/ui/src/modules/GuestLook/PopupHost.tsx:23`, the doc says "Never inside an `inert` subtree that can open a popup"; FormParts and LinkPage put it inside their `inert` preview roots. Correct, since an inert preview opens nothing, but the sentence reads as if they break the rule; "a preview that is inert opens none" would say it.

## Strengths

- One brand cascade for every guest popup: the five guest roots set the same names on their content and their PopupHost, so a sheet, menu or dialog opened on a guest page wears its accent, its on accent text and its ring, and its header is the guest bar's height.
- Token names after phase 0's rename are whole: no changed stylesheet reads a custom property defined nowhere in the repo.
- Merge resolutions held: BookingReceipt points `--primary` at its accent, BookingFrame's ring is its brand line, `public-booking/booking.ts` keeps `LinkListToolbar` from its own file, and BookingFoot's split moved the rail card's look onto a wrapper (`.railFoot`) so the foot's stylesheet needs nothing of BookingFrame's.
- PublishBar now says only an expected failure's own message on Discard and keeps a plain line for anything else (`discardFailureOf`), closing phase 3's earlier minor at the library, not per screen.

## Test coverage

Not run here. Since the earlier reviews, `records/strings.test.ts` covers the place line in a given locale, the ReadyPanel and ShareSheet stories cover the QR pair, and the guest popup tests were updated for `size-bar` (06da241e2). Missing: a case for the held Publish with no address claimed (the minor above).

## Not checked

Phase 3's per page claims against port-12's tip a466062db: no build of that commit is on disk. Against the earlier port-12 build in `scratchpad/m12/merged-dist`, only Bookings › Pages (+320 B), Captures › Links (+199 B) and the captures layout route `w.$slug.captures.tsx` (+239 B, not in phase 3's table) grew; the layout row may be chunk regrouping, which I did not confirm. Also not checked: Firefox, WebKit, the screenshots, the flows, `pnpm size`, and the 400 or so stylesheet hunks beyond the token scan and the guest brand rules.
