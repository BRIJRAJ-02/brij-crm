# 0072 rationale: port phase 1, library parity

## Context

Phase 0 (spec 0071) gave the real app the prototype's tokens: its names, its values, an app scale at 88% and the outline focus ring. The components that draw with those tokens still have the library's old design: square 8px corner buttons with a blue primary, tags with an outline, a checkbox at the old sizes, a shadow based focus halo. Until each part moves to the prototype's design, every screen looks like a mix of the two.

The two libraries overlap a lot but not neatly. 72 folders share a name. The prototype also merged many library parts into fewer, richer ones (its `meta.json` lists what each one `replaces`): Tag replaces Badge and StatusDot, Checkbox replaces Radio and Switch, FloatingBar replaces four bars. The library, on the other hand, has grown behaviour the prototype never drew: field and value buttons, split buttons, label swaps that hold their width, letters on radio rows, touch target sizes for public pages. The owner's rule is that no real functionality may be lost.

The owner also asked for three gates on every phase: cut load time a lot (first drafted as at least 30% on what each tier touches; since 12 Nov measured per phase on real pages, decision 15), keep security tight (no HTML from strings, safe links, no secrets) and keep it scalable (virtualised lists, no work per item on hover or scroll, stable keys). Another lane builds phase 2 in `packages/ui` at the same time, and a fixes lane works in `apps/web`.

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

