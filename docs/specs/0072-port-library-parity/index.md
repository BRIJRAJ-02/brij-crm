# 0072. Port phase 1: library parity

**Date**: 2026-11-12
**Status**: In Progress
**Builds on**: [0071 Port phase 0: the Timefix type scale and tokens](../0071-port-tokens/index.md) (token names, the app scale, the outline focus ring, motion tokens)
**Amends**: [0003 Component library](../0003-component-library/index.md) (the look of 127 component folders; every export, prop and behaviour stays)

## Summary

The Timefix prototype and the real library both have 72 components with the same name, and 55 more library components that the prototype folds into one of those 72 under another name. Phase 1 makes all 127 look and move like the prototype (its README, its CSS and its states), using tokens only, while every prop, export and behaviour the real app already has stays. It runs in three tiers (atoms, molecules, modules), each one measured for load time, checked for security and checked for scale before it lands. The 27 parts only the prototype has, and the 43 library parts they replace, are phase 2.

## Rationale

Reasoning, the options compared, the open calls the prototype leaves and the evidence: [rationale.md](rationale.md).

## Requirements

**User stories**:
- As the owner, I want every library part to look and move like the Timefix design system artifact, so the screens built from them in phases 4 to 9 match what I approved.
- As someone using the app, I want nothing I can do today to disappear or behave differently while the look changes.
- As an engineer porting a screen later, I want a written map from each prototype prop to the library prop that draws the same thing, so I never guess.
- As anyone on a slow phone, I want the app to load faster after the port, not slower.

**Acceptance criteria**:

