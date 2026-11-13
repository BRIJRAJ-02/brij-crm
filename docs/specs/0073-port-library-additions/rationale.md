# 0073 rationale: port phase 2, library additions

## Context

The prototype (`design/timefix-design-system/src/components/`) was drawn from scratch, so it names its parts by what they are in the artifact, not by what the real library calls them. Its READMEs say so themselves: each one ends with a **Replaces** line listing the real parts it stands for (Dialog replaces Modal and ModalTrigger, Progress replaces ProgressBar and Meter, HostedForm replaces the whole `public-form` folder). Of the 27 parts only the prototype has, most are therefore renames, consolidations or screens, not missing components. The owner asked for fewer duplicates (9 November: "fewer duplicates"; 25 October: "ship less, ship quality"), so the job is to map first and build as little as possible.

Two facts shaped every call:
- **The first load has no room.** On the base commit (f81623f0c) the app's first load is 296.64 kB of JavaScript against a 300 kB budget, the booking page's CSS is 19.37 kB against 19.5 kB, and the hosted form's CSS is 18.57 kB against 18.8 kB. A library part a public page already draws (AvatarStack is in the booking page's first load, Field in the hosted form's) cannot gain even a few hundred bytes of CSS.
- **Phase 1 is restyling the 72 shared parts at the same time**, in the same package. Field, Select, Avatar, Button, Kbd, Tooltip and the rest are its files. A change here that edits them invites a merge fight and may be undone by the restyle.

## Options considered

### Option 1: Build all 27 as the prototype names them

Port each folder into `packages/ui` under its prototype name, and retire the old names later.

- **Pros**: the screens in phases 4 to 9 copy the prototype's JSX unchanged.
- **Cons**: 27 parts, of which about 19 duplicate something that ships today. Two Dialogs, two Toast systems and two hosted forms would live side by side until a later clean up that history says never comes. It breaks the house rule "no new CSS for an element that already exists", and it doubles the CSS a public page might pull in.

### Option 2: Map first, keep the real names, build only the gaps (chosen)

Every part is (a) already here, (b) a variant, prop or thin wrapper on something here, or (c) genuinely new. Screens in later phases use the real names from the mapping table; each (a) part's missing behaviour is added as a variant by the phase that needs it.

- **Pros**: two new parts instead of 27. No duplicate CSS. The public pages' budgets are untouched. Phase 1's files are left alone, apart from a separate file beside AvatarStack.
- **Cons**: an engineer porting a screen translates names (Dialog to Modal) using the table. That is a lookup, not a rewrite: props were compared for each row and the real parts already take what the screens send, or the gap is listed below.

### Option 3: Rename the real parts to the prototype's names

Rename Modal to Dialog, ProgressBar to Progress and so on, so later phases copy JSX unchanged.

- **Pros**: one name everywhere, matching the artifact.
- **Cons**: hundreds of call sites in `apps/web` change for no user benefit, during the same weeks phase 1 restyles those parts. The brief for this phase says "rename or alias nothing". A rename can come later, once, after the port, if the owner wants the artifact's names.

## Rationale

Option 2 is the house order (reuse, then variant, then new) applied part by part, and it is the only option that keeps the first load where it is. The six (b) parts are built as thin wrappers or props for two reasons: a wrapper in its own file keeps phase 1's files untouched, and it keeps a variant's code and CSS out of a public page that draws the base part. The two (c) parts are new because nothing in the library composes them: ShareSheet is a dialog with a fixed set of share ways that five screens build by hand today, and AIAssist is an AI conversation surface the real app does not have at all.

## The mapping, with the evidence

