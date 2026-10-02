# Verify: Component library · spec 0003 · updated 2026-10-02
_Steps derived from spec 0003's acceptance criteria and its Value sourcing table, milestone by milestone. `/check verify` runs these; `/test` locks the durable ones._

## Milestone 1: one component through the whole pipeline

### UI / manual
- [ ] `pnpm storybook` → Storybook opens on :6006 with Atoms (Button, Icon, Kbd, Spinner) and Provider (Toasts). Switch the toolbar's Theme to Dark and Language to Deutsch → the stories redraw in dark, with no errors in the console → AC-6, AC-11
- [ ] In Storybook, Tab into Atoms/Button/Keyboard → the focus ring shows only for the keyboard; a mouse press shows no ring and scales the button to 0.97 while held → AC-6, AC-10
- [ ] Turn on the OS's reduce motion setting, press and hold a button → it no longer scales; the Pending spinner pulses instead of turning → AC-10
- [ ] With Storybook running, run `/mcp` in Claude Code → `storybook` is connected, and its tools list stories and previews → AC-15
- [ ] Open the design system artifact after the publish → Button, Icon, Kbd and Spinner render live on React 19 in light and dark, with their READMEs; the other cards show their guidance without a live preview until their milestone → AC-17
- [ ] Open the web app (`pnpm dev`, or a preview deploy) → the status page renders as before, with no Content Security Policy violations in the console (UiProvider and the toast region are mounted) → AC-11, AC-13

### Commands
- [ ] `pnpm --filter @crm/ui test` → unit, stories (Chromium, Firefox, WebKit) and browser projects pass, with axe clean in light and dark and no CSP violations → AC-6, AC-15
- [ ] `pnpm test:visual` → 23 stories × 2 themes (46 baselines) match their Linux baselines. Change `padding-inline` in `Button.module.css` and run it again → the Button stories fail, and the diffs land in `packages/ui/.vitest/attachments/Button/` → AC-16
- [ ] `pnpm test:visual --update` → refuses any baseline over 200 KB → AC-16
- [ ] Run `vitest run --project visual` in `packages/ui` outside Docker → refused with "Screenshots run only in the pinned Playwright Linux image" → AC-16
- [ ] `pnpm ui:artifact --check` → the React scripts, bundle, stylesheet, types and four previews build within the type's caps, every preview renders in headless Chromium, and nothing calls `require()` → AC-17
- [ ] `pnpm size` → the first load is under 250 kB of JavaScript and 40 kB of CSS gzipped (197.7 kB and 3.9 kB at the baseline) → AC-18
- [ ] `pnpm --filter @crm/web test` → the first load test walks only static imports and finds no grid, editor, charts or schema map chunk; the CSS layer order holds → AC-18
- [ ] `pnpm --filter @crm/config test` → ESLint refuses React Aria, Tiptap and Yjs in a screen, a value atom import in a screen, literal copy in library markup, and network calls in the library; Stylelint refuses system colours outside forced colours → AC-12, AC-19
- [ ] `pnpm house-rules` → passes; a component folder without a README or stories, or two CSS modules or story titles with the same name, fail → AC-1
- [ ] `pnpm check` → green

### Value sourcing
- [ ] The language: in `apps/web`, `UiProvider` gets `navigator.languages[0]`; set the browser to `de-DE` and confirm `useFormatSettings().locale` is `de-DE` in a component (the provider browser test covers the plumbing) → Format a date, number or amount
- [ ] The time zone: `UiProvider` gets `Intl.DateTimeFormat().resolvedOptions().timeZone`; Storybook pins `Europe/London` → Format a timestamp, compute "today"
- [ ] Now: stories freeze the clock at 8 October 2026, 14:30 UTC; in the app the clock ticks every 30 seconds and pauses while the tab is hidden (`clock.test.ts`) → Relative time
- [ ] Toasts: one `createToasts()` in `main.tsx`; confirmations leave after 5 seconds, errors and actions stay, three at most (`toasts.test.ts`) → Toasts
- [ ] Toast timing and skeleton delay: 5 s; 200 ms delay, 300 ms minimum, constants in `packages/ui` (`useDelayedLoading.browser.test.tsx`) → Toast timing, skeleton delay
- [ ] Built in copy: every word in Button, Spinner and the provider comes from their `strings.ts` (lint refuses literals) → Built in copy
- [ ] Artifact version: after the publish, `packages/ui/artifact.json` holds the version id from the publish result → Artifact version

