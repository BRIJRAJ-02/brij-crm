# 0003. The component library, built code first

**Date**: 2026-10-01
**Status**: In Progress

## Summary

This spec builds the whole design system in `packages/ui` before any feature screen: about 100 atoms, molecules and modules (small pieces, groups of pieces, and whole blocks such as the data grid), plus one field design for each of 20 attribute types. Each has every state, a Storybook story per state, tests in three real browsers, and screenshots. Components are written once, in code, and a script publishes them back to the design system artifact, so the artifact and the app can never drift apart. Tokens still flow the other way, from the artifact into code. It also fixes, in `packages/contracts`, the exact shape of every attribute value (a date, a currency amount, a phone number), so every field, the API and the database agree on one shape. Building all of it first delays the first real flow (the Core loop, #10); that was a deliberate choice.

## Structure

This is an umbrella spec. This file holds the contract (requirements, the cross child contracts, the build plan). Each child spec is complete enough to build its part from:

- [0003-conventions.md](0003-conventions.md): how every component is built: folders, entry points, React Aria wiring, props, states, styling, motion, copy, the provider, lint guards. Supports every AC.
- [0003-attribute-values.md](0003-attribute-values.md): the value shapes in `packages/contracts`, the history envelope, and the one display and one editor per attribute type. Supports AC-3, AC-4, AC-5, AC-11, AC-14.
- [0003-inventory.md](0003-inventory.md): the full list of components, which features need each, and what each ports or adds. Supports AC-1, AC-2.
- [0003-workbench-and-tests.md](0003-workbench-and-tests.md): Storybook 10, stories as Vitest browser tests in three engines, accessibility checks, Linux screenshot baselines. Supports AC-6, AC-15, AC-16.
- [0003-artifact-publishing.md](0003-artifact-publishing.md): the code first publish to the artifact, with React 19 packed in. Supports AC-17.
- [0003-data-grid.md](0003-data-grid.md): the grid on TanStack Virtual, with column state of our own: rows from outside, keyboard, editing, columns, selection, copy and paste, the 100,000 row test. Supports AC-7, AC-8, AC-9.
- [0003-rich-text-and-email.md](0003-rich-text-and-email.md): one Tiptap editor for notes, comments and email, and the sandboxed email body. Supports AC-14.
- [0003-charts-board-and-schema-map.md](0003-charts-board-and-schema-map.md): charts on visx, the board and dashboard with React Aria drag and drop, the schema map on React Flow with ELK. Supports AC-20, AC-21.

## Rationale

Reasoning, options and the Attio comparison: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As someone building a feature screen, I want every piece I need already in the library, with every state, so I assemble screens instead of writing markup or CSS.
- As a person using the CRM, I want each kind of value (a date, a phone number, a tag) to look and edit the same way everywhere, so I learn each control once.
- As a keyboard or screen reader user, I want every control, the grid and the board to work without a mouse.
- As the product owner, I want the design system artifact to always show exactly what the app ships, so reviewing the artifact is reviewing the product.
- As someone working at a million records, I want the grid to scroll and edit smoothly, however many rows there are.

**Acceptance criteria**:
- **AC-1**: Every component in [0003-inventory.md](0003-inventory.md) exists in `packages/ui`, exported from its entry point, with a README (what it is for, why it exists, how its API differs from the artifact's) and a story for each of its states. `pnpm house-rules` fails when a component folder lacks its README or stories file.
- **AC-2**: Every component that can be empty, loading, in error, read only or disabled has that state built in and storied. Interactive ones also show hover (only under `(hover: hover) and (pointer: fine)`), visible focus, and selected where it applies.
- **AC-3**: `packages/contracts` exports one Zod schema per attribute value shape in [0003-attribute-values.md](0003-attribute-values.md), plus the option, display and history envelope shapes, each with a type of the same name. Valid samples parse; invalid ones are refused with a stable code; an empty value is `null`.
- **AC-4**: Each attribute type has exactly one display and one editor, registered once. The grid cell, record panel, create form, board card, filter value and import preview all render through them; a test walks every type through each of those six surfaces. No other component renders an attribute value itself.
- **AC-5**: What an editor emits always parses with its type's schema. Invalid input (an email without a domain, a domain with a space, a number with five decimals, a phone that isn't a number) shows the Field error state with a sentence saying how to fix it, and emits nothing.
- **AC-6**: Every interactive component works by keyboard alone (open, move, choose, close; Esc returns focus to the trigger), shows the focus ring in light, dark and forced colours, and every story state has zero axe violations in both themes.
- **AC-7**: In a 1280 by 800 viewport, the grid with 100,000 rows and 20 columns renders its first screen in under 500 ms (median of 3 runs) and never holds 100 or more rows in the DOM. A scripted scroll from top to bottom produces at most one long task, and none over 120 ms (Chromium, in CI).
- **AC-8**: In the grid, arrow keys, Home, End, Page Up and Page Down move between cells. Enter or typing edits in place with the column's editor, Esc cancels, Tab and Enter commit and move on, and Delete or Backspace clears (a required attribute refuses, a checkbox becomes false). Columns resize and reorder by pointer and from the header menu by keyboard, and the row header stays pinned. Selection supports shift ranges, all on screen, and all matching. A cell range copies as tab separated text, and pasted text goes through each column's type, with refused cells reported. Shortcuts use ⌘ on Mac and Ctrl elsewhere.
- **AC-9**: The grid, board columns, async menus and pickers, the command palette, the timeline, task lists and the notification inbox take their items from outside through one `ListSource` (`count`, `getItem`, a range callback). They show skeletons for items not loaded yet and never need every item in memory.
- **AC-10**: Enter and exit animations use the motion tokens: menus grow from their trigger, dialogs from the centre, toasts rise, exits are faster, and pressables scale while pressed. Anything opened from the keyboard appears instantly. Reduced motion keeps fades and drops movement.
- **AC-11**: Dates, numbers, money and times format in the provider's language and time zone (the browser's for now). The calendar's first day follows the language, "today" is today in that time zone, and relative times ("3 hours ago") update while shown.
- **AC-12**: Built in copy lives in each component's `strings.ts`. Lint fails on literal text in component markup in `packages/ui`.
- **AC-13**: Toasts leave after 5 seconds, paused while hovered or focused. Errors and toasts with an action stay until dismissed, and at most three show at once. A skeleton appears only after 200 ms of loading and then stays at least 300 ms.
- **AC-14**: Untrusted content is contained. Email bodies render in a sandboxed frame where scripts never run, and remote images load only after "Show images". A link is clickable only for `http`, `https`, `mailto`, `tel` and paths on our own origin, checked by one `safeHref()`. Rich text renders from the editor's schema, never as raw HTML, and the stored document refuses any other link. An image renders only from our origin, `data:image` or `blob:` (`safeImageSrc()`), and otherwise falls back to initials or a file icon.
- **AC-15**: Every story runs as a Vitest browser test in Chromium, Firefox and WebKit in CI, with interaction checks (`play` functions) for every interactive component.
- **AC-16**: Every story state has a screenshot baseline in light and dark, made in one pinned Linux image. CI fails on a visual change whose baseline wasn't updated in the same change.
- **AC-17**: `pnpm ui:artifact` builds the artifact's component files: React 19 as global scripts, the component bundle and stylesheet, rolled up types, a live preview per component made from its stories, and its README. Published after your OK, the artifact shows every component live, and `packages/ui/artifact.json` records the published version.
- **AC-18**: CI fails when the web app's first load (the index route's entry chunk and its static imports, read from Vite's manifest) passes its budget: 250 KB of JavaScript and 40 KB of CSS, gzipped. A test fails if the grid, editor, charts or schema map chunk is in that static import graph.
- **AC-19**: React Aria, TanStack Virtual, Tiptap, visx, React Flow, ELK and libphonenumber-js are imported only inside `packages/ui`, and Yjs only inside `packages/ui` and `packages/data`. Screens import only `@crm/ui`, `packages/ui` makes no network calls, and lint enforces all three.
- **AC-20**: Charts draw in token colours, change theme with no React render (a test counts renders across a theme switch), mark each series with a shape as well as a colour (at most 9 series; the rest fold into "Other"), and each offers its data as a table. The schema map lays out 50 objects with no overlapping nodes, labels each line with both attribute names and the cardinality, and creates a relationship by drawing a line, with a keyboard alternative.
- **AC-21**: Board cards move between columns, and within a column when the screen allows reordering, by pointer and by keyboard. Dashboard tiles reorder by a drag handle or a Move menu. A read only card can't be dragged, a drop onto an archived option's column is refused, and empty columns can be shown or hidden.
- **AC-22**: The status screen is rebuilt from library components, with no markup or styles of its own, and its words in its own `strings.ts`, never inline.