| Part | Map | Why |
|---|---|---|
| AIAssist | (c) | No AI surface exists: no `ai` tone use, no streaming text, no thinking line (`grep` for StreamText, ThinkingLine, ShimmerText, AIMark: none). The `ai` colour token exists (0071). New module on a lazy subpath |
| AttributeField | (a) | Its README replaces AttributeDisplay, AttributeEditor and `fields/*`, which are the real field set; AttributeList already edits a value in place on a record |
| BookingFlow | (a) | Replaces BookingFrame, MonthTiles, SlotList, BookingDetails, BookingReceipt: all in `@crm/ui/public-booking` |
| CalendarConnections | (a) | CalendarList lists accounts and calendars with per row menus; `apps/web` `settings/CalendarScreen` and `ConnectCalendarDialog` compose the connect and reconnect flow |
| Checklist | (a) | Replaces SetupChecklist and ReadyPanel, both exported |
| ColorPicker | (a) | Replaces HuePicker and AccentPicker, both exported; ContrastBadge carries the readability line |
| ComboBox | (a) | Replaces ReferencePicker, the RecordReference editor and SuggestionList; ReferencePicker searches through a virtualised Menu over a ListSource, and `@crm/data`'s `createRecordSearch` debounces (150 ms) and aborts |
| Dialog | (a) | Replaces Modal and ModalTrigger; Modal already has `confirm` (the ConfirmDialog pattern), `form` and `window`; InviteRows is the invite form |
| Drawer | (b) | Modal `variant="drawer"` and Panel exist, but the guard against losing typed changes lives in screen code (`apps/web/src/features/menus/drawer.tsx`, used by six drawers). Moving the guard into Modal as `isDirty` is a prop, not a part |
| FilterBar | (a) | Replaces FilterChip, FilterBuilder, ConditionRow, SortBuilder, ViewSettings, all exported; FilterBuilder already has and/or and nested groups |
| HostedForm | (a) | Replaces the `public-form` folder piece by piece |
| LinkEditor | (a) | A screen, not a part: its README lists the editor's block rows, RowOrder and the phone preview, which are LinkList, `LinkList/RowOrder`, SocialLinksEditor and LinkPage, composed in `apps/web/features/link-page` |
| Logo | (a) | Replaces `ProductLogo`, the artwork UiProvider hands the library, so the SVG files stay in the app |
| MeetingList | (a) | Replaces MeetingCard and BookingList, both exported |
| MenuPage | (a) | Replaces MenuList and ItemSheet, plus the `public-menu` entry |
| Motion | (b) | NumberPop, TextSwap, SuccessCheck, Spinner, Skeleton and Reveal exist. Of the prototype's extras: TextMorph is TextSwap (one swap for every label change, fewer kinds of motion); IconSwap stays inside its owners (CopyButton swaps copy to check already); Collapse is Disclosure's job; ShimmerText and ThinkingLine belong to AIAssist (batch 3). Two are worth having for everyone: SoftText, a value recomputed in place, and DropIn, a row arriving in a list (today BookingList, SettingsLayout, MatchCalendar and ReadyPanel each keep their own row entrance keyframes). They become TextSwap `soft` and Reveal `drop` |
| NumberField | (b) | 48 numeric Fields in `apps/web` and `packages/ui` hand roll `inputMode="decimal"`, parsing and a unit suffix. A wrapper over Field gives them one parser and arrow key stepping without new CSS |
| Onboarding | (a) | Replaces WorkspacePreview and the first run screens (`apps/web` `welcome`) |
| Presence | (b) | AvatarStack and RemoteCursor exist. Presence needs status dots, a tooltip per person and a pointer variant |
| Progress | (a) | Replaces ProgressBar (with `isIndeterminate`) and Meter |
| RichTextEditor | (a) | Replaces the `editor` folder, which is already its own lazy entry |
| SearchField | (b) | Field `variant="search"` exists; every caller adds its own clear button and nobody debounces |
| ShareSheet | (c) | Nothing composes the share ways: the forms' Live dialog, the link page's share dialog, the booking pages' Share menu and Copy link buttons are each screen code. Insights' ShareDialog is a different thing (named, revocable links). QrSheet is a print layout, not a share dialog |
| Text | (a) | Replaces TruncatedText, RelativeTime, Separator, VisuallyHidden, Path, all exported atoms |
| TimeField | (b) | HoursEditor builds its time list from Select privately; Field `temporal` covers a typed time. A `TimeSelect` wrapper shares the list |
| Toast | (a) | Replaces ToastRegion, createToasts and useToasts |
| VenuePage | (a) | Replaces the business public page, built on BusinessPage and BusinessGallery |

## Calls the prototype leaves open, and the picks