## Acceptance-criteria coverage (milestone 1)
- AC-1: house rules check, Button, Kbd, Spinner, Icon READMEs and stories · AC-2: Button states storied (hover, focus, pressed, disabled, pending, selected) · AC-6: keyboard plays, axe light and dark, forced colours test · AC-10: press scale, reduced motion · AC-11: provider settings · AC-12: copy lint · AC-13: toast policy and skeleton timing · AC-15: three engines · AC-16: Linux baselines · AC-17: `pnpm ui:artifact` and the publish · AC-18: size budget and manifest test · AC-19: lint guards

## Milestone 2: atoms, overlays, the value schemas, the field set, molecules and the status screen

### UI / manual
- [ ] `pnpm storybook` → the sidebar groups Atoms, Molecules, Fields and Provider. Every Fields story ("Text field", "Phone field", and the rest) shows its display and editor; Fields/Workbench lays every type out on the six surfaces (cell, panel, card, form, filter, preview) → AC-1, AC-4
- [ ] Switch the toolbar's Language to Deutsch and open Molecules/DatePicker → the calendar starts on Monday, dates read in German, and the today dot sits on 8 October 2026 (the frozen clock), not the machine's date → AC-11
- [ ] Switch the toolbar's Keyboard to "Windows and Linux (Ctrl)" → every ⌘ shortcut reads Ctrl instead → AC-6
- [ ] Open Molecules/Menu with the mouse → it grows from its trigger. Open it with Enter → it appears at once. Esc → focus is back on the trigger. Turn on reduce motion → it fades only → AC-6, AC-10
- [ ] In Fields/Email field, type `ada@example` and Tab away → the Field error says how to fix it and nothing is committed. Same for a number with five decimals and a phone that isn't a number → AC-5
- [ ] Open Atoms/Link and Atoms/LinkChip, the `javascript:` stories → the URL renders as plain text, not a link → AC-14
- [ ] Open the web app (`pnpm dev`; restart it if it was running before this milestone, so Vite loads `layerOrder()`) → the status card shows the Healthy dot, the environment, the Postgres version, the round trip and "Checked now" with the exact time on hover (a screen reader reads it after "now"); it comes from library components only, with no CSP violations or warnings in the console → AC-22, AC-11
- [ ] Pick Dark in the card's theme switch and reload → it stays dark; pick System → it follows the OS. The switch is in the footer of every state (checking, healthy, failed, not found) → AC-22
- [ ] Throttle the network in dev tools and reload → after 200 ms the card shows its four labels with skeleton values, marked busy, at the same height as the loaded card → AC-13, AC-22
- [ ] Stop the api and reload → the card says "The API or the database didn't answer" with Try again; start the api and press it → the status comes back. Open `/nothing-here` → a "Page not found" card with a link that goes back to the status page through the router → AC-22, AC-2
- [ ] At 375 px wide, the status card keeps a 16 px gutter on each side and the page doesn't scroll sideways → AC-22

