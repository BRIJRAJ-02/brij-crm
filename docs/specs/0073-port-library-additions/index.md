# 0073. Port phase 2: library additions

**Date**: 2026-11-12
**Status**: In Progress
**Batch 1**: built (b) parts on `feat/port-2`, 12 Nov 2026; batches 2 and 3 to come
**Builds on**: [0071 Port phase 0, tokens](../0071-port-tokens/index.md) (token names, the app scale, motion rules), [0003 Component library](../0003-component-library/index.md) (reuse, then variant, then new)

## Summary

The Timefix prototype has 27 parts the real library does not have under the same name. Most of them are already here under another name, inside `public-*`, `editor` or `fields`, or as screen code in `apps/web`. This spec maps every one of the 27 to exactly one of three outcomes, keeps the number of new parts to two (ShareSheet and AIAssist), and builds the rest as variants, props or thin wrappers over parts that exist. It also sets three gates every later port phase must pass: load time, security and scalability.

## Rationale

The mapping evidence, the options for each open call and the picks: [rationale.md](rationale.md).

## Requirements

**User stories**:
- As the owner, I want fewer duplicate parts, so the port lands one library and not two that drift apart.
- As an engineer porting a screen in phases 4 to 9, I want to know for each prototype part which real part to use, so I never build a second Dialog, Toast or Progress.
- As someone on a slow phone, I want the app and the public pages to load no slower than today, so new parts never cost a first visit anything.
- As a workspace admin, I want shared pages, rich text and AI answers to be safe to render, so a bad link or a pasted script can never run in someone's browser.
- As one of 1,000 people looking at the same page, I want presence and long lists to stay smooth, so the screen never draws work in proportion to the crowd or the data.

**Acceptance criteria**:

Mapping
- **AC-7301**: Each of the 27 prototype parts maps to exactly one row in the mapping table below, as (a) exists, (b) variant, prop or thin wrapper, or (c) new. No (a) part is renamed or aliased: an engineer porting a screen uses the real name in the table.
- **AC-7302**: Only the parts marked (c) add a new component folder. A (b) adds no CSS for an element the library already draws; a thin wrapper may carry its own small stylesheet only to keep a variant out of a public page's CSS budget (the exception `packages/ui/AGENTS.md` already allows).
- **AC-7303**: A behaviour an (a) part lacks against its prototype README is closed by the phase that ports the screen needing it, as a variant of the real part, never as a second part. The gaps found now are listed in the rationale, each with its phase.