*Parity*
- **AC-1**: Every part in *The parts list* has the prototype's look: sizes, spacing, radius, colours, borders, shadows, type and motion read from its `<Name>.css` and README, expressed with tokens only (see *How a prototype value becomes a token*). A side by side shot of the part's story and the prototype's demo at the same state, light and dark, shows no difference larger than the rounding rules of 0071 allow.
- **AC-2**: Every state in the prototype README's **States** and **Interaction** sections has a story, and the story asserts behaviour (role, name, attribute, focus, announced text), never a pixel or a class name. A README state with no story is a missed state.
- **AC-3**: Every prop, export, variant and behaviour the library part had at the base commit (`f81623f0c`) still exists and still works: `src/index.test.ts` passes unchanged except for additions, every existing story's assertions still pass or were rewritten to test the same behaviour, and no file under `apps/` changes in phase 1 except where a call site needs a new required prop (none is planned).
- **AC-4**: A library part the prototype folds into another (*Folded parts*) keeps its export and props and takes its replacer's look, its rules written from the replacer's. Where it can render the replacer without changing its props, it does, and keeps no CSS of its own. Its remaining copy of the replacer's rules is listed in its README and is deleted with the folded export in the screen phase that moves its last caller (rationale, decision 14). _(Changed during the tier 1 build, 12 Nov: the first draft asked for `composes` across folders, which the house rule "one component owns its styles" forbids. Accepted by the owner and the coordinator, 12 Nov.)_
- **AC-5**: Each part's README gains the prototype README's missing content (use it for, don't use it for, the consumer provides, states, interaction) in the library's own prop names, and a short **Differences from the prototype** list naming every kept library behaviour the prototype lacks and every prop name that differs.
- **AC-6**: The house rules hold on every part: no press scale in the app (`--scale-press` is 1; public pages set their own), no blur in app motion, hover only under `(hover: hover) and (pointer: fine)`, reduced motion keeps fades and drops movement, focus is the prototype's outline ring (`--border-width-focus` solid `--focus-ring`, 2px offset) on `[data-focus-visible]`, and the legacy tokens 0071 marked "Phase 1" are no longer used by the parts this phase ports.
- **AC-7**: `design-system-guardian` reports nothing open on each tier before that tier is reported done.

*Gate 1: load time*
- **AC-8**: Load time is measured per phase, on real pages (the owner, 12 Nov, replacing the first draft's 30% cut per tier, which tier 1 showed atoms cannot meet while keeping every behaviour). No line of `pnpm size` grows against the phase's base beyond content-hash noise (±20 B: a changed chunk renames the imports of every chunk that loads it). Each tier records its pages' `pnpm size` lines before and after in rationale.md. The real cuts are measured where duplicates fold away (tiers 2 and 3, each folded part's saving reported) and in the screen phases 4 to 9. `packages/ui/scripts/part-cost.ts` stays as reporting (the per folder table), not a gate.
- **AC-9**: _(Folded into AC-8, 12 Nov: the totals of `apps/web/dist/assets` are reported beside the page lines, not gated, since every route chunk moves by content-hash noise.)_
- **AC-10**: After each tier, every `apps/web/.size-limit.js` budget this phase moved is set to the new measurement plus 0.5 kB of headroom, with a comment naming this spec and the date. _(Changed 12 Nov: the first draft's "rounded up to the next 0.1 kB" left as little as 0.01 kB, which CI's hash noise turns red.)_

*Gate 2: security*
- **AC-11**: No part renders HTML from a string: `dangerouslySetInnerHTML`, `innerHTML` and `outerHTML` appear nowhere in `packages/ui/src` outside tests.
- **AC-12**: Every part that renders an `href` passes it through `safeHref` (a refused URL renders as plain text, a `javascript:` or `data:` URL is never a link), and every link that opens a new tab carries `rel="noopener noreferrer"`. A story per link part proves the refused case.
- **AC-13**: No secret, key or token value is committed in a story, README or test; a part that shows a secret (`Code`'s secret form, if any) masks it by default.

*Gate 3: scalability*
- **AC-14**: Every list part that can hold more than one screen of rows stays virtualised (`DataGrid`, `Board` columns, `ActivityFeed`, `TaskList`, `NoteList`, `NotificationList`, `Menu` and `Select` lists past their threshold), and its existing perf test still passes.
- **AC-15**: Nothing does work in proportion to the data on hover or scroll: hover, lift and fan effects are CSS only (sibling and `:has()` selectors, custom properties set by CSS), never a React state change per item. The prototype's per item JavaScript hover springs are ported as CSS.
- **AC-16**: Every list a part renders is keyed by a stable id, never by index, unless the list is static and never reorders (written beside the key).

*Process*
- **AC-17**: Screenshot baselines change only through CI's pinned image: the lane never runs `pnpm test:visual --update`. The landing car downloads CI's `screenshot-baselines` artifact, copies only the folders of the parts the tier touched, diffs the baseline directory and explains any other moved file before committing (see *Screenshot baselines*).

## Decision

**Chosen option**: port the look into the existing components, keep their API, and fold superseded parts onto their replacer's CSS (Option 2 in the rationale).

Every library part keeps its name, props and behaviour; its CSS and motion are rewritten from the prototype's; parts the prototype merges keep their exports but share one set of rules.

**Implementation skills**:
- `crm-design-system` (`.claude/skills/crm-design-system/`): house rules, always
- `building-components` (`vercel/components.build`, `.claude/skills/building-components/`): variants, composition
- `react-aria` (`react-aria.adobe.com`, `.claude/skills/react-aria/`): state attributes the CSS reads
- `modern-css-html` (`kemiljk/skills`, `.claude/skills/modern-css-html/`): `:has()`, `composes`, container queries
- `transitions-dev` and `transitions-polish` (`~/.claude/skills/`): the motion each part ports
- `better-accessibility` (`jakubkrehel/skills`, `.claude/skills/better-accessibility/`): focus ring, names, reduced motion
- `stories` (`.claude/skills/stories/`): stories as behaviour tests
- `tanstack-virtual` (`.claude/skills/tanstack-virtual/`): the scalability gate on list modules

## Feature design

### The parts list

127 library folders, built in three tiers and ten batches. A **folded part** is a library folder whose name the prototype lists in another part's `meta.json` `replaces`; it is built in the same batch as that part, because their CSS is shared. The list was built by diffing `design/timefix-design-system/src/components/` against `packages/ui/src/{atoms,molecules,modules}/` and reading every `meta.json` (rationale.md, *Evidence*). Nothing in the library is unclaimed.

**Tier 1: atoms (13 parts, 10 folded, 23 folders)**

| Batch | Part (library tier) | Folded parts |
|---|---|---|
| 1a Actions and marks | Button (atom), Icon (atom), Kbd (atom), Link (atom), Code (atom), Tooltip (atom) | ProviderMark (atom) into Icon |
| 1b Data display | Tag (atom), Avatar (atom), RecordChip (atom), QrCode (atom) | Badge, StatusDot (atoms) into Tag; PersonLine (molecule) into Avatar; LinkChip, Mention, Variable (atoms) and RecordChipList (module) into RecordChip |
| 1c Inputs | Checkbox (atom), Slider (atom), DragHandle (atom) | Radio, Switch (atoms) into Checkbox |

**Tier 2: molecules (23 parts, 22 folded, 45 folders)**

| Batch | Part | Folded parts |
|---|---|---|
| 2a Fields and pickers | Field, Select, PhoneField, CodeInput, DatePicker, ChoiceChips, SegmentedControl, IconPicker, FileDrop | FieldLabel, FieldError (atoms), FieldGroup, Form into Field; CurrencyPicker, CountryPicker into Select (CountryPicker also PhoneField's dialing list); DateNav into DatePicker; FileItem, FileIcon (atom) into FileDrop. Owed to phase 2 by Field: a tabular digits option (`font-variant-numeric: tabular-nums`) NumberField can pass, and `aria-keyshortcuts` passed through to the input for SearchField (phase 2's thin wrappers use both after merge) |
| 2b Overlays and navigation | Menu, Popover, Tabs, Breadcrumbs, Pagination, Disclosure, Steps | InfoTip into Popover; SectionTabs into Tabs; Stepper into Steps. Tabs also fixes the selected `pills` label's contrast in WebKit (axe read white text on `surface-subtle`, because the fill is the absolutely positioned indicator): the chosen pill holds AA in every engine and keeps its slide |
| 2c Feedback and layout | Callout, Card, EmptyState, DescriptionList, FloatingBar, Sentence, SocialLinks | Stats, RecordStats, TileGrid into Card; SpotIllustration into EmptyState; AttributeList (module) into DescriptionList; BulkActionBar, SaveBar, PublishBar, VisitorBar (modules) into FloatingBar; SocialLinksEditor (module) into SocialLinks |

**Tier 3: modules (36 parts, 23 folded, 59 folders)**

| Batch | Part | Folded parts |
|---|---|---|
| 3a Records and data | DataGrid, Board, Chart, RecordHeader, RecordPanel, ActivityFeed, CommentThread, NoteList, TaskList, NotificationList, CommandPalette | Table, SampleTable (molecules) into DataGrid; BarStrip (atom) into Chart; RecordLayout, RelatedRecords into RecordPanel; BookingChanges into ActivityFeed; CommentComposer (molecule) into CommentThread; ShortcutHelp into CommandPalette |
| 3b Schema, team and shell | AttributeSettings, RelationshipSettings, OptionsEditor, FormulaEditor, RolePowers, TeamList, InviteRows, SettingsLayout, Sidebar, AppShell, AuthLayout, SignInForm | SectionBar (molecule), SectionList into SettingsLayout; CustomiseSidebar into Sidebar; PreviewLayout into AppShell and AuthLayout; VerifyEmail into SignInForm (its code boxes are CodeInput's) |
| 3c Scheduling | WeekCalendar, DayStrip, HoursEditor, BookingChat, BookingPagePicture, EmbedPreview, GuestLook | TeamWeek, TeamDay, MatchCalendar into WeekCalendar; RulesEditor into HoursEditor |
| 3d Pages and forms | LinkList, LinkPage, BusinessPage, FormPicture, QuestionList, PhotoCrop | LinkGrid, LinkCard, SpanCard into LinkList (LinkCard's booking page use also BookingPagePicture's); PageColumn into LinkPage; PartyBand into BusinessPage; HostedFormPreview into FormPicture |

**Phase 2 owns, not this phase** (their replacer is a prototype only part): Currency, Meter, NumberPop, Path, ProgressBar, Rating, RelativeTime, RemoteCursor, Reveal, Separator, Skeleton, Spinner, SuccessCheck, TextSwap, TruncatedText, VisuallyHidden, AccentPicker, ConditionRow, FilterChip, HuePicker, Modal, Panel, SuggestionList, AsideLayout, BookingDetails, BookingFrame, BookingList, BookingReceipt, CalendarList, FilterBuilder, ItemSheet, MeetingCard, MenuList, MonthTiles, MotionDemos, QrSheet, ReadyPanel, SetupChecklist, SlotList, SortBuilder, Toolbar, ViewSettings, WorkspacePreview (43). A folder claimed by both a phase 1 and a phase 2 part (ConditionRow, MenuList, ItemSheet, AsideLayout, Toolbar, NumberPop, SuggestionList) belongs to phase 2, whose new part becomes its home. `public-booking`, `public-form`, `public-menu`, `fields/` and `editor/` are phase 2 as well.

127 + 43 = the library's 170 folders.

### The method per part

For each part, in this order:

1. **Read both sides.** The prototype's `README.md`, `<Name>.css`, `<Name>.tsx` and `meta.json`; the library's README, CSS module, TSX and stories; and `parity-gaps.md` and `review-ledger.md` lines that name the part.
2. **Compare, as a table in the commit message or the README's differences list**:
   - geometry: height, width, padding, gap, radius, border width, icon size;
   - colour and depth: fill, edge, text, shadow, per variant and per theme;
   - type: the font shorthand, letter spacing, numeric figures;
   - states: rest, hover, pressed, focus visible, selected, open, disabled, pending, invalid, read only, empty, loading, error, as the README lists them;
   - motion: which transitions.dev pattern, its durations, easings and distances, enter and exit.
3. **Port the look.** Rewrite the CSS module from the prototype's rules on the library's data attributes. Keep every library variant; restyle each in the prototype's language (a library variant the prototype lacks takes the nearest prototype variant's look, and the README says which).
4. **Keep the behaviour.** Props, keyboard, announcements, `strings.ts` copy, `safeHref`, focus moves, `data-pressable` and cursor rules stay. Behaviour only the prototype has is added only when it needs no new prop; anything needing a new prop is listed in the README's differences as owed to the screen phase that needs it.
5. **States.** Every README state gets a story (an existing one where it fits); `play` functions assert role, name, `data-*` state, focus and announcements.
6. **Done** when: the CSS has tokens only and passes Stylelint; the stories pass in Chromium (locally) and in all three engines (CI); the README is updated (AC-5); the part's cost is reported (AC-8); `design-system-guardian` has nothing open on the tier.

### How a prototype value becomes a token

The prototype writes some lengths and font shorthands as raw values. 0071 AC-17 says nothing ports a raw value. In order:

1. **One token** when one equals the value (`var(--size-control-sm)` for 28, `var(--space-20)` for a 20px keycap, `var(--size-avatar)` for a 28px avatar).
2. **A sum of tokens** with `calc()` when the prototype's value is a step between two tokens (a 26px tag is `calc(var(--size-control-sm) - var(--space-2))`). Both tokens scale, so the app value stays within a pixel of 88% of the prototype's. The README names each such value.
3. **A font shorthand** snaps to the nearest type token: `500 13px/20px` is `--text-body-sm-strong`, `500 12px/16px` is `--text-label`, `400 13px/20px` mono is `--text-code`, `500 11px/16px` is `--text-kbd`.
4. **A new source token** only when 1 to 3 cannot reach the value within a pixel. It goes into `design/timefix-design-system/tokens.json` and the generator's height or width list in its own commit, before the part that uses it.
5. Ratios inside one part (`calc(var(--avatar-size) * 0.36)`) stay ratios of a token.

### Prop name map for the screen phases

The library keeps its prop names in phase 1 (AC-3). The screen phases translate prototype JSX by this map; each tier adds its rows.

| Prototype | Library | Draws |
|---|---|---|
| `<Button size="sm">` | `<Button>` (size `md`, the default) | 28 full, 24 app |
| `<Button>` (size `md`, the default) | `<Button size="lg">` | 36 full, 32 app |
| `<Button size="lg">` | `<Button size="xl">`, or `size="touch"` on a public page | 44 full, 38 app |
| `variant="primary"` | `variant="primary"` | ink fill (`--primary`) |
| `variant="danger"` | `variant="danger-solid"` | red fill |
| `variant="soft"` | `variant="soft"` (added) | grey fill |
| `IconButton label=…` | `Button icon=… label=…` with no children | icon only |
| `Tag size="sm"` / default / `"pill"` | `Tag size="sm"` / default / `"pill"` | 22 / 26 / 30 full |
| `Count` | `Badge` | the round count |
| `RadioGroup`, `Switch` | `RadioGroup`, `Switch` | same names |

### Folded parts

A folded part keeps its export, its props and its stories. Where it can render its replacer, it does; otherwise its CSS module keeps its own rules, written from the replacer's, and its README lists the overlap. Its README says "Takes its look from X (spec 0072)". Deleting the export is not this phase's job: the screen phase that moves its last caller deletes it.

### Screenshot baselines

- The lane commits code, stories and READMEs, never baselines, and never runs `pnpm test:visual` or `--update` (0071, `packages/ui/AGENTS.md`).
- CI's `visual` job fails on the tier's moved shots and renders new baselines in the pinned image as the `screenshot-baselines` artifact.
- The landing car downloads that artifact, copies over only the `__screenshots__` folders of the tier's parts (and of parts that render them, listed from the diff), runs `git status` on the baseline directory, opens a sample of each folder in both themes, and explains every other moved file before committing it. A second CI run must pass `visual` against the new set.
- Baselines from another branch are never borrowed: the port-2 lane's shots are reshot on the landing tree.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| A part's geometry, colour, type, motion | each CSS value | the prototype `<Name>.css`, turned into tokens by *How a prototype value becomes a token* |
| A part's states and interaction | the story list | the prototype README's States and Interaction |
| A kept library behaviour | props, copy, keys | the library at `f81623f0c` |
| A library variant the prototype lacks | its look | the nearest prototype variant, named in the README |
| Folder to tier and batch | the parts list | `meta.json` `replaces` (rationale.md, *Evidence*) |
| Cost before and after | bytes | `scripts/part-cost.ts` on `f81623f0c` and on the tier's last commit |
| First load numbers | `pnpm size` lines | the built app on `f81623f0c` and after |
| New size budgets | `.size-limit.js` | the after measurement plus 0.5 kB |
| New baselines | PNGs | CI's `screenshot-baselines` artifact from the landing tree |

### Key invariants

- No export, prop or behaviour disappears in phase 1.
- One look per family: a folded part draws its replacer's look, and its repeated rules leave with its export.
- Tokens only; no `zoom`, no press scale in the app, no blur in app motion.
- No baseline is written outside CI's pinned image.
- A tier lands only with its three gates green.

### Security model

No data and no permissions. The library takes data through props and makes no network calls (unchanged). The gates are untrusted strings: hrefs through `safeHref`, no HTML from strings, new tab links with `rel`.

### Critical test scenarios

- A Button story at each variant and size, tabbed to: the outline ring shows and the label is its name; pressed, nothing scales → **AC-1**, **AC-2**, **AC-6**
- A folded part's README lists the rules it repeats from its replacer, and its story shows the replacer's look → **AC-4**
- `src/index.test.ts` passes with no export removed → **AC-3**
- `pnpm size` on the phase's base and the tier's tip: no line grows beyond ±20 B, each folded part's saving reported; `scripts/part-cost.ts` prints the per folder table → **AC-8**
- A Link, Button, RecordChip and LinkChip story with `href="javascript:alert(1)"` renders plain text with no `href` → **AC-12**
- A RecordChipList hovered with React's profiler: no component renders → **AC-15**
- `grep` for `key={i}` and `key={index}` in the tier's folders finds only commented static lists → **AC-16**

## Build plan

Tracer Bullet: the thinnest thread is one atom (Button) through every gate (look, stories, README, cost, size, security, guardian), then the rest of its tier, then the next tier.

1. `packages/ui/scripts/part-cost.ts` (the cost table, base and after, as JSON and a printed table) and the base measurement on `f81623f0c`, satisfies **AC-8** (reporting)
2. Tier 1, batch 1a: Button, Icon (+ProviderMark), Kbd, Link, Code, Tooltip, satisfies **AC-1** to **AC-6**, **AC-11** to **AC-13**
3. Tier 1, batch 1b: Tag (+Badge, StatusDot), Avatar (+PersonLine), RecordChip (+LinkChip, Mention, Variable, RecordChipList), QrCode, satisfies **AC-1** to **AC-6**, **AC-12**, **AC-15**, **AC-16**
4. Tier 1, batch 1c: Checkbox (+Radio, Switch), Slider, DragHandle, satisfies **AC-1** to **AC-6**
5. Tier 1 gates: cost table, `pnpm size`, budgets lowered, guardian, `pnpm check`, satisfies **AC-7** to **AC-10**
6. Tier 2, batches 2a to 2c, then its gates, satisfies **AC-1** to **AC-16** _(built 12 to 13 Nov; AC-8 not met on the hosted form's and booking page's CSS, see rationale.md, Tier 2 after)_
7. Tier 3, batches 3a to 3d, then its gates, satisfies **AC-1** to **AC-16**
8. Per tier, the landing car reshoots baselines through CI, satisfies **AC-17**

## Consequences

**Positive**:
- The library matches the artifacts, so the screen phases port JSX and get the right look.
- One rule set per look: folded parts stop drifting from their replacers, and the CSS shrinks.
- Load time, security and scale are measured per tier, not hoped for.

**Negative / tradeoffs**:
- Library prop names differ from the prototype's until a later rename (the map above carries the difference).
- Folded parts keep thin exports until their screens move, so the public surface is the same size for now.
- Every screen in the app changes look three times (once per tier) before its own phase restyles its layout.
- Budgets sit 0.5 kB over the measurement: room for hash noise, not for growth; a later part that grows the first load must say why.

**Neutral**:
- Baselines move by the hundreds per tier, through CI only.

## Follow-up

- [ ] Phase 2 maps its 27 parts against the 43 folders listed above.
- [ ] A rename pass, after phase 9, may align library prop names to the prototype's (the map above is the input).
- [ ] `/sync`: `packages/ui/AGENTS.md` (the folding rule, `scripts/part-cost.ts`), the `crm-design-system` skill (pill buttons, ink primary, outline ring).
- [ ] Retire from `packages/tokens/legacy.json` each "Phase 1" token once no file uses it (the last tier deletes what is left).