1. **Wrapper or prop for SearchField, NumberField and TimeSelect?** Options: (i) new props on Field and Select, (ii) thin wrappers in their own folders, (iii) React Aria's NumberField, SearchField and TimeField as the prototype does. Pick (ii). Field and Select are phase 1's files; a wrapper adds no CSS and cannot collide. React Aria's NumberField would bring its own number parser chunk and a second input markup that phase 1 would then have to restyle twice. Industry standard (Radix, Spectrum) puts number and search inputs as their own named components, which a wrapper matches for screens.
2. **NumberField parsing.** Options: `@internationalized/number`'s parser (what React Aria uses), or a small parser over `Intl.NumberFormat` parts. Pick the small parser: it reads the locale's group and decimal marks from `formatToParts` through `memoIntl`, accepts both the locale's marks and plain digits, and refuses anything else, which covers every locale the app formats in. It is unit tested in Node.
3. **The dirty guard: nudge or ask?** The prototype shakes the footer and says "Save or discard first". The real app asks with a confirm (the owner, 21 October 2026: ending actions ask first in a Modal; SaveBar asks before Discard). Pick the confirm, with SaveBar's words, so the app has one way to protect typed work.
4. **PresenceGroup's place.** Options: props on AvatarStack, or a wrapper beside it. AvatarStack is in the booking page's first load, whose CSS budget has 130 bytes of room, and Avatar is phase 1's file. Pick a wrapper file in the Avatar folder with its own stylesheet (the existing exception for a variant kept out of a public page's budget), composing Avatar, StatusDot's colours and Tooltip.
5. **Presence at 1,000 viewers.** The prototype's label lists every name. Pick a cap: the label names at most `max` people, then "and n others"; only `max` avatars and one "+n" are drawn. The screen sorts who comes first (active before idle, then most recent), since only it knows.
6. **The pointer's arrow.** Options: a Lucide `mouse-pointer-2` icon (about 90 bytes on every page's icon registry, per `packages/ui/AGENTS.md`), or a CSS shape. Pick the CSS shape (`clip-path` polygon, sized by tokens), so the first load does not grow.
7. **SoftText's width easing.** The prototype measures both widths in a layout effect and animates `width`. Pick the CSS only crossfade in one grid cell (the wider value holds the width while they cross, then it settles), the same technique TextSwap already uses, so it costs no layout reads.
8. **The HTML gate.** No file in `apps/` or `packages/` sets `dangerouslySetInnerHTML` today, and no sanitiser exists. Options: add DOMPurify now, or refuse HTML injection by lint and add a sanitiser only when a part truly needs HTML. Pick the lint rule now (refusing `dangerouslySetInnerHTML`, assignments to `innerHTML` and `outerHTML`, and `insertAdjacentHTML`), and DOMPurify through the vendor wrapper rule the day a part needs it, with its test. RichTextEditor renders through its Tiptap schema and HostedForm renders text, so neither needs one.
9. **NumberField's step buttons.** The prototype shows them by default. Pick off by default, on with `showSteppers`: about fifty numeric fields in the app are settings typed once, the buttons cannot leave the tab order without a Button prop phase 1 owns, so on by default would add two tab stops to each. Stepper stays the guest pages' boxless count.
10. **Reduced motion.** The prototype stops everything under reduced motion. The house rule keeps fades and drops movement, so TextSwap `soft` keeps its cross fade, Reveal `drop` keeps a fade with no height or rise, and the idle pointer keeps its fade (the design system review, 12 Nov).
11. **Budgets.** Tighten every line to the measurement plus at most 0.5 kB, as the owner asked ("cut it a lot"). Lines that already sit within 0.5 kB stay where they are.

## Gaps in the (a) parts, by the phase that closes them

Found while mapping; each is closed as a variant of the real part (AC-7303), never a second part.

