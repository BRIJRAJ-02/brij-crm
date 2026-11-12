# 0072 rationale: port phase 1, library parity

## Context

Phase 0 (spec 0071) gave the real app the prototype's tokens: its names, its values, an app scale at 88% and the outline focus ring. The components that draw with those tokens still have the library's old design: square 8px corner buttons with a blue primary, tags with an outline, a checkbox at the old sizes, a shadow based focus halo. Until each part moves to the prototype's design, every screen looks like a mix of the two.

The two libraries overlap a lot but not neatly. 72 folders share a name. The prototype also merged many library parts into fewer, richer ones (its `meta.json` lists what each one `replaces`): Tag replaces Badge and StatusDot, Checkbox replaces Radio and Switch, FloatingBar replaces four bars. The library, on the other hand, has grown behaviour the prototype never drew: field and value buttons, split buttons, label swaps that hold their width, letters on radio rows, touch target sizes for public pages. The owner's rule is that no real functionality may be lost.

The owner also asked for three gates on every phase: cut load time a lot (at least 30% on what the phase touches, nothing else worse), keep security tight (no HTML from strings, safe links, no secrets) and keep it scalable (virtualised lists, no work per item on hover or scroll, stable keys). Another lane builds phase 2 in `packages/ui` at the same time, and a fixes lane works in `apps/web`.

## Options considered

### Option 1: Replace each part with the prototype's code

Move each prototype TSX and CSS into `packages/ui` as is (renaming classes to CSS modules), and update every caller to the prototype's props.

**Pros**:
- The library becomes the prototype exactly, prop names included.
- Later screen phases copy JSX with no map.

**Cons**:
- The prototype's components lack behaviour the app relies on (field buttons, split buttons, touch sizes, label reserve, letters, `safeHref` on every link, `strings.ts` copy, cursors), so behaviour would be lost or rebuilt twice.
- Every caller in `apps/web` changes at once (about 1,100 Button call sites alone), colliding with the fixes lane and the phase 2 lane.
- One giant diff that cannot land per tier.

### Option 2: Port the look into the existing parts, keep the API, fold superseded parts onto shared CSS (chosen)

Keep every export and prop. Rewrite each CSS module from the prototype's rules, restyle library only variants in the prototype's language, and make folded parts share their replacer's rules through `composes` or by rendering it. Write a prop name map for the screen phases.

**Pros**:
- No behaviour is lost and no caller changes, so the tier can land on its own.
- Folding removes duplicated CSS, which is most of the load time cut.
- The phase 2 lane can work beside it: no shared file is renamed.

**Cons**:
- Prop names differ from the prototype until a later rename.
- Folded parts stay exported until their callers move.

### Option 3: Build the prototype parts beside the old ones and switch screens over later

Add `ButtonV2` and friends, leave the old parts alone, and let each screen phase switch.

**Pros**:
- Zero risk to today's screens during phase 1.

**Cons**:
- Two libraries ship at once: the first load grows, the opposite of gate 1.
- Two looks live side by side for months, and the design system rule "a second button style is how a design system dies" is broken on purpose.

## Rationale