## Decision

**Chosen option**: Option 1: code first, the full inventory now, on the stack spec 0001 already chose.

Build every component once in `packages/ui` on React Aria Components, CSS Modules and tokens, with Storybook 10 stories that double as browser tests and artifact previews, and publish the library to the design system artifact from code. Attribute value shapes become Zod schemas in `packages/contracts`. Heavy modules use TanStack Virtual with column state of our own (grid; TanStack Table is dropped, which amends spec 0001), Tiptap 3 (rich text), visx (charts), React Aria drag and drop (board, dashboard, columns) and React Flow 12 with ELK (schema map).

**Implementation skills**: `crm-design-system` (this repo, `.claude/skills/crm-design-system/`) · `building-components` (`vercel/components.build`, `.claude/skills/building-components/`) · `semantic-html-first` (`kemiljk/skills`, `.claude/skills/semantic-html-first/`) · `modern-css-html` (`kemiljk/skills`, `.claude/skills/modern-css-html/`) · `emil-design-eng` (`emilkowalski/skills`, `.claude/skills/emil-design-eng/`) · `review-animations` (`emilkowalski/skills`, `.claude/skills/review-animations/`) · `interface-affordances` (`kemiljk/skills`, `.claude/skills/interface-affordances/`) · `tanstack-virtual` (`tanstack-skills/tanstack-skills`, `.claude/skills/tanstack-virtual/`) · `tiptap` (`ueberdosis/tiptap`, `.claude/skills/tiptap/`) · `react-flow` (`existential-birds/beagle`, `.claude/skills/react-flow/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `vite` (`antfu/skills`, `.claude/skills/vite/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`)

## Feature design

### Cross child contracts

**Package layout and entry points** (`packages/ui`, tag `client`):

| Import | Holds | Loaded by |
|---|---|---|
| `@crm/ui` | Atoms, molecules, the field set, and the light modules (app shell, panels, feeds, builders) | Every screen |
| `@crm/ui/grid` | `DataGrid` | Table views, import preview, audit log |
| `@crm/ui/editor` | `RichTextEditor`, `NoteEditor`, `CommentComposer`, `EmailComposer` | Record pages, notes, comments, email |
| `@crm/ui/charts` | Chart components and `Dashboard` | Reports and dashboards |
| `@crm/ui/schema-map` | `SchemaMap` | Schema map settings |
| `@crm/ui/theme` | The theme controller (from spec 0002) | `main.tsx`, the boot script test |
| `@crm/ui/styles.css` | The root stylesheet (from spec 0002) | `main.tsx` |
| `@crm/ui/vite` | `uiVite()`: the CSS module naming and shared Vite settings | `apps/web`, Storybook, the artifact build |

**Shared shapes** (Zod schemas in `packages/contracts`, one name per schema and type): the attribute value shapes, `SelectOption`, `StatusOption`, `ValueVersion` (the history envelope) and the display shapes `RecordRefDisplay`, `ActorDisplay` and `FileDisplay`. Also `FilterCondition`, `RichTextDoc`, the fixed `CURRENCY_CODES` list, `HUES` and the curated `ObjectIcon` names. All are defined in [0003-attribute-values.md](0003-attribute-values.md). They live in a pure Zod entry, `@crm/contracts/values` (no oRPC, no I/O), which `packages/ui` imports at runtime, because editors must parse what they emit.

**The provider**: `apps/web` wraps the app in `<UiProvider locale timeZone navigate useHref toasts>`. It supplies React Aria's `I18nProvider` and `RouterProvider` (so library links use TanStack Router), the shared clock for relative times, and the toast region. `toasts` comes from `createToasts()`, called once in `main.tsx` and also handed to `@crm/data`, so the data layer can raise toasts with no module level state. Components never read the browser's language, time zone or clock themselves. See [0003-conventions.md](0003-conventions.md).

**Data in, events out**: library components hold no CRM data and make no network calls. Data arrives through props (from `@crm/data` in screens), long lists through `ListSource` ([0003-conventions.md](0003-conventions.md)), and changes leave through typed callbacks (`onChange(value)`, `onCellChange`, `onMove`). A live note's editing session (Yjs) is created by `@crm/data` in #27 and passed in as one opaque `CollabSession`. Optimistic writes, rollback and undo stay in the data layer (house rule `crm-frontend-state`). A component shows a refusal the screen passes back (`error`), and the data layer raises the toast.

### Data model sketch

Nothing is stored by this feature. It defines shapes, not tables:
- The attribute value shapes, option shapes, display shapes and `ValueVersion` in `packages/contracts` (full table in [0003-attribute-values.md](0003-attribute-values.md)). #5 decides how they are stored.
- `packages/ui/artifact.json`: `{ "artifact": "<url>", "version": "<published version id>", "published": "<date>" }`, the last publish to the artifact.
- Screenshot baselines (PNG) committed under `packages/ui`, one per story state and theme.

### API surface

The library's surface is its exports (above) and these commands:

| Command | Does | Fails when |
|---|---|---|
| `pnpm storybook` | Runs the workbench on :6006 | |
| `pnpm --filter @crm/ui test` | Stories as browser tests in Chromium, Firefox and WebKit, plus unit tests | Any story, `play` check or axe check fails |
| `pnpm test:visual` | Screenshot tests in the pinned Linux image (Docker locally, the container in CI) | A screenshot differs from its baseline |
| `pnpm test:visual --update` | Rewrites baselines (in the same image) | |
| `pnpm ui:artifact` | Builds the artifact files into `packages/ui/.artifact/` | Build error, a size cap is broken, or a bundle holds `</script` or `<!--` |
| `pnpm size` | size-limit on the built web app | A budget in AC-18 is passed |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Format a date, number or amount | the language | `UiProvider` `locale`, from `navigator.languages[0]` in `main.tsx`; the user's profile wins once #23 adds it |
| Format a timestamp, compute "today" | the time zone | `UiProvider` `timeZone`, from `Intl.DateTimeFormat().resolvedOptions().timeZone`; the profile later (#23) |
| Calendar's first day | the week start | React Aria, from `locale` |
| Relative time ("3 hours ago") | now | the provider's shared clock, ticking every 30 seconds; `Intl.RelativeTimeFormat(locale)` |
| Currency display | code, then amount | the value's `currency` and `amount`, through `Intl.NumberFormat(locale, { style: 'currency', currencyDisplay: 'code' })` with a string input (exact) |
| Phone display | formatted number | the value's `number` and `country`, through libphonenumber-js `formatInternational` |
| Select tag, status dot | label, hue, archived | the attribute's `SelectOption` or `StatusOption`, passed with the column or field |
| Record chip, member chip | name, avatar, kind | `RecordRefDisplay` or `ActorDisplay`, built by the data layer (#6) |
| A pasted member | which member | `ActorDisplay.email` first, then the exact name, over the members the data layer passes in `TextContext.members` (#6). Only members carry an email; keys, automations and the system never do |
| An avatar with no picture | initials and hue | initials from the display name; hue = a stable hash of the id over `HUES`, unless the display shape names one |
| Object tile | icon and hue | the object's settings (#13), as props |
| Grid rows, long lists | each item | `getItem(index)` from the screen's `ListSource` (#6) |
| Grid footer | calculations | passed in by the screen (computed by #6 and #20 across all matching rows, never in the grid) |
| Grid columns | order, width, pinned | the view's settings (#20), as props; changes leave through `onColumnsChange` |
| Grid column widths | lengths | the `size-column-*` tokens, by the type's width tier in the field set ([0003-data-grid.md](0003-data-grid.md), Column state) |
| Location country | code and name | the code from `COUNTRY_CODES` in `packages/contracts` (ISO 3166 alpha 2); the name from `Intl.DisplayNames(locale, { type: 'region' })` |
| Filter operators and operands | per type | the field set registry and `FilterCondition` ([0003-attribute-values.md](0003-attribute-values.md)); relative dates ("within the last 7 days") resolve against "today" in the provider's time zone |
| Phone parsing without a country | the default country | the region in `locale` (`en-GB` gives GB), else the attribute's `defaultCountry` |
| Number and money digits | fraction digits | the value's own digits, at most 4 (`maximumFractionDigits: 4`); never `Intl`'s default rounding |
| Chart labels and tooltips | formatted values | the chart's `valueAttribute` and `xAttribute`, formatted through the field set |
| Object icon | the icon | one of the curated `ObjectIcon` names (about 150), from the object's settings (#13) |
| Toasts | the queue | the `createToasts()` instance passed to `UiProvider` |
| A live note's document and cursors | Yjs session | `CollabSession` from `@crm/data` (#27) |
| Board columns | columns and counts | the grouping attribute's options and the screen's counts, as props |
| Chart series colours | fill and stroke | series order mapped to the `dot-*` tokens: blue, green, orange, purple, sky, yellow, red, lime, gray |
| Schema map positions | node layout | ELK, run in a same origin module worker on the objects and relations passed in; saved `positions` (#56) pin their nodes, and ELK lays out the rest |
| Toast timing, skeleton delay | durations | constants in `packages/ui` (5 s; 200 ms delay, 300 ms minimum) |
| Tooltip delay | duration | a constant in `packages/ui`: 500 ms of resting before a tooltip opens. While one is showing, the next opens at once (React Aria's warm up), and keyboard focus opens it at once |
| Built in copy | words | each component's `strings.ts` (English) |
| Email body | the document | a `src` URL on an isolated origin from #43; `srcDoc` in stories |
| Artifact version | published id | the Artifact tool's publish result (or a `read` right after, if the result lacks it), written to `artifact.json` |

### Key invariants

- One display and one editor per attribute type, registered once; nothing else renders a value.
- An editor never emits a value its schema refuses.
- No component accepts `className` or `style`; variants are typed props rendered as `data-*` attributes and declared once in the component's CSS.
- No raw colour, size, space, radius, shadow, motion, opacity, scale, layer or breakpoint value in `packages/ui` (Stylelint, from spec 0002). An inline style may only set a custom property (for example `--row-offset`).
- Third party UI building blocks are used only inside `packages/ui`.
- The artifact's components are generated from code. Tokens still come only from the artifact (spec 0002).
- No mutable state at module level (house rule): toasts, the clock and collaboration sessions are created by factories and passed in.
- JavaScript that needs a token's number (row height, column width limits) reads it from `@crm/tokens/tokens.json`, never a literal.

### Security model

The library renders what screens pass it; access is decided upstream (#9, #24), and a field or record the viewer may not see is never passed, so it never renders. The library's own duties:
- No `dangerouslySetInnerHTML` anywhere. Rich text renders through the Tiptap schema, and unknown nodes and marks are dropped on paste and load. `RichTextDoc` refuses disallowed links too, because #45 builds outgoing HTML from it on the server.
- Links: `safeHref()` allows `http:`, `https:`, `mailto:`, `tel:` and single slash paths on our origin; anything else renders as text.
- Email bodies: a sandboxed iframe (no `allow-scripts`, no `allow-same-origin`, `referrerpolicy="no-referrer"`), images off until asked. The public prop takes only a `src` URL; raw HTML (`srcDoc`) is a stories only export ([0003-rich-text-and-email.md](0003-rich-text-and-email.md)).
- Frames: today's CSP has no `frame-src`, so it falls back to `'self'`. #43 adds its email origin to `frame-src`. `FilePreview` shows images only; PDFs open in a new tab through #32's download link (Chrome won't show a PDF in a sandboxed frame, and `object-src` is `'none'`).
- Images: `safeImageSrc()` allows our origin, `data:image/` and `blob:`, matching today's CSP (`img-src 'self' data: blob:`); anything else falls back to initials or a file icon. Outside images (enriched logos, avatars) wait for #32 and #47 to serve them through our origin.
- Workers: the ELK worker is a real same origin file, never an inlined `blob:` worker, which `script-src 'self'` blocks.
- No network calls from `packages/ui` (lint).
- Story tests watch for `securitypolicyviolation` events under the production `style-src`, `img-src`, `worker-src` and `frame-src` rules, so a library that injects a `<style>` tag is caught.

### Configuration required

No new environment variables or credentials. CI gains Playwright's three browsers and a job in the pinned Playwright Linux container for screenshots.

### Critical test scenarios

- Happy path: a person record's attributes render through the field set in a grid cell, the record panel, a form and a board card, and an edit in each emits a value its schema accepts, verifies **AC-3**, **AC-4**, **AC-5**.
- Scale: 100,000 rows by 20 columns scroll top to bottom within the long task and DOM budgets, verifies **AC-7**, **AC-9**.
- Keyboard: the grid, a menu, the date picker, the board and the command palette are each driven start to finish by keyboard alone, with focus returned on close, verifies **AC-6**, **AC-8**, **AC-21**.
- Failure case: a pasted range with two invalid cells writes the valid ones, reports the two, and emits nothing invalid, verifies **AC-5**, **AC-8**.
- Untrusted input: an email body with a script, an `onerror` handler and a remote image runs nothing and loads no image until "Show images"; a `javascript:` URL renders as text, verifies **AC-14**.
- Regression: an unrelated CSS change that moves a button 1px fails the screenshot job, verifies **AC-16**.
- Publish: a fresh `pnpm ui:artifact` published to the artifact renders the Button preview live on React 19, verifies **AC-17**.

## Build plan

Tracer Bullet inside the library: milestone 1 threads one component through every layer (React Aria, CSS module, story, three browser tests, axe, screenshot, artifact publish, use in the app). Then each milestone thickens one strand. The whole library lands before #5 starts, as chosen.

**Milestone 1: one component through the whole pipeline**
1. Add `uiVite()` in `@crm/ui/vite` (CSS module names `ws-<component>-<local>`) and use it in `apps/web`. Add the browser policy (`browserslist`: the last two versions of Chrome, Edge, Firefox and Safari) to the root `package.json`, satisfies **AC-15**, **AC-17**.
2. Add `UiProvider` (React Aria `I18nProvider` and `RouterProvider`, the shared clock, the toast region, `useDelayedLoading`) and wrap the app in `main.tsx`, satisfies **AC-11**, **AC-13**.
3. Set up Storybook 10 in `packages/ui` with the a11y, Vitest and MCP addons, and Vitest browser projects for Chromium, Firefox and WebKit; add them to CI, satisfies **AC-6**, **AC-15**.
4. Add the screenshot project (`pnpm test:visual`) in the pinned Playwright Linux image, locally through Docker and in CI as a container job, satisfies **AC-16**.
5. Port `Button` and `SplitButton` on React Aria, with every state, README, strings and stories. Give `Icon` stories, satisfies **AC-1**, **AC-2**, **AC-6**, **AC-10**.
6. Write `pnpm ui:artifact`, archive the artifact's hand drawn component files under `archived/`, and publish `Button` and `Icon` with React 19 on your OK. Record `artifact.json`, satisfies **AC-17**.
7. Add the lint guards (UI libraries only inside `packages/ui`, Yjs also in `packages/data`, no network calls in the library, no literal text or label attributes in its markup, value atoms not imported by screens, default exports allowed only for stories and config, system colours only inside `forced-colors`). Add the `size` job: measure today's first load as a baseline, set the AC-18 budgets, and add the manifest test, satisfies **AC-12**, **AC-18**, **AC-19**.
8. Update the `crm-design-system` skill (components flow code to artifact, tokens artifact to code) and the Icon README's note on picking icons (the curated `ObjectIcon` set replaces the dynamic loader). Plan the CI shard count from milestone 1's test timings, satisfies **AC-15**, **AC-17**.

**Milestone 2: atoms, overlays, values and the field set**
9. Build every atom in the inventory, satisfies **AC-1**, **AC-2**, **AC-6**.
10. Build the overlay layer: `Popover`, `Tooltip`, `Menu` (searchable, async and virtualised), `ContextMenu`, `Modal` (dialog and window), `Panel`, and the toast API, with exit animations, satisfies **AC-6**, **AC-10**, **AC-13**.
11. Add the value, option, display and history schemas to `packages/contracts`, with parse tests, satisfies **AC-3**.
12. Build the field set: one display and one editor per type, registered once, with filter operators, text conversion for copy and paste, and lazy libphonenumber-js, satisfies **AC-4**, **AC-5**, **AC-11**, **AC-14**.
13. Build the remaining molecules in the inventory, satisfies **AC-1**, **AC-2**, **AC-6**. (`KanbanCard` and `KanbanColumn` moved to milestone 3, where the board gives them their drag and drop.)
14. Rebuild the status screen from library components (`AppShell` not needed yet: `EmptyState`, `StatusDot`, `Card`, `Button`), satisfies **AC-22**.

**Milestone 3: the grid and the app shell**
15. Add the new tokens to the artifact through spec 0002's flow, sync them into `packages/tokens`, and swap every borrowed size in the library for its own token ([0003-conventions.md](0003-conventions.md), Tokens this spec adds). Toasts and success text move to the new `success` colour, and its pairs join the contrast test. Add the house rule check against borrowed sizes, each type's width tier to the field set registry, `COUNTRY_CODES` with the stricter `countryCode`, `email` on `ActorDisplay` for members (pasted members match it first), and the 500 ms tooltip delay with a story that checks it, satisfies **AC-6**, **AC-8**, **AC-11**.
16. Build `DataGrid` on TanStack Virtual with our own column state: the row source, keyboard model, editing in place through the field set, columns, selection, clearing, copy and paste, the footer, satisfies **AC-4**, **AC-8**, **AC-9**.
17. Add the 100,000 row performance test, satisfies **AC-7**.
18. Build the shell and view modules: app shell, sidebar, top bar, view bar, toolbar, filter and sort builders, view settings, command palette, bulk action bar, record panel and header, attribute list (with the country picker in the location editor), timeline, tasks, and the board (`KanbanColumn`, `KanbanCard`) with React Aria drag and drop, satisfies **AC-1**, **AC-2**, **AC-9**, **AC-21**.

**Milestone 4: rich text, collaboration, data in and out, settings and builders**
19. Build `RichTextEditor` on Tiptap 3 (note, comment and email modes, mentions, variables, the format toolbar, the collaboration hook), satisfies **AC-1**, **AC-14**.
20. Build the note, comment, email, meeting, version history, presence and notification modules, satisfies **AC-1**, **AC-2**, **AC-14**.
21. Build the import mapper, merge view, file preview, change preview and progress flows, satisfies **AC-1**, **AC-2**.
22. Build the settings, admin, auth and builder modules in the inventory (looks now, feature logic later), satisfies **AC-1**, **AC-2**.

**Milestone 5: charts, schema map and the full publish**
23. Build the charts on visx and the dashboard (cards with a Move menu, and drag by handle), satisfies **AC-20**, **AC-21**.
24. Build `SchemaMap` on React Flow with ELK in a worker, satisfies **AC-20**.
25. Publish the whole library to the artifact, in several calls with the index last. Run `design-system-guardian` and `ux-interaction-reviewer` over every module, and have the size budget green, satisfies **AC-1**, **AC-17**, **AC-18**.

## Consequences

**Positive**:
- Feature screens assemble from finished parts, and every attribute type behaves the same everywhere from day one.
- One implementation: the artifact always matches what ships, and reviewing it is reviewing the product.
- The value shapes are settled before the data model, the API and imports, so all three are built against one contract.
- Accessibility, motion and theming are proven per component in three engines, not rediscovered per screen.

**Negative / tradeoffs**:
- The first real flow (#10) waits for the whole library, and then #5 to #57.
- About 100 components are built before the features that use them. When a later spec (#13, #16, #20, #46, #53, #54) settles its behaviour, some APIs will change. "Look now, logic later" limits that, but doesn't remove it.
- Many new dependencies: Storybook, React Aria, Tiptap, Yjs, visx, React Flow, ELK, libphonenumber-js, size-limit. Each must be kept up to date.
- Three browsers plus screenshots make CI slower, and baselines need upkeep (Docker locally to update them).
- Code first reverses spec 0001's "the artifact wins" for components. Anything edited on the artifact page must be merged back before the next publish, or it is overwritten.
- The grid's keyboard model and column state are built on our side (TanStack Virtual only draws rows), which is the riskiest code here.
- Screenshot baselines (light and dark, every state) grow the repo, kept in plain git under a per image size cap.

**Neutral**:
- The artifact's hand drawn component code moves to `archived/`; its README guidance carries into each component's README.
- The Field card's table gains Personal name, Actor reference, Interaction and File, and Select gains "allow multiple" (replacing Multi select).
- The scope's #13 list of types now differs from these shapes, so it needs a `/scope` pass.
- Spec 0001 loses TanStack Table, and spec 0002's note about Lucide's dynamic loader gives way to a curated set of object icons.

## Follow-up

- [ ] #5 Data model: store the value shapes and `ValueVersion` exactly as defined here, and serve the display shapes.
- [ ] #6 Client data: implement the row source (`rowCount`, `getRow`, range callback) and build `RecordRefDisplay`, `ActorDisplay` (with `email` for members) and `FileDisplay`.
- [ ] #13: run `/scope` to update its list of types (personal name, actor reference, interaction, file; select with "allow multiple").
- [ ] #43: email bodies need an isolated origin with its own CSP (an iframe `srcDoc` inherits our `style-src 'self'` and loses the email's styles), whose `frame-ancestors` allows only our app; our CSP adds that origin to `frame-src`; plus an image proxy behind "Show images".
- [ ] #27: `@crm/data` creates the `CollabSession` (Yjs document, awareness and the Hocuspocus provider).
- [ ] #21: decide how card order within a column is stored before `isReorderable` is turned on.
- [ ] #20: decide how `FilterCondition`s are evaluated and saved with views.
- [ ] #30: decide whether imports check phone validity on the server (libphonenumber-js in the API), since contracts checks only the shape.
- [ ] #32 and #47: serve files, avatars and enriched logos through our own origin, or widen `img-src` deliberately.
- [ ] #25: pick the QR code generator for the two factor setup look built here.
- [ ] #11: report module error fallbacks to Sentry.
- [ ] #16, #46, #48, #53, #54: these features own the logic of the builder looks built here (formula, sequence, form, automation, assistant).
- [ ] Translation: add a message catalog behind `strings.ts` when a second language is needed.
- [ ] After each publish, open the artifact page once so it regenerates its `api/` cards (they refresh only on a page save).
- [ ] `/sync`: record the `tiptap` and `react-flow` skills and the Storybook MCP in `packages/ui/AGENTS.md`. The community accessibility testing skill was picked but no longer exists in its repo.
- [ ] Windows forced colours: check every focus ring and selected state there (from spec 0002's follow ups).