| Part | Gap against its prototype README | Phase |
|---|---|---|
| Toast | Banner stacking (older toasts step back), hover spread | 1 |
| Text | RelativeTime's tick over crossfades through TextSwap `soft` | 1 |
| Dialog | StepDialog (a two to four step wizard in one card, height easing) as a Modal `steps` prop | 4 |
| Checklist | Done steps glide to their new place | 4 |
| AttributeField | AI filled sparkle (with AIAssist's `ai` tone) | 5 |
| ComboBox | "No matches · Create" as a selectable row where `onCreate` is given (check the existing create row first) | 5 |
| FilterBar | The field, operator, value walk in one popover that eases to each step's height | 5 |
| MeetingList | `hasMore` and `onLoadMore` paging (AC-7323), the "Cancelled · Undo" fold | 6 |
| CalendarConnections | Per calendar checkboxes (Conflicts, On my week, Log to CRM) | 6 |
| ColorPicker | AccentPicker `use="ground"` and `use="plain"`, a `contrastBetween` helper beside ContrastBadge | 7, 8 |
| HostedForm | Form languages beyond English, if the owner keeps them | 7 |
| Progress | Meter `warnAt` and `dangerAt` thresholds | 9 |

## Evidence

### Base measurements (f81623f0c, `pnpm size`, gzipped)

| Line | Size | Budget |
|---|---|---|
| First load JavaScript | 296.64 kB | 300 kB |
| First load CSS | 7.86 kB | 40 kB |
| Hosted form JavaScript | 205.91 kB | 223 kB |
| Hosted form CSS | 18.57 kB | 18.8 kB |
| Form step layouts, lazy | 5.75 kB | 10 kB |
| Form signature and ranking, lazy | 6.25 kB | 14 kB |
| Booking page JavaScript | 188.89 kB | 230 kB |
| Booking page CSS | 19.37 kB | 19.5 kB |
| Media block chunk | 1.14 kB | 1.5 kB |
| Picture and gallery chunk | 1.67 kB | 2 kB |
| Next times chunk | 1.37 kB | 1.5 kB |
| Notice sheet chunk | 463 B | 800 B |

Which library parts sit in each first load (by their `ws-<component>` class names in the loaded files): the app's `index.html` carries Kbd only; `book.html` carries Avatar and Kbd; `form.html` carries Field, Select and Kbd. Everything else loads with its route.

The per chunk gzip sizes (750 JavaScript chunks) are kept with the batch's measurements, and the batch commit names any chunk that grew by more than 1 kB (AC-7315).

### Measurements after batch 1 (a1d94486f, `pnpm size`, gzipped)

| Line | Base | After batch 1 | New budget |
|---|---|---|---|
| First load JavaScript | 296.64 kB | 296.56 kB | 297 kB (was 300) |
| First load CSS | 7.86 kB | 7.86 kB | 8.3 kB (was 40) |
| Hosted form JavaScript | 205.91 kB | 205.91 kB | 206.4 kB (was 223) |
| Hosted form CSS | 18.57 kB | 18.57 kB | 18.8 kB (kept, within 0.5 kB) |
| Form step layouts, lazy | 5.75 kB | 5.74 kB | 6.2 kB (was 10) |
| Form signature and ranking, lazy | 6.25 kB | 6.25 kB | 6.7 kB (was 14) |
| Booking page JavaScript | 188.89 kB | 188.9 kB | 189.4 kB (was 230) |
| Booking page CSS | 19.37 kB | 19.37 kB | 19.5 kB (kept) |
| Media, picture and gallery, next times, notice sheet | 1.14, 1.67, 1.37 kB, 463 B | 1.14, 1.67, 1.37 kB, 463 B | kept (each within 0.5 kB) |

The first load's 80 byte drop is build to build variation, not a saving: no first load file changed. The first loads still hold the same library parts (`index.html` Kbd; `book.html` Avatar and Kbd; `form.html` Field, Select and Kbd), so none of the batch's code or CSS reaches a first load.

Per chunk (715 JavaScript chunks, gzipped): two grew by 100 bytes or more, none by 1 kB. The shared `Modal` chunk grew 235 B (3,507 to 3,742: the `isDirty` guard and its confirm) and the `Reveal` chunk 232 B (209 to 441: the `drop` variant). All chunks together grew 533 B. SearchField, NumberField, TimeSelect and PresenceGroup are in no chunk yet, since no screen imports them; their cost lands with the phase that adopts them, which AC-7316 measures.

### Measurements after batches 2 and 3 (88cd7b490, `pnpm size`, gzipped)

| Line | Before batch 2 (2bce699ff) | After batch 2 (0e28fbf4e) | After batch 3 and the review (88cd7b490) | Budget |
|---|---|---|---|---|
| First load JavaScript | 296.56 kB | 296.6 kB | 296.61 kB | 297 kB (kept) |
| First load CSS | 7.86 kB | 7.86 kB | 7.86 kB | 8.3 kB (kept) |
| Hosted form JavaScript | 205.91 kB | 205.91 kB | 205.9 kB | 206.4 kB (kept) |
| Hosted form CSS | 18.57 kB | 18.57 kB | 18.57 kB | 18.8 kB (kept) |
| Form step layouts, lazy | 5.74 kB | 5.74 kB | 5.74 kB | 6.2 kB (kept) |
| Form signature and ranking, lazy | 6.25 kB | 6.25 kB | 6.25 kB | 6.7 kB (kept) |
| Booking page JavaScript | 188.9 kB | 188.9 kB | 188.89 kB | 189.4 kB (kept) |
| Booking page CSS | 19.37 kB | 19.37 kB | 19.37 kB | 19.5 kB (kept) |
| Media, picture and gallery, next times, notice sheet | 1.14, 1.67, 1.37 kB, 463 B | the same | the same | kept |

Every line sits within 0.5 kB of its budget, so none is tightened. The first load JavaScript's 50 byte rise is not code: no first load module changed (the entry chunk carries none of ShareSheet's, AIAssist's, Tag's or ReadyPanel's code or words), and the entry's map of 618 lazy chunk file names re-hashed, with one renamed (`qr-png` to `qr-file`). Batch 1 measured the same kind of drift the other way (296.64 to 296.56).

Per chunk (865 JavaScript and CSS entries, gzipped, keys with their hashes stripped): none grew by 100 bytes or more. The QR helpers' 944 B chunk is the same bytes under its new name; Tag's chunk grew 65 B of JavaScript and 18 B of CSS (the `ai` tone); all chunks together shrank 28 B. ShareSheet and AIAssist are in no chunk yet, since no screen imports them; their cost lands with phases 3 and 5.

### Cost per page (measured in the merge, 13 Nov 2026)

The tables above held only `pnpm size`'s lines, which phase 2 did not move. Measured per page (`scratchpad/t3m.mjs`, gzipped bytes, each page's entry and its route's static imports), phase 2 as first built added to pages that never draw its parts, because three additions lived inside parts every page loads: Modal's `isDirty` guard (375 B of JavaScript, plus a 239 B strings chunk on the guest pages, since Modal's words imported the shared strings), Reveal's `drop` (232 B of JavaScript, 160 B of CSS) and Tag's `ai` tone (67 B of JavaScript, 20 B of CSS, 18 B of words in a chunk every booking page loads). The merge (feat/port-12, c56716ed9) made them `GuardedModal`, `RevealDrop` and `AiTag`, parts of their own that no screen imports yet.

| Page | As first built (port-2's tip against `f81623f0c`, JS / CSS) | Left in feat/port-12 (JS / CSS) |
|---|---|---|
| Hosted form | -16 / 0 | 0 / 0 |
| Booking page | +11 / 0 | 0 / 0 |
| Menu page | +841 / +160 | 0 / 0 |
| Reserve page | +612 / 0 | 0 / 0 |
| Business page | +618 / 0 | 0 / 0 |
| Public profile | +246 / +160 | 0 / 0 |
| Sign in | +23 / 0 | 0 / 0 |
| Workspace shell (w.$slug) | +402 / 0 | 0 / 0 |
| Workspace index | +402 / 0 | 0 / 0 |
| An object's records | +408 / 0 | 0 / 0 |
| Bookings list | +442 / +18 | 0 / +14 (Tag's custom property fallbacks, which carry AiTag's look) |
| Settings, an object's tab | +434 / +18 | 0 / +14 (the same) |
| Link page editor | +705 / +178 | 0 / +14 (the same) |
| Captures, links | +377 / 0 | 0 / 0 |
| Captures, a form | +436 / +18 | +17 (ReadyPanel's `invite`, ShareSheet's words) / +14 |

"Left" is the merged page against port-1's tip less what main brought through phase 0; what remains besides is content-hash noise (-18 to +29 B a page, the entry's chunk map and renamed imports). Each new part's cost lands with the screen that first draws it (phases 3, 5 and 8), on that screen's route alone.

### Calls made while building batches 2 and 3

1. **ShareSheet on ReadyPanel's share column.** The mapping said "Modal, Field `copy`, CopyButton, QrCode and Button". ReadyPanel's `share` variant already composes those, in the layout the owner approved on 5 November 2026, and the forms' live dialog already draws it in a Modal. Building the share layout again from its parts would have been a second look for one moment; reuse came first. The design system review agreed (12 November 2026).
2. **ShareSheet stays on the main entry.** A subpath of its own would only matter if a first load reached it; tree shaking keeps it with the screen that opens it, and the build test holds that. QrCode and `uqr` already travel this way.
3. **The address gate is stricter than `safeHref`.** A share goes to another device, so only absolute `http:` and `https:` pass; a path, `mailto:` or `tel:` is refused with `javascript:`, `data:` and `vbscript:`. A refused address draws one danger line and Done, and no QR code, copy, link or footer.
4. **AIAssist frameless.** The review found its own card and header duplicated Panel (whose README names the assistant) and Card, so the frame, title and Close are the host's; New question moved into the answer's row.
5. **AIAssist's answer accepts a stream.** `onAsk` may return a promise of the whole text (revealed two words a step, within 60 steps) or an async iterable of pieces (drawn once a frame), with an abort signal for Stop. A real model streams; the prototype's promise only fits a demo.
6. **Screen reader announcements.** The prototype made the streaming answer a polite live region. One always present status region says "Working on an answer", "Answer ready" or "Stopped." instead, since a region that is busy then idle is not announced reliably and reading every piece would talk over itself.
7. **A check that could not fail.** `apps/web/build.test.ts`'s link page check looked for `ws-LinkPage-`; `uiVite()` writes class names in kebab case (`ws-link-page-root`), so it never matched anything. It now looks for `ws-link-page-` and still passes.