### Commands
- [ ] `pnpm --filter @crm/contracts test` → every value schema parses its valid samples and refuses invalid ones with a sentence that says how to fix it; options, display and history shapes parse → AC-3
- [ ] `pnpm --filter @crm/ui test` → unit, stories in three engines and the browser tests pass. `fields.browser.test.tsx` walks every attribute type through all six surfaces, checks the registry has one entry per type, and checks what editors emit parses → AC-2, AC-4, AC-5, AC-6, AC-15
- [ ] `pnpm test:visual` → 178 stories match their Linux baselines in light and dark (356 baselines; the other stories opt out with `screenshot: false`) → AC-16
- [ ] `pnpm ui:artifact --check` → the previews for every flagged story build and render, and none reaches the network → AC-17
- [ ] `pnpm --filter @crm/web build && pnpm --filter @crm/web size` → about 162 kB of JavaScript and 5.6 kB of CSS gzipped. Put `NODE_ENV=development` in the root `.env`, build again, and run size → refused as React's development build → AC-18
- [ ] `pnpm --filter @crm/web test` → `/layers.css` is the first stylesheet the page links, and the layer order holds with the status screen's CSS in a shared chunk → AC-18, AC-22
- [ ] `pnpm check` → green

### Value sourcing
- [ ] Today: `dayIn(useNow(), timeZone)` from the provider, never React Aria's reading of the machine's date (DatePicker's today dot and quick picks) → "today"
- [ ] Keyboard platform: `UiProvider` reads it once from `navigator` (`detectKeyboardPlatform`); Storybook pins `mac` unless the Keyboard toolbar says otherwise → shortcut text
- [ ] Currency minor units: `Intl.NumberFormat(…).resolvedOptions().minimumFractionDigits` for the code, at most 4 → amount digits
- [ ] Phone parsing: `libphonenumber-js/max`, loaded on first use by the phone editor, never in the first load → phone values
- [ ] The status screen: environment, Postgres version, round trip and checked at from `context.data.system.status()` in the route loader; the pending skeleton uses `LOADING_TIMING` (200 ms, then at least 300 ms) through the router's pending defaults → AC-13, AC-22

## Acceptance-criteria coverage (milestone 2)
- AC-1: every milestone 2 component has its README and stories (`pnpm house-rules`) · AC-2: empty, loading, error, read only and disabled stories · AC-3: contracts value schemas and their tests · AC-4: the registry and the six surface walk · AC-5: editor refusals and the parse check · AC-6: keyboard plays, axe in light and dark · AC-10: overlay motion and keyboard instant opening · AC-11: language, time zone and today from the provider · AC-13: the router's pending timing · AC-14: safe links and image sources · AC-22: the status screen on the library
- KanbanCard and KanbanColumn move to milestone 3 with the board.

## Milestone 3: the grid, the app shell, the view and record modules, and the board

### UI / manual
- [ ] `pnpm storybook` → Modules lists AppShell, Sidebar, Toolbar, ShortcutHelp, DataGrid, FilterBuilder, SortBuilder, ViewSettings, BulkActionBar, CommandPalette, AttributeList, RecordHeader, RecordPanel, ActivityFeed, TaskList and Board; Atoms adds DragHandle and the Tooltip's Lock story → AC-1
- [ ] Modules/DataGrid, by keyboard only: arrows, Home, End, Page Up and Page Down move between cells; Enter or typing edits with the column's editor; Esc cancels; Tab and Enter commit and move on; Delete clears (a required column refuses, a checkbox becomes false). Shift with the arrows makes a range; ⌘C copies it as tab separated text; paste a few lines into another range and the refused cells are reported. Switch Keyboard to "Windows and Linux (Ctrl)" → the shortcuts read Ctrl → AC-8
- [ ] Modules/DataGrid: resize a column by dragging its edge and from the header menu by keyboard; reorder one; scroll sideways → the name column stays pinned → AC-8
- [ ] Modules/FilterBuilder: add a filter by keyboard → focus lands on the new row's operator. Remove the first row → focus moves to the row that took its place. Type 0 into "Created, how many" and Tab away → it says to enter 1 to 999, and nothing is saved → AC-5, AC-6
- [ ] Modules/SortBuilder and Modules/ViewSettings: reorder by keyboard (right arrow to the handle, Enter, the arrows, Enter). In ViewSettings nothing drops above Name, which reads "Always shown" → AC-6
- [ ] Modules/CommandPalette: open it with the mouse → it grows in; close it → it shrinks out in the exit duration. Opened from the keyboard it appears at once → AC-10
- [ ] Modules/RecordPanel: step with Next to the last record → focus moves to Previous. In Details, edit City and press Esc → the edit is cancelled and the panel stays open; Esc again closes it and focus returns → AC-4, AC-6
- [ ] Modules/AttributeList: Tab to the Created lock → its reason shows in a tooltip; in Narrow, names sit above their values → AC-2, AC-6
- [ ] Modules/ActivityFeed: Tab in, then the arrows, Page Down, Home and End move between entries; headings read Today, Yesterday, Earlier this week, then the month; switch Language to Deutsch → the months and relative times read in German → AC-6, AC-11
- [ ] Modules/TaskList: tick a task by keyboard (right arrow to its checkbox, Space); the overdue date is red with an alert icon → AC-2, AC-6
- [ ] Modules/Board: pick a card up by its handle (Enter), Tab to another column, Enter → it moves, and focus follows it. While it moves, the hidden Lost column comes back and the archived Legacy column says it can't take cards. The locked card has a lock instead of a handle and can't be dragged. In Reorder, a card moves within its column → AC-21
- [ ] Switch to dark, and turn on forced colours in dev tools → every focus ring above still shows → AC-6

### Commands
- [ ] `pnpm --filter @crm/ui test` → unit, every story in Chromium, Firefox and WebKit (axe clean in light and dark, no CSP violations), and the browser tests pass → AC-2, AC-6, AC-15
- [ ] `pnpm --filter @crm/ui exec vitest run --project perf` (Chromium, 1280 by 800) → the grid with 100,000 rows and 20 columns draws its first screen in under 500 ms (median of 3), never holds 100 rows in the DOM, and a scripted scroll top to bottom has at most one long task, none over 120 ms. CI runs it with 5× CPU throttling → AC-7
- [ ] The LongFeed, LongList and LongColumn stories → 10,000 entries, 5,000 tasks and 2,000 cards draw fewer than 40 rows each and tell their source the range on screen; rows not loaded yet are skeletons → AC-9
- [ ] `pnpm --filter @crm/tokens test` → the contrast pairs, accent line and control border included, pass in both themes → AC-6
- [ ] `pnpm test:visual` → every story with a screenshot matches its Linux baseline in light and dark → AC-16
- [ ] `pnpm ui:artifact --check` → every module's preview builds and renders → AC-17
- [ ] `pnpm size` → the first load stays under its budget, with no grid chunk in it → AC-18
- [ ] `pnpm check` → green

### Value sourcing
- [ ] Today for task due days and feed headings: `dayIn(useNow(), timeZone)` from the provider; weeks start on the language's first day (`periods.test.ts`) → "today", period headings
- [ ] Country names: `Intl.DisplayNames` in the provider's language, through `memoIntl` (the one module level cache) → the country picker
- [ ] Column widths: each type's width tier from the field set registry (`columnWidthFor`) → grid columns
- [ ] Row heights and the board's estimated card height: `sizeToken('size-row')` and `spaceToken` from tokens.json → virtual lists
- [ ] Board columns' counts: `BoardColumn.count` from the screen, never the loaded cards → column counts

## Acceptance-criteria coverage (milestone 3)
- AC-1: every new module and DragHandle has its README and stories · AC-2: loading, empty, error, no access and read only states storied for the feed, tasks, board and record panel · AC-4: the panel surface walk, and the record panel, cards and filters all render through the field set · AC-6: keyboard plays for every module, focus handed on after adds and removals, axe in both themes · AC-7: the perf test · AC-8: the grid's keyboard stories · AC-9: ListSource in the grid, async menus, palette, feed, tasks and board columns · AC-11: periods, due days and country names from the provider · AC-21: the board's keyboard move, reorder, locked card, archived refusal and hidden columns stories
- Not covered yet: J and K to step through records in the panel, and arrow keys between values in AttributeList, are left for the screens that use them (#17).
- Later milestones add their steps here.