15. **The load gate is measured per phase, on real pages** (the owner, 12 Nov, after tier 1's report). Options: keep 30% per tier on the touched folders, move 30% to the whole phase, or measure the built pages. Picked: the pages. Atoms are small, mostly unique code, and keeping every behaviour (AC-3) while adding the prototype's motion cannot cut a third of them (tier 1 came out 3% heavier); what a visitor waits for is the page, which `pnpm size` measures. The rules: no `pnpm size` line grows beyond content-hash noise (±20 B), budgets sit at the measurement plus 0.5 kB (tier 1's 0.1 kB rounding left 0.01 kB on the booking page's CSS, which CI's hash noise turns red), each phase reports its pages before and after, and the real cuts are counted where duplicates fold away (tiers 2 and 3) and in the screen phases 4 to 9. `part-cost.ts` stays as the per folder report.

16. **One look everywhere** (the owner, 13 Nov, replacing the first answer to the coordinator's ruling on tier 2). The ruling first said guest pages keep their shipped look and cost until their own port phases; the lane built that as two looks per shared part (the shipped module for every page, the prototype's look in an app only `<Part>.app.css` loaded with the app's layouts). Measured on real app routes, that stylesheet (18.6 kB gzipped) sat on top of the shipped modules on every signed in screen: the workspace shell's CSS went from 34.8 to 53.6 kB gzipped, the sign in screen's from 26.7 to 45.3. That breaks the first load rule far worse than the 0.7 kB the guest pages had grown, and `pnpm size` never saw it, since it lives in route chunks. The owner chose one look: each part carries the prototype's look in its own CSS module, for the app and the guest pages alike. Kept from the ruling: the guest primary button wears the page's accent (Button's primary reads `--form-accent`, `--frame-accent` or `--look-accent` where a guest page's root names one, else `--primary`; LinkPage and GuestLook remap `--primary` themselves), so the brand reaches it, in an editor's inline preview too; SegmentedControl's chosen pill holds 3:1; phase 2's guest files are `f81623f0c`'s. Added: a `pnpm size` line for the workspace shell's CSS (its first load and every stylesheet the shell route imports statically), so CSS that moves into a route chunk can't slip past the gate again.

Decisions 11 to 14 and the AC-4 amendment were accepted by the owner and the coordinator on 12 Nov. Decision 16 is the owner's, 13 Nov.

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

All of `apps/web/dist/assets`, gzipped, grew a little in both JavaScript and CSS. **AC-9 is not met in full**: the hosted form's JavaScript (+50 B) and CSS (+70 B), the signature chunk (+60 B), the booking page's JavaScript (+14 B), the picture chunk (+10 B) and the notice sheet (+6 B) grew; first load JavaScript and CSS shrank and the booking page's CSS held. Part of the JavaScript is noise: a changed chunk's content hash changes the import strings of every chunk that loads it, and about a hundred route chunks moved by 10 to 14 B each with no code change. The real growth is the review's accessibility fixes (the accent-text edges on checked controls, a pressed fill on every button, the restored field box), the checkbox's drawn tick and Button's `soft` look, less the retired tokens (about 130 B off every page's stylesheet).

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

`node packages/ui/scripts/part-cost.ts --tier 1 --against f81623f0c` before the design system review's fixes (bytes, gzipped). On the tier's tip after them (1bed2bd46): CSS 16,077 → 17,221 and JS 24,019 → 24,076, **3% more**.

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

**AC-8 is not met for tier 1: the touched folders cost 3% more, not 30% less.** Why: tier 1 kept every behaviour (AC-3), and the prototype adds motion and states the library didn't draw: the drawn tick, the switch's stretch and overshoot, the slider's value bubble, RecordChipList's hover spring, the link chip's wash. The cuts that were available were taken (one rule per hue through custom properties, the stack fan and the tooltip arrow dropped, dead focus halos, folded duplicates). The atoms are small and mostly unique code; there is little duplicate left in them to remove. Where phase 1 can cut a lot is tier 2 and 3, whose folded parts duplicate whole components (Table, SampleTable and DataGrid; four bars and FloatingBar; Stats, RecordStats, TileGrid and Card), and in retiring legacy tokens every page loads. The owner decided on 12 Nov to measure the built pages per phase instead (decision 15, AC-8 as amended).

`pnpm size` on the tier 1 tip against the base:

| Line | Base | Tier 1 | Budget now |
|---|---|---|---|
| First load JavaScript | 296.64 kB | 296.61 kB | 296.7 kB (was 300) |
| First load CSS | 7.86 kB | 7.79 kB | 7.8 kB (was 40) |
| Hosted form JavaScript | 205.91 kB | 205.96 kB | 206 kB (was 223) |
| Hosted form CSS | 18.57 kB | 18.64 kB | 18.7 kB (was 18.8) |
| Form step layouts, lazy | 5.75 kB | 5.75 kB | 5.8 kB (was 10) |
| Form signature and ranking, lazy | 6.25 kB | 6.31 kB | 6.4 kB (was 14) |
| Booking page JavaScript | 188.89 kB | 188.90 kB | 189 kB (was 230) |
| Booking page CSS | 19.37 kB | 19.37 kB | 19.4 kB (was 19.5) |
| Media block chunk | 1.14 kB | 1.14 kB | 1.2 kB (was 1.5) |
| Picture and gallery chunk | 1.67 kB | 1.68 kB | 1.7 kB (was 2) |
| Next times chunk | 1.37 kB | 1.37 kB | 1.4 kB (was 1.5) |
| Notice sheet chunk | 463 B | 469 B | 500 B (was 800) |

All of `apps/web/dist/assets`, gzipped: JavaScript 2,169,429 to 2,170,195 B, CSS 149,413 to 150,063 B. **AC-9 is not met in full**: the hosted form's JavaScript (+40 B), its CSS (+10 B), the signature chunk (+50 B) and the notice sheet (+2 B) grew, and so did the totals. Part of the JavaScript is noise: a changed chunk's content hash changes the import strings of every chunk that loads it, and about a hundred route chunks moved by 10 to 14 B each with no code change. The real growth is the checkbox's tick wrapper (about 20 B) and Button's `soft` look. The CSS totals grew by the new motion above, less the retired tokens (130 B off every page's first load).

### Tier 2 after

Built in three batches (2a fields and pickers, 2b overlays and navigation, 2c feedback and layout), each reviewed by `design-system-guardian` and fixed. `node packages/ui/scripts/part-cost.ts --tier 2 --against 997da74b1` (bytes, gzipped, reporting only since decision 15):

| Batch | CSS before → after | JS before → after | Change |
|---|---|---|---|
| 2a (18 folders) | 11,327 → 12,496 | 27,217 → 27,299 | 3.2% |
| 2b (10 folders) | 7,333 → 7,946 | 9,344 → 9,342 | 3.7% |
| 2c (17 folders) | 10,084 → 10,532 | 19,083 → 19,156 | 1.8% |
| **Tier 2 (45 folders)** | **28,744 → 31,045** | **55,644 → 55,797** | **2.9%** |

**Duplicates folded away.** The folded parts that already rendered their replacer stayed so (CurrencyPicker, DateNav and FileIcon render Select, DatePicker and Icon; InfoTip renders Popover; SocialLinksEditor renders SocialLinks' parts; none keeps CSS of its own). BulkActionBar and SaveBar now render one `FloatingBarGroup` instead of their own copies of its rules: -68 B and -48 B, against +167 B in FloatingBar for the group and the prototype's toast motion. A shared stats part for Stats and RecordStats under Card was built and measured: the three folders came to +56 B, and a page using either would have loaded both layouts (about +0.6 to +0.9 kB), so each keeps its own module (decision 14). Stepper is a quantity control the prototype names in Steps' `replaces` only, and keeps its look. **The cuts the first draft expected from tier 2's duplicates did not appear**: most of the folded molecules were already thin, and the heavy duplicates are tier 3's (Table, SampleTable and DataGrid; the week calendars).

`pnpm size` on the tier 2 tip (6f4cf5a2e) against tier 1's tip (the phase's base in parentheses):

| Line | Tier 1 (base) | Tier 2 | Change | Budget now |
|---|---|---|---|---|
| First load JavaScript | 296.61 kB (296.64) | 296.64 kB | +30 B | 297.2 kB |
| First load CSS | 7.79 kB (7.86) | 7.80 kB | +10 B | 8.3 kB |
| Hosted form JavaScript | 205.96 kB (205.91) | 206.00 kB | +40 B | 206.5 kB |
| Hosted form CSS | 18.64 kB (18.57) | 19.24 kB | **+600 B** | 19.8 kB (was 19.2) |
| Form step layouts, lazy | 5.75 kB | 5.74 kB | -10 B | 6.3 kB |
| Form signature and ranking, lazy | 6.31 kB (6.25) | 6.32 kB | +10 B | 6.9 kB |
| Booking page JavaScript | 188.90 kB (188.89) | 188.89 kB | -10 B | 189.4 kB |
| Booking page CSS | 19.37 kB | 19.43 kB | **+60 B** | 20 kB (was 19.9) |
| Media block chunk | 1.14 kB | 1.13 kB | -10 B | 1.7 kB |
| Picture and gallery chunk | 1.68 kB (1.67) | 1.68 kB | 0 | 2.2 kB |
| Next times chunk | 1.37 kB | 1.37 kB | 0 | 1.9 kB |
| Notice sheet chunk | 469 B (463) | 466 B | -3 B | 1 kB |

**AC-8 is not met by two lines.** The hosted form's CSS grew 600 B (670 B over the phase's base) and the booking page's 60 B. The hosted form carries Field, Select, FieldLabel, FieldError, ChoiceChips, PhoneField and Popover in its first load: the prototype's filled field (a fill that deepens, the accent edge and ring when typed in, the large and search looks, a read only ring), Select's menu rows, pressed and chevron states and phone code chip, and the type mapping the card needs to keep its labels at body size. Part costs: Select +296 B, Field +165 B, Button's field box and ring fade, FormParts' mapping. A trim that scoped Select's open look away from its inline, prefix and cell variants saved nothing once gzipped and broke the invalid edge, so it was undone. The first load JavaScript (+30 B) and the hosted form's JavaScript (+40 B) are at the edge of content-hash noise (`Field`'s two new options and `FloatingBarGroup`). The budgets follow AC-10 (measurement plus 0.5 kB); whether the hosted form pays 0.6 kB for the filled field, or the form's controls get a lighter public variant, is the owner's call.

Legacy tokens: tier 2's 45 folders no longer use any "Phase 1" token, but every one of them still has users in tier 3 or phase 2 parts (`shadow-focus` 27 files, `shadow-focus-inset` 22, `size-chip` 20 and so on), so none leaves `legacy.json` in this tier.

### Tier 2 after the coordinator's ruling (13 Nov, superseded by "One look everywhere" below)

The coordinator sent part of tier 2 back: no page's first load may grow (AC-8) and guest pages are not phase 1's to restyle; tier 1 had broken the brand colour on the guest primary button (Button primary read `--primary`, which the guest roots don't remap); SegmentedControl's chosen pill was 1.1:1 on its track; two review stories were missing; phase 2's guest files carried tier 2 edits. Decision 16 answers the first three: every part a guest page draws is back on its shipped module there, so the guest primary button reads `--accent` again and the brand remap reaches it (HostedForm and BookingFrame `Branded` pass). SegmentedControl's app look draws its pill's edge in `control-border` (about 4:1 on the track in both themes, story `ChosenEdge`). Sentence `MenuOpen` and Stats `CardsNarrow` are the missing stories. `FormParts.module.css`, `MenuList.module.css`, CheckboxRow's and RadioRows' modules are `f81623f0c`'s again.

`pnpm size` on 43f8b50c1 (the rulings, tier 3a set aside) against the phase base and the tier 2 tip:

| Line | Base (f81623f0c) | Tier 2 (6f4cf5a2e) | After the ruling | Against the base | Budget |
|---|---|---|---|---|---|
| First load JavaScript | 296.64 kB | 296.64 kB | 296.69 kB | **+50 B** | 297.2 kB |
| First load CSS | 7.86 kB | 7.80 kB | 7.83 kB | -30 B | 8.3 kB |
| Hosted form JavaScript | 205.91 kB | 206.00 kB | 206.02 kB | **+110 B** | 206.5 kB |
| Hosted form CSS | 18.57 kB | 19.24 kB | 18.54 kB | -30 B | 19.1 kB (was 19.8) |
| Form step layouts, lazy | 5.75 kB | 5.74 kB | 5.75 kB | 0 | 6.3 kB |
| Form signature and ranking, lazy | 6.25 kB | 6.32 kB | 6.25 kB | 0 | 6.9 kB |
| Booking page JavaScript | 188.89 kB | 188.89 kB | 188.91 kB | +20 B | 189.4 kB |
| Booking page CSS | 19.37 kB | 19.43 kB | 19.34 kB | -30 B | 19.9 kB (was 20) |
| Media block chunk | 1.14 kB | 1.13 kB | 1.14 kB | 0 | 1.7 kB |
| Picture and gallery chunk | 1.67 kB | 1.68 kB | 1.68 kB | +10 B | 2.2 kB |
| Next times chunk | 1.37 kB | 1.37 kB | 1.37 kB | 0 | 1.9 kB |
| Notice sheet chunk | 463 B | 466 B | 466 B | +3 B | 1 kB |

Every CSS line is back at or under the base. Two JavaScript lines are not, and are left for the coordinator: the first load's +50 B is decision 16's loader (the router's preload map names the app look's stylesheet, about 48 B; the rest of the entry chunk is unchanged), and the hosted form's +110 B is Field's tier 2 additions (about 58 B: `isTabular` and `aria-keyshortcuts`, both owed to phase 2, and the counter's `data-full`), Checkbox's tick holder from tier 1 (about 19 B), and content-hash noise across the form's twenty chunks (1 to 6 B each). The guest stylesheets now differ from the base only by a few replaced token reads in the shipped Checkbox, Radio, Switch, Kbd and Button (tokens tier 1 retired), FileItem's and FileDrop's holder rules, and the token sheet, smaller by the retired tokens.

### Tier 3a after (13 Nov)

Batch 3a (records and data): DataGrid with Table and SampleTable, Board, Chart with BarStrip, RecordHeader, RecordPanel with RecordLayout and RelatedRecords (look only; phase 3's lane owns its behaviour), ActivityFeed (BookingChanges is guest only and keeps its look), CommentThread with CommentComposer, NoteList, TaskList, NotificationList, CommandPalette with ShortcutHelp. No guest page draws any of them, so none needs an app look. Reviewed by `design-system-guardian` and `state-performance-reviewer`; their findings are fixed in the tier's commit, except those listed as open below.

`node packages/ui/scripts/part-cost.ts --tier 3a --against ca02b127f` (bytes, gzipped, reporting only):

| Folder | CSS before → after | JS before → after | Change |
|---|---|---|---|
| DataGrid | 3793 → 3902 | 19841 → 19841 | 0.5% |
| Table | 2198 → 2297 | 2221 → 2221 | 2.2% |
| SampleTable | 416 → 421 | 312 → 312 | 0.7% |
| Board | 1384 → 1736 | 5375 → 5375 | 5.2% |
| Chart | 1152 → 1355 | 4214 → 4214 | 3.8% |
| BarStrip | 503 → 603 | 547 → 547 | 9.5% |
| RecordHeader | 461 → 465 | 818 → 818 | 0.3% |
| RecordPanel | 255 → 252 | 1480 → 1480 | -0.2% |
| RecordLayout | 348 → 350 | 1069 → 1069 | 0.1% |
| RelatedRecords | 381 → 399 | 2403 → 2403 | 0.6% |
| ActivityFeed | 1251 → 1393 | 6451 → 6459 | 1.9% |
| BookingChanges | 730 → 730 | 3170 → 3170 | 0% |
| CommentThread | 845 → 1035 | 2958 → 2958 | 5% |
| CommentComposer | 152 → 164 | 3038 → 3038 | 0.4% |
| NoteList | 602 → 815 | 1699 → 1699 | 9.3% |
| TaskList | 800 → 950 | 2836 → 2836 | 4.1% |
| NotificationList | 588 → 776 | 2441 → 2441 | 6.2% |
| CommandPalette | 218 → 258 | 1976 → 2007 | 3.2% |
| ShortcutHelp | 180 → 255 | 602 → 602 | 9.6% |
| **Tier 3a (19 folders)** | **16,257 → 18,156** | **63,451 → 63,490** | **2.4%** |

**The duplicates did not fold into fewer bytes.** Table, SampleTable and DataGrid share a look, not an engine: DataGrid is a virtual grid of records (its own rows, cells, ranges and editors), Table a React Aria table of a few settings rows with a dozen variants, SampleTable a picture that takes no focus. None can draw another without changing what it is (AC-3), and one component may not reach into another's module (decision 14), so each keeps its module, now written from the same prototype rules; their overlap is listed in Table's and SampleTable's READMEs and leaves with them. DataGrid and Table grew about 100 B each (the strip's rounding, the resize edge's states, the summary line), SampleTable 5 B. The tier as a whole is 1.9 kB heavier in CSS, all of it in lazy route chunks: the prototype draws more states (card hover and press, the menu that waits for hover, the fold's motion) than the library did.

`pnpm size` on be4424bd9 (tier 3a's tip), against the phase base and the ruling's tip:

| Line | Base (f81623f0c) | Ruling (43f8b50c1) | Tier 3a | Against the base | Budget |
|---|---|---|---|---|---|
| First load JavaScript | 296.64 kB | 296.69 kB | 296.71 kB | **+70 B** | 297.2 kB |
| First load CSS | 7.86 kB | 7.83 kB | 7.83 kB | -30 B | 8.3 kB |
| Hosted form JavaScript | 205.91 kB | 206.02 kB | 206.02 kB | **+110 B** | 206.5 kB |
| Hosted form CSS | 18.57 kB | 18.54 kB | 18.54 kB | -30 B | 19.1 kB |
| Form step layouts, lazy | 5.75 kB | 5.75 kB | 5.75 kB | 0 | 6.3 kB |
| Form signature and ranking, lazy | 6.25 kB | 6.25 kB | 6.25 kB | 0 | 6.9 kB |
| Booking page JavaScript | 188.89 kB | 188.91 kB | 188.91 kB | +20 B | 189.4 kB |
| Booking page CSS | 19.37 kB | 19.34 kB | 19.34 kB | -30 B | 19.9 kB |
| Media block chunk | 1.14 kB | 1.14 kB | 1.14 kB | 0 | 1.7 kB |
| Picture and gallery chunk | 1.67 kB | 1.68 kB | 1.68 kB | +10 B | 2.2 kB |
| Next times chunk | 1.37 kB | 1.37 kB | 1.37 kB | 0 | 1.9 kB |
| Notice sheet chunk | 463 B | 466 B | 466 B | +3 B | 1 kB |

Tier 3a moves only the first load's JavaScript, by 18 B in the entry chunk (the router's preload map naming its parts' new stylesheets; none of the tier is in the first load). Open for the coordinator: the first load's JavaScript (+70 B: decision 16's loader and preload names) and the hosted form's (+110 B, as recorded above).

Open from the reviews: the Board column taking a drop draws the prototype's `accent-border` ring, about 1.3:1 on its shell in light (house rule 7: the owner's call, not changed quietly); Chart's tooltip repeats Tooltip's look until a "placed at a point" Tooltip variant exists; the prototype's Count on a Board column is Badge, which the head would have to render (screen phase); the artifact's previews draw at public scale, so they show the shipped look of decision 16's parts until the artifact frame sets `data-scale="app"` for app cards; a cold-loaded 404 (no layout) shows the shipped look at app density.

### One look everywhere (13 Nov)

Decision 16 as the owner chose it: the 32 parts the first answer had split are back to one module each, with the prototype's look (tier 2's modules, 86fe2f860), the app looks and their loader, layer, tests and lint allowance gone. On top of tier 2: Button's primary takes a guest page's accent; Select turns the trigger's last child (its chevron) instead of a holder span, so its markup stays as shipped; SegmentedControl's pill edge is control-border; Badge's accent count is the prototype's blue tag tint (`--tag-blue-bg`, `--tag-blue-text`), since its accent tint read 3.3:1 on the guest menu in dark and phase 2's MenuList may not carry a remap for it; LinkPage's times hold draws its action at the touch size Button draws now; the Board column taking a drop draws an `accent-text` ring (3:1 and more on its shell in both themes, the coordinator's call).

`pnpm size` on the tip, against the phase base (kB unless marked):

| Line | Base (f81623f0c) | Now | Change | Budget |
|---|---|---|---|---|
| First load JavaScript | 296.64 | 296.60 | -40 B | 297.2 |
| First load CSS | 7.86 | 7.87 | +10 B | 8.3 |
| Workspace shell CSS (new) | 34.61 | 35.87 | +1.26 kB | 36.4 |
| Hosted form JavaScript | 205.91 | 206.02 | +110 B | 206.5 |
| Hosted form CSS | 18.57 | 19.28 | **+710 B** | 19.8 |
| Form step layouts | 5.75 | 5.74 | -10 B | 6.3 |
| Form signature and ranking | 6.25 | 6.32 | +70 B | 6.9 |
| Booking page JavaScript | 188.89 | 188.89 | 0 | 189.4 |
| Booking page CSS | 19.37 | 19.50 | **+130 B** | 20 |
| Media, picture, times, notice | 1.14, 1.67, 1.37, 0.463 | 1.14, 1.68, 1.37, 0.465 | within 10 B | as before |

**AC-8 is not met on the guest pages.** JavaScript and CSS together: the hosted form +820 B, the booking page +130 B. Per stylesheet (gzipped, level 9, against the base): the hosted form's Select +311, Field +242, Button with Icon, Kbd and ProviderMark (`client`) +137 (about 70 of it the guest accent for the primary button), Checkbox +95, Radio +43, Popover +14, ChoiceChips +11, FieldLabel -15, the token sheet -131 (retired tokens); its JavaScript +102 by the same measure, Field's tier 2 props (`isTabular`, `aria-keyshortcuts`, the counter's `data-full`, about 64 B, which phase 2 uses) and Checkbox's tick holder (about 16 B), the rest content-hash noise. The booking page's `client` +137, SocialLinks +52, Tooltip +46, Avatar +26, SegmentedControl +11, StatusDot +8, Callout -20, the token sheet -131. Tried: the shorter brand chain (three names, LinkPage and GuestLook remapping `--primary` themselves, 27 B), Select's chevron without a holder (no span, no class), Badge's accent tint on tag tokens. Not tried in this pass: rewriting Field's and Select's prototype rules for size (variants a form never draws still ship in the module). Savings that live in phase 2's files, for the merge: FormParts' `.card` remaps `--shadow-focus` and the night template's `--form-focus`, which the ported Field, Select, Checkbox and Radio no longer read (only PhoneField and FormParts itself still do), and `.card` should remap `--text-body-sm` and `--text-body-sm-strong` to the body size, so the form's labels, hints and errors read at 16px again (tier 2 did it in FormParts; the file is back at the base, so they read at the 13px step for now).

App routes, CSS and JavaScript gzipped (default level), index.html plus the route's static imports, `scratchpad/routecss.mjs`:

| Route | CSS base → now | JS base → now |
|---|---|---|
| sign-in | 26,735 → 27,558 (+823) | 415,059 → 415,057 (-2) |
| w.$slug (the shell) | 34,809 → 36,077 (+1,268) | 472,242 → 472,283 (+41) |
| w.$slug.index | 28,116 → 29,119 (+1,003) | 449,144 → 449,147 (+3) |
| w.$slug.objects.$object | 29,811 → 30,855 (+1,044) | 457,049 → 457,070 (+21) |

That growth is the prototype look's own rules and nothing else: the shell's +1,268 B spreads over 28 parts' modules (Field +249, CodeInput +154, `client` +132, EmptyState +131, Menu +121, Breadcrumbs +98, Checkbox +96 and smaller ones), against the token sheet's -126.

### Trim, then accept the rest (the owner, 13 Nov)

The owner's decision on phase 1's cost: one focused trim round, then accept what is left as debt that the screen phases pay back. The round went at the biggest causes (Field, Select, CodeInput, EmptyState), rewriting their rules smaller without changing what they draw. Gzip had already folded nearly all of the repetition: Field 2171 -> 2168 B, Select 1885 -> 1887 and CodeInput 1008 -> 1012 B (gzipped, Lightning CSS minified, level 9), and the Field and Select rewrites raised selector weights enough to change which state wins, so those were reverted. EmptyState's well is scoped to the block layouts instead of drawn and undone on a row: 744 -> 732 B, kept (bad345851). What these parts cost is the prototype's look itself (Field's filled box with its hover, focus, invalid and search states; Select's menu rows and phone code chip), not slack.

### Load debt

What phase 1 leaves over `f81623f0c`, JavaScript and CSS together, gzipped, measured on bad345851 (the guest pages by `pnpm size`, the app routes by `scratchpad/routecss.mjs`: index.html plus the route's static imports):

| Page | JavaScript | CSS | Over the base |
|---|---|---|---|
| Hosted form | 205.91 -> 206.02 kB (+110 B) | 18.57 -> 19.28 kB (+710 B) | **+820 B** |
| Booking page | 188.89 -> 188.89 kB (0) | 19.37 -> 19.50 kB (+130 B) | **+130 B** |
| Sign in | 415,059 -> 415,057 B (-2) | 26,735 -> 27,547 B (+812) | **+810 B** |
| Workspace shell (w.$slug) | 472,242 -> 472,272 B (+30) | 34,809 -> 36,066 B (+1,257) | **+1,287 B** |
| Workspace index | 449,144 -> 449,145 B (+1) | 28,116 -> 29,108 B (+992) | **+993 B** |
| An object's records | 457,049 -> 457,067 B (+18) | 29,811 -> 30,844 B (+1,033) | **+1,051 B** |

**The rule**: each screen phase (4 to 9) that rewrites one of these pages' screens pays that page's debt back before it lands: the page's line ends at or under its `f81623f0c` figure above, measured the same way, as well as meeting its own gate. The debt is the prototype look's own rules (the per stylesheet causes are in "One look everywhere" above), so the screen phases pay it the way the owner's 30% goal intended: with the duplicates their rewrites fold away, not by trimming the look again. `.size-limit.js` holds the hosted form's and booking page's CSS at the measurement plus 0.5 kB (19.8 and 20 kB) and the workspace shell's CSS at 36.4 kB until then.

### Merge notes (phase 1 + 2)

Things phase 1 can't do because they live in phase 2's files, for the merge to pick up:
- FormParts' `.card` remaps `--shadow-focus` and the night template's `--form-focus`; the ported Field, Select, Checkbox and Radio no longer read them (only PhoneField and FormParts itself do), so the remaps are a saving once PhoneField is ported.
- FormParts' `.card` should remap `--text-body-sm` and `--text-body-sm-strong` to the body size, so the hosted form's labels, hints and errors read at 16px again (tier 2 did it there; the file is back at the base, and they read at the 13px step meanwhile).
- BookingReceipt names no accent, so the manage booking page (a receipt with no BookingFrame round it) draws the app's ink primary; its root's accent name belongs in Button's primary chain (`--form-accent`, `--frame-accent`, `--look-accent`), or it remaps `--primary` itself as LinkPage and GuestLook do.
- The guest menu's accent count is now the prototype's blue tag tint (`--tag-blue-bg`, `--tag-blue-text`), not the menu's brand fill; MenuList may want its own pill, owed to phase 8.
- Field's `isTabular`, `aria-keyshortcuts` and the counter's `data-full` (about 64 B of the hosted form's JavaScript) are phase 2's to account for, since its NumberField and SearchField use them.