Batch 1 (the (b) parts)
- **AC-7304**: `SearchField` (thin wrapper over Field's `search` variant): a clear button while it holds text, Esc clears and keeps focus, an optional `shortcut` ("⌘K", which also answers Ctrl+K, or one key such as "/") that focuses and selects it from anywhere outside another field, shown as a keycap while it is empty and unfocused (stated to screen readers through `aria-keyshortcuts` once phase 1 gives Field the passthrough), and `onSearch` fired `debounceMs` (150 by default, spec 0014's pause) after typing stops, at once on Enter and on clear.
- **AC-7305**: `NumberField` (thin wrapper over Field): a number typed or stepped. ↑ and ↓ step by `step`, Page Up and Page Down by ten steps, Home and End go to `minValue` and `maxValue`; optional minus and plus buttons turn off at their limits. `mode` is `number`, `currency` (the currency's narrow symbol in front, two decimals) or `percent` (0 to 100, "%" after); `unit` puts a word after ("min", "seats"). Typing is free; the value parses in the person's locale and formats when the field is left or Enter is pressed. An entry that does not parse goes back to the last good value. A keyboard or button step is announced politely. Digits are tabular (owed to phase 1: it needs a `data-numeric` input state on Field, which phase 1 is restyling).
- **AC-7306**: `TimeSelect` (thin wrapper over Select): a time of day picked from a list `step` minutes apart (15 by default), on a 12 or 24 hour clock, `from` to start an end time after its start, values "HH:MM". `timeOptions({ locale, step, hourCycle, from, to })` and `formatTime(value, locale, hourCycle)` are exported for summaries. A typed exact time keeps using Field's `temporal={{ type: 'time' }}` (no new part).
- **AC-7307**: Modal `isDirty` (the prototype's Drawer guard, for every Modal variant that holds a form): while it is true, a close asked by ×, Esc, a `slot="close"` button or a click outside opens the house confirm "Discard your unsaved changes?" with Keep editing and Discard changes (danger). Only Discard changes closes. Keep editing or Esc puts focus back in the form. Works controlled (`isOpen` and `onOpenChange`) and inside a ModalTrigger. It replaces the hand made `DrawerForm` ask in `apps/web/src/features/menus/drawer.tsx` when phase 8 ports those screens.
- **AC-7308**: `PresenceGroup` (thin wrapper beside AvatarStack): overlapping avatars, each with a status dot (active green, idle amber) and its status in words in its name and Tooltip (never colour alone), focusable, naming the person and what they are doing in a Tooltip; at most `max` (4 by default) avatars, then "+n". The group's accessible name says how many are here and names at most `max` people, then "and n others", so its label never grows with the crowd. The hovered or focused avatar lifts `distance-small` at the hover pace, its neighbours half that; reduced motion keeps them still.
- **AC-7309**: RemoteCursor `variant="pointer"` with `x`, `y` and `isIdle`: another person's pointer on a shared surface, an arrow in their hue with a name pill, gliding between updates over `duration-quick` on `ease-smooth-out`; idle folds the pill away and dims the arrow; reduced motion jumps between points and keeps the idle fade. The default `caret` variant is unchanged. Both are hidden from screen readers.
- **AC-7310**: TextSwap `variant="soft"`: both values cross fade in one cell (no rise), for a value recomputed in place (a total after a period change); `align` keeps a right aligned figure on its edge. It has no movement, so reduced motion keeps the cross fade (the house rule keeps fades).
- **AC-7311**: Reveal `variant="drop"`: a row that arrives in a list opens from no height while it rises `distance-medium` over `duration-fast` on `ease-smooth-out`, with no blur, so it is allowed in the app; `animate={false}` for rows that were there on load. Reduced motion keeps only the fade. The default public entrance is unchanged.
- **AC-7312**: Every batch 1 change has stories with play assertions for each of its states, a README section, tokens only, exports in one block in `src/index.ts`, and the names pinned in `src/index.test.ts`.

Gate 1: load time
- **AC-7313**: No new part grows any first load. `pnpm size` is measured on the base commit and after each batch, and the budgets are tightened to the new numbers plus at most 0.5 kB of room per line.
- **AC-7314**: The heavy parts are lazy chunks, never in an HTML entry's static graph: the rich text editor (`@crm/ui/editor`), the hosted form's step layouts and heavy questions, the booking page's later steps, Onboarding's screen, ShareSheet (with QrCode) and AIAssist (`@crm/ui/ai`, a subpath of its own). `apps/web/build.test.ts` asserts that ShareSheet's and AIAssist's modules are not reachable from `index.html`, `book.html` or `form.html`.
- **AC-7315**: The gzip size of each chunk is recorded before and after each batch, and any chunk that grows by more than 1 kB is named with its reason in the batch's commit.
- **AC-7316**: Where a later phase swaps hand made screen code for a part from this spec (`DrawerForm` for Modal `isDirty`, the hand made search fields for SearchField, numeric Fields for NumberField), that screen's own code (its files, gzipped) is at least 30% smaller, measured before and after in that phase's commit.

Gate 2: security
- **AC-7317**: Nothing renders untrusted HTML unsanitised. RichTextEditor renders Tiptap JSON through its schema (no `innerHTML` of stored HTML); HostedForm renders the owner's words as text; AIAssist renders answers as text. The client and screens lint presets refuse `dangerouslySetInnerHTML`, assignments to `innerHTML` or `outerHTML`, and `insertAdjacentHTML` (batch 1, with a config test). A file that must render HTML later disables the rule on that line, names the sanitiser in the comment, and has a test that a `<script>`, an `onerror` attribute and a `javascript:` link are removed.
- **AC-7318**: ShareSheet and the link page editor (LinkEditor's real parts) refuse `javascript:`, `data:` and `vbscript:` URLs through `safeHref` before anything is drawn, copied, shared or encoded into a QR code; a test proves each scheme is refused and `https:` passes.
- **AC-7319**: PresenceGroup and RemoteCursor draw only the people the screen hands them; the screen hands only presence the access door allows (a viewer who cannot read the record is never sent to its watchers). The library takes no ids or emails it does not draw.
- **AC-7320**: No part in this spec reads a secret, an API key or an environment variable; AIAssist takes `onAsk` from the screen and never calls a model itself.

Gate 3: scalability
- **AC-7321**: ComboBox (ReferencePicker) and FilterBar's pickers keep their virtualised Menu over a `ListSource`; search stays debounced (150 ms, the data layer's `SEARCH_DELAY_MS`) and aborted when superseded. A story with 10,000 results draws no more rows than fit, plus overscan.
- **AC-7322**: SearchField's `onSearch` is debounced (AC-7304): 10 keys typed 50 ms apart fire it once. A screen filtering a list over 500 rows filters on `onSearch`, never on each key.
- **AC-7323**: MeetingList (BookingList) draws a bounded page: phase 6 adds `hasMore` and `onLoadMore` before it ports the Meetings page, and a story with 10,000 meetings draws at most one page (50 rows) of rows.
- **AC-7324**: PresenceGroup with 1,000 people draws at most `max` avatars and one "+n", and its accessible name holds at most `max` names (AC-7308). RemoteCursor positions move by `transform` only (no layout work per update).

## Decision

**Chosen option**: map before building, keep the real names, and build the gaps as variants (Option 2 in the rationale).

**Implementation skills**:
- `crm-design-system` (`.claude/skills/crm-design-system/`): house rules, always
- `react-aria` (`.claude/skills/react-aria/`): Select, Tooltip, Focusable and Modal behaviour
- `building-components` (`vercel/components.build`): wrapper APIs
- `transitions-polish` (`.claude/skills/transitions-polish/`): motion tokens for the variants
- `stories` (`.claude/skills/stories/`): play assertions per state
- `security-and-hardening` (`addyosmani/agent-skills`): the sanitiser and URL gates
- `tanstack-virtual` (`.claude/skills/tanstack-virtual/`): the scalability gate

## Feature design

### The mapping (AC-7301)

| # | Prototype part | Map | Real target | Batch |
|---|---|---|---|---|
| 1 | AIAssist | (c) | New module `AIAssist` on a lazy `@crm/ui/ai` subpath; `AITag` is Tag's `ai` tone, `ThinkingLine` and `StreamText` live inside it | 3 |
| 2 | AttributeField | (a) | `AttributeDisplay`, `AttributeEditor` (`fields/`), `AttributeList` (a value edited in place) | (phase 5) |
| 3 | BookingFlow | (a) | `@crm/ui/public-booking`: BookingFrame, MonthTiles, SlotList, BookingDetails, BookingReceipt | (phase 6) |
| 4 | CalendarConnections | (a) | CalendarList (accounts and calendars), composed by `apps/web` `settings/CalendarScreen` | (phase 6) |
| 5 | Checklist | (a) | SetupChecklist (first run), ReadyPanel (ready to publish) | (phase 4) |
| 6 | ColorPicker | (a) | HuePicker (data hues), AccentPicker with ContrastBadge (any colour) | (phases 7, 8) |
| 7 | ComboBox | (a) | ReferencePicker (`fields/`), the RecordReference editor | (phase 5) |
| 8 | Dialog | (a) | Modal (`dialog`, `form`, `confirm`, `window`), ModalTrigger, InviteRows | (phase 4) |
| 9 | Drawer | (b) | Modal `variant="drawer"` plus the new `isDirty` guard; Panel for the in layout side panel | 1 |
| 10 | FilterBar | (a) | Toolbar, FilterChip, FilterBuilder, ConditionRow, SortBuilder, ViewSettings | (phase 5) |
| 11 | HostedForm | (a) | `public-form` (HostedForm, HostedFormSteps, the question parts) | (phase 7) |
| 12 | LinkEditor | (a) | Screen code in `apps/web/features/link-page`, from LinkList, RowOrder, SocialLinksEditor, PublishBar, LinkPage | (phase 7) |
| 13 | Logo | (a) | The `ProductLogo` artwork UiProvider hands AuthLayout, BookingFrame and the hosted form | (phase 4) |
| 14 | MeetingList | (a) | BookingList (the list), MeetingCard (one meeting) | (phase 6) |
| 15 | MenuPage | (a) | `public-menu`, MenuList, ItemSheet | (phase 8) |
| 16 | Motion | (b) | NumberPop, TextSwap, SuccessCheck, Spinner, Skeleton, Reveal as they are, plus TextSwap `soft` and Reveal `drop` | 1 |
| 17 | NumberField | (b) | New thin wrapper `NumberField` over Field | 1 |
| 18 | Onboarding | (a) | WorkspacePreview, TileGrid, Steps, composed by `apps/web` `welcome` | (phase 4) |
| 19 | Presence | (b) | AvatarStack's presence wrapper `PresenceGroup`, RemoteCursor `variant="pointer"` | 1 |
| 20 | Progress | (a) | ProgressBar, Meter; Chart for the donut | (phase 9) |
| 21 | RichTextEditor | (a) | `@crm/ui/editor` (RichTextEditor, NoteEditor, FormatToolbar, MentionView) | (phase 5) |
| 22 | SearchField | (b) | New thin wrapper `SearchField` over Field `variant="search"`; ToolbarSearch stays for the folding toolbar search | 1 |
| 23 | ShareSheet | (c) | New module `ShareSheet`, composing Modal, Field `copy`, CopyButton, QrCode and Button | 2 |
| 24 | Text | (a) | TruncatedText, RelativeTime, Separator, VisuallyHidden, Path | (phase 1) |
| 25 | TimeField | (b) | New thin wrapper `TimeSelect` over Select; Field `temporal` time for a typed time | 1 |
| 26 | Toast | (a) | UiProvider's toast queue (`createToasts`, `useToasts`) and ToastRegion | (phase 1) |
| 27 | VenuePage | (a) | BusinessPage, BusinessGallery and the business public page | (phase 8) |

Totals: 19 (a), 6 (b), 2 (c). A phase in brackets means nothing is built here; that phase uses the real part and closes its gaps as variants (AC-7303).

### Batches

- **Batch 1** (this lane): the six (b) rows, AC-7304 to AC-7312, plus the gate measurements.
- **Batch 2**: ShareSheet (phase 3 puts it behind every Share button and first publish). Its own lazy chunk; `safeHref` on the URL; `downloadQr` beside QrCode.
- **Batch 3**: AIAssist (phase 5, Ask AI on records). Lazy subpath `@crm/ui/ai`; text only rendering; `onAsk` from the screen.

### Where the batch 1 code lives

| Path | Owns |
|---|---|
| `packages/ui/src/molecules/SearchField/` | `SearchField` and its README, stories and strings. No stylesheet: Field draws it, Kbd and Button fill its suffix |
| `packages/ui/src/molecules/NumberField/` | `NumberField`, `parseNumber` and `numberFormatOptions` (pure, unit tested), README, stories, strings. No stylesheet |
| `packages/ui/src/molecules/TimeSelect/` | `TimeSelect`, `timeOptions`, `formatTime` (pure, unit tested), README, stories. No stylesheet |
| `packages/ui/src/molecules/Modal/` | `isDirty` and the discard ask (the strings move from `apps/web` menus) |
| `packages/ui/src/atoms/Avatar/PresenceGroup.tsx` and `PresenceGroup.module.css` | The presence wrapper; its own stylesheet, so the booking page, which draws AvatarStack, never carries it |
| `packages/ui/src/atoms/RemoteCursor/` | `variant="pointer"` |
| `packages/ui/src/atoms/TextSwap/` | `variant="soft"`, `align` |
| `packages/ui/src/atoms/Reveal/` | `variant="drop"`, `animate` |

### Not ported from the prototype (and why)

- The prototype's SearchField dissolve clear (a canvas measured glow under each word) and NumberField's per digit pop: both need markup inside Field's box, which phase 1 is restyling. Phase 3 (shared behaviour) adds them as Field states if the owner still wants them after phase 1.
- Drawer's footer shake ("Save or discard first"): the real app asks with a confirm instead (owner, 21 October 2026: ending actions ask first in a Modal), so the guard asks.
- Press scale 0.97 on BookingFlow and blur in motion: the house rules from 0071 stand.