Option 2 is the only one that meets all three constraints together: no functionality lost (the library's behaviour stays), load time down (shared CSS replaces duplicated CSS, nothing ships twice), and landable per tier while two other lanes run (no caller and no export changes). The cost, prop names that differ from the prototype's, is real but small, and it is written down once as a map the screen phases follow. A rename can happen later when no lane is open, as a mechanical codemod.

Folding through `composes` rather than deleting the folded export is the industry standard deprecation path: the shared rules move first, callers move when their screen is ported, and the export is deleted by whoever removes its last caller.

## Decisions the prototype leaves open (decided by industry standard)

The owner delegates design calls; each is decided here, with options and the reason.

1. **Button sizes: keep the library's names, map them.** Options: rename the library's sizes to the prototype's (`sm` 28, `md` 36, `lg` 44) with a codemod over every caller, or keep the names and map. Picked: keep and map. A codemod over 1,100 call sites in `apps/web` would collide with two running lanes, and the library's `md` already draws the prototype's `sm` (28). The map lives in `index.md`.
2. **Primary is ink, blue is never a fill.** The prototype's README and CONVENTIONS say so, and the handover says the artifacts win on look. The library's blue primary becomes `--primary` on `--on-primary`. A strong selection (`isSelectionStrong`, a picked time) keeps the accent fill, since blue there means "selected", which the prototype allows.
3. **Danger.** The prototype has one danger, a red fill. The library has three: `danger` (red words on a white pill), `danger-solid` (red fill) and `ghost-danger`. Picked: keep all three (no behaviour lost); `danger-solid` takes the prototype's danger, `danger` is the prototype's secondary with red words and edge, `ghost-danger` is the prototype's ghost with red on hover. The prototype darkens danger on hover with `filter: brightness(0.94)`; the library keeps `--danger-hover` until the legacy token retires, then uses `color-mix` toward `--text` (no filter, so focus rings and children are not darkened).
4. **Library variants the prototype lacks** (`field`, `value`, `link`, `warning`, `dashed`, sizes `xl`, `touch`, `public`, `sheet`): each takes the nearest prototype look. `field` is the prototype's filled input (Field's look, tier 2 aligns both). `dashed` is the prototype's "Add row" pattern: a pill with a dashed `border-strong` edge. `link` is the prototype's ghost at label size. `warning` keeps its orange tag fill.
5. **Focus ring.** The prototype's outline ring (`--border-width-focus` solid `--focus-ring`, 2px offset) replaces the library's accent edge plus `shadow-focus` halo on every interactive atom. An outline never changes layout and shows in forced colours. Inside a clipped scroller, a part that cannot show an outside ring uses `outline-offset` of `calc(-1 * var(--border-width-focus))` and says so.
6. **Press.** The prototype's CONVENTIONS still say buttons scale to 0.97; its own parity ledger (Wave A) removed every press scale, and the house rule is no press scale in the app. Picked: no press scale; the pressed colour carries the press. Public pages keep the `--scale-press` they set on their root.
7. **Motion values.** Taken from the prototype's CSS (the transitions.dev mapping in CONVENTIONS), never from its README prose when the two disagree (the Button README says "100ms" hover; its CSS says `--duration-quick`). CSS wins because it is what the artifact shows.
8. **Hover springs done in JavaScript.** The prototype's RecordChipList sets `--tf-shift` and `--tf-scale` per item from a pointer handler. That is a state change per item on every hover (gate 3). Picked: the same spring with CSS sibling and `:has()` selectors, as the prototype's own AvatarGroup does.
9. **Raw prototype lengths.** Options: add a source token for every raw value (26px tags, 18px checkboxes), or build each from existing tokens. Picked: a single token, else a `calc()` of two tokens, else a new source token in its own commit (index.md, *How a prototype value becomes a token*). The phase 2 lane edits the same source file, so new tokens are kept to the ones that cannot be built.
10. **Folded parts' sizes.** Badge has sizes the prototype's Count lacks (`chip`, `chip-lg`, `fit`); StatusDot has a short label and an inherited look; Radio has card and letter rows. All kept, restyled in the replacer's language.
11. **An AvatarStack that opens nothing does not fan out.** The prototype's AvatarGroup lifts on hover "to show it can be opened". Every library stack is a still picture (a team, the people on a record); a lift would promise an action that isn't there (`interface-affordances`), and its CSS sat on the booking page's stylesheet. Picked: no fan on a stack; RecordChipList, whose chips are links, keeps the fan, in CSS.
12. **The tooltip's arrow waits.** Built twice and measured: as React Aria's `OverlayArrow` it cost every page with a tooltip about 330 B of script, and drawn in CSS it took the booking page's stylesheet past its budget (19.52 kB against 19.5). Picked: no arrow and no entry scale in tier 1; the arrow is owed to the phase that trims the booking page's CSS (phase 2's BookingFlow).
13. **Retire legacy tokens as soon as their last user goes.** Tier 1 removed the last uses of `danger-hover`, `border-inverse`, `on-accent-kbd`, `size-check`, `size-switch`, `size-kbd` and four `duration-public-*` timings, so they leave `legacy.json` (and `tokens.css`, which every page loads) in the same tier, with their contrast pairs and the `size-check` house rule.
14. **Folded parts keep their own CSS module in phase 1.** The first draft had them `composes` their replacer's classes. The house rule `pnpm house-rules` enforces is that one component owns its styles and nothing reaches into another's module; `composes` across folders is exactly such a reach, and it ties the cascade order of two modules that load in separate chunks. Rendering the replacer works only where the props line up (none of tier 1's folded atoms: Badge's counts, StatusDot's short label, Radio's cards and letters and LinkChip's favicon all have shapes their replacer lacks). Picked: each folded part keeps a module written from its replacer's rules and lists the overlap in its README; the overlap leaves with the folded export when its last caller moves (phases 4 to 9). The overlap in tier 1: Badge's dot rules against StatusDot's, Radio's circle against Checkbox's box, LinkChip's chip against RecordChip's (not measured on its own; each is a few rules).

## Evidence

### How the parts list was built

`ls design/timefix-design-system/src/components` against `ls packages/ui/src/{atoms,molecules,modules}`: 72 shared names. Then every prototype `meta.json` `replaces` entry was matched to a library folder name (the first word of the entry). A library folder claimed only by one of the 72 is a phase 1 folded part (55). A folder claimed by a prototype only part, alone or together with one of the 72, is phase 2 (43). No library folder is unclaimed. 72 + 55 + 43 = 170.

### Load time: base measurement (`f81623f0c`)

`pnpm size` on the base:

| Line | Base |
|---|---|
| First load JavaScript | 296.64 kB |
| First load CSS | 7.86 kB |
| Hosted form JavaScript | 205.91 kB |
| Hosted form CSS | 18.57 kB |
| Form step layouts, lazy | 5.75 kB |
| Form signature and ranking, lazy | 6.25 kB |
| Booking page JavaScript | 188.89 kB |
| Booking page CSS | 19.37 kB |
| Media block chunk | 1.14 kB |
| Picture and gallery chunk | 1.67 kB |
| Next times chunk | 1.37 kB |
| Notice sheet chunk | 463 B |

All of `apps/web/dist/assets`, gzipped: 2,169,429 B of JavaScript and 149,413 B of CSS. The whole library's CSS modules, each minified and gzipped: 145,527 B.

Tier 1 folders on the base, from `node packages/ui/scripts/part-cost.ts --tier 1 --ref f81623f0c` (bytes, gzipped; CSS minified by Lightning CSS, TS and TSX transformed and minified by Oxc, the build's own tools):

| Folder | CSS | JS |
|---|---|---|
| Button | 2,392 | 4,483 |
| Icon | 513 | 4,117 |
| ProviderMark | 386 | 1,099 |
| Kbd | 390 | 695 |
| Link | 404 | 631 |
| Code | 509 | 447 |
| Tooltip | 579 | 1,180 |
| Tag | 702 | 626 |
| Badge | 642 | 631 |
| StatusDot | 530 | 506 |
| Avatar | 1,037 | 1,261 |
| PersonLine | 401 | 615 |
| RecordChip | 562 | 717 |
| LinkChip | 609 | 784 |
| Mention | 221 | 139 |
| Variable | 333 | 375 |
| RecordChipList | 163 | 664 |
| QrCode | 420 | 1,280 |
| Checkbox | 1,532 | 1,022 |
| Radio | 1,958 | 1,344 |
| Switch | 752 | 506 |
| Slider | 564 | 454 |
| DragHandle | 478 | 443 |
| **Tier 1 (23 folders)** | **16,077** | **24,019** |

The after tables are filled in per tier below.

### Tier 1 after

`node packages/ui/scripts/part-cost.ts --tier 1 --against f81623f0c` on the tier 1 tip (bytes, gzipped):

| Folder | CSS before → after | JS before → after | Change |
|---|---|---|---|
| Button | 2392 → 2380 | 4483 → 4496 | 0% |
| Icon | 513 → 469 | 4117 → 4117 | -1% |
| ProviderMark | 386 → 394 | 1099 → 1099 | 0.5% |
| Kbd | 390 → 413 | 695 → 695 | 2.1% |
| Link | 404 → 459 | 631 → 631 | 5.3% |
| Code | 509 → 508 | 447 → 447 | -0.1% |
| Tooltip | 579 → 613 | 1180 → 1180 | 1.9% |
| Tag | 702 → 697 | 626 → 626 | -0.4% |
| Badge | 642 → 649 | 631 → 631 | 0.5% |
| StatusDot | 530 → 537 | 506 → 506 | 0.7% |
| Avatar | 1037 → 1056 | 1261 → 1263 | 0.9% |
| PersonLine | 401 → 402 | 615 → 615 | 0.1% |
| RecordChip | 562 → 629 | 717 → 718 | 5.3% |
| LinkChip | 609 → 720 | 784 → 784 | 8% |
| Mention | 221 → 235 | 139 → 139 | 3.9% |
| Variable | 333 → 296 | 375 → 375 | -5.2% |
| RecordChipList | 163 → 335 | 664 → 664 | 20.8% |
| QrCode | 420 → 418 | 1280 → 1280 | -0.1% |
| Checkbox | 1532 → 1637 | 1022 → 1027 | 4.3% |
| Radio | 1958 → 2005 | 1344 → 1344 | 1.4% |
| Switch | 752 → 859 | 506 → 506 | 8.5% |
| Slider | 564 → 887 | 454 → 463 | 32.6% |
| DragHandle | 478 → 532 | 443 → 443 | 5.9% |
| Total | 16077 → 17130 | 24019 → 24049 | 2.7% |

**AC-8 is not met for tier 1: the touched folders cost 2.7% more, not 30% less.** Why: tier 1 kept every behaviour (AC-3), and the prototype adds motion and states the library didn't draw: the drawn tick, the switch's stretch and overshoot, the slider's value bubble, RecordChipList's hover spring, the link chip's wash. The cuts that were available were taken (one rule per hue through custom properties, the stack fan and the tooltip arrow dropped, dead focus halos, folded duplicates). The atoms are small and mostly unique code; there is little duplicate left in them to remove. Where phase 1 can cut a lot is tier 2 and 3, whose folded parts duplicate whole components (Table, SampleTable and DataGrid; four bars and FloatingBar; Stats, RecordStats, TileGrid and Card), and in retiring legacy tokens every page loads. The owner decides whether AC-8 stays per tier, moves to the whole phase, or measures the built pages instead (see the report).

`pnpm size` on the tier 1 tip against the base:

| Line | Base | Tier 1 | Budget now |
|---|---|---|---|
| First load JavaScript | 296.64 kB | 296.62 kB | 296.7 kB (was 300) |
| First load CSS | 7.86 kB | 7.73 kB | 7.8 kB (was 40) |
| Hosted form JavaScript | 205.91 kB | 205.95 kB | 206 kB (was 223) |
| Hosted form CSS | 18.57 kB | 18.58 kB | 18.6 kB (was 18.8) |
| Form step layouts, lazy | 5.75 kB | 5.75 kB | 5.8 kB (was 10) |
| Form signature and ranking, lazy | 6.25 kB | 6.30 kB | 6.4 kB (was 14) |
| Booking page JavaScript | 188.89 kB | 188.89 kB | 188.9 kB (was 230) |
| Booking page CSS | 19.37 kB | 19.30 kB | 19.4 kB (was 19.5) |
| Media block chunk | 1.14 kB | 1.14 kB | 1.2 kB (was 1.5) |
| Picture and gallery chunk | 1.67 kB | 1.67 kB | 1.7 kB (was 2) |
| Next times chunk | 1.37 kB | 1.37 kB | 1.4 kB (was 1.5) |
| Notice sheet chunk | 463 B | 465 B | 500 B (was 800) |

All of `apps/web/dist/assets`, gzipped: JavaScript 2,169,429 to 2,170,195 B, CSS 149,413 to 150,063 B. **AC-9 is not met in full**: the hosted form's JavaScript (+40 B), its CSS (+10 B), the signature chunk (+50 B) and the notice sheet (+2 B) grew, and so did the totals. Part of the JavaScript is noise: a changed chunk's content hash changes the import strings of every chunk that loads it, and about a hundred route chunks moved by 10 to 14 B each with no code change. The real growth is the checkbox's tick wrapper (about 20 B) and Button's `soft` look. The CSS totals grew by the new motion above, less the retired tokens (130 B off every page's first load).
