# 0003 · Conventions: how every component is built

## Summary

Every component in `packages/ui` is built the same way: a React Aria component underneath for behaviour, a CSS module on tokens for looks, typed props that never take a class name, every state built in, copy in one strings file, and stories beside it. This page is the checklist a component must pass, and the reasons for each rule live inline.

## Folders and files

```
packages/ui/src/
  atoms/<Name>/        Name.tsx · Name.module.css · Name.stories.tsx · strings.ts · README.md
  molecules/<Name>/    same
  modules/<Name>/      same; heavy modules also get their entry file (see below)
  fields/<type>/       <Type>Display.tsx · <Type>Editor.tsx · type.ts (registry entry) · stories · README.md
  provider/            UiProvider, createClock, createToasts, useDelayedLoading
  lib/                 safeHref, safeImageSrc, ListSource, decimal parsing
  index.ts             the main entry (atoms, molecules, fields, light modules)
  grid.ts · editor.ts · charts.ts · schema-map.ts   the heavy entries
  vite.ts              uiVite(), the shared Vite settings
```

- `strings.ts` only when the component renders copy. Unit tests that need no browser (pure helpers) sit beside the code as `*.test.ts`; component behaviour is tested through stories ([0003-workbench-and-tests.md](0003-workbench-and-tests.md)).
- `pnpm house-rules` gains three checks:
  - each component folder has `README.md` and a `*.stories.tsx`;
  - one CSS module per component (the existing rule);
  - component names and story ids are unique across the library, because class names depend on them.
- Field files are named after their type (`CurrencyDisplay.tsx`, `CurrencyEditor.tsx`), so their classes come out as `ws-currency-display-<local>`, never a shared `ws-display-*`.
- Stories, `.storybook/*` and config files may use default exports, since their tools require them (an ESLint override, as AGENTS.md allows). Component behaviour is tested through stories, not `*.test.ts` files; that's this library's exception to "tests beside the source".
- Every export carries a doc comment (house rule).

## Entry points and size

- Heavy modules are separate entries (`@crm/ui/grid`, `/editor`, `/charts`, `/schema-map`), listed in `package.json` `exports`. Routes import them lazily, so they are never in the first load.
- Inside the main entry, rarely used heavy pieces load on demand with `import()`, such as libphonenumber-js (`libphonenumber-js/max`, for full validity) in the phone editor.
- **Icons stay a closed registry.** `IconPicker` offers only the curated `ObjectIcon` set (about 150 Lucide names, listed in contracts and imported in `icons.ts`). Lucide's dynamic loader isn't used; it would emit about 1,500 chunks. This replaces spec 0002's note about the loader.
- **The size check:**
  - What it measures: `size-limit` (`@size-limit/preset-app`) runs on the built web app. It measures the index route's entry chunk plus its static imports, read from `dist/.vite/manifest.json` (its `imports`, never `dynamicImports`).
  - Budgets: 250 KB of JavaScript and 40 KB of CSS, gzipped.
  - The manifest test: a test in `apps/web` reads the manifest and fails if a grid, editor, charts or schema map chunk is in that static graph.
  - Milestone 1 records today's first load as a baseline. Raising a budget is a spec change.

## Behaviour: React Aria underneath

- Every interactive component wraps a React Aria Component (`react-aria-components` 1.21) or its hooks. Never hand roll keyboard, focus, press or overlay logic that React Aria already has.
- Stable exports used: `Button`, `ToggleButton`, `Checkbox`, `RadioGroup`, `Switch`, `Select`, `ComboBox`, `Autocomplete`, `Menu`, `Popover`, `Dialog`, `Modal`, `Tooltip`, `Tabs`, `ListBox`, `GridList`, `Tree`, `Virtualizer`, `DatePicker`, `DateRangePicker`, `Calendar`, `Breadcrumbs`, `Disclosure`, `ProgressBar`, `Meter`, `Separator`, `DropZone`, `FileTrigger`, `useDragAndDrop`, and `Table` (for small settings lists only).
- Toast is still `UNSTABLE_Toast` in 1.21. Use it, but only inside `provider/toasts.tsx`, behind our `createToasts()` and `ToastRegion`, so its rename touches one file. Its animations use `data-animation="entering|queued|exiting"` and view transitions, not the attributes below; view transitions are skipped under reduced motion.
- React Aria's own `Table` is not used for records: its collection holds every item in memory, which fails AC-9.
- The grid is the one exception: TanStack is headless, so its keyboard model is ours ([0003-data-grid.md](0003-data-grid.md)), still built from React Aria's focus utilities (`useFocusRing`, `FocusScope`, `useKeyboard`).

## Props

- **Names**: follow the artifact's names where they exist, but use React Aria's for behaviour and state: `onPress`, `isDisabled`, `isReadOnly`, `isInvalid`, `isSelected`. This lets props pass straight through, and the README lists every difference from the artifact.
- **Values**: controlled and uncontrolled, as `value`, `defaultValue` and `onChange(value)`, where `onChange` receives the typed value, never a DOM event. An empty value is `null`, the wire format AGENTS.md allows `null` for.
- **Long lists**: any component whose items can outgrow the screen takes a `ListSource<T>` instead of an array: `{ count, getItem(index): T | undefined, getKey(item), onRangeChange({ start, end }) }`. An undefined item draws a skeleton. This covers the grid (`RowSource` extends it), board columns, async `Menu` and pickers, `CommandPalette` results, `ActivityFeed`, `TaskList` and `NotificationInbox`. Short, fixed lists (options, tabs) stay arrays.
- **Variants**: a small typed union per dimension (`variant`, `size`, `tone`), using token names, never numbers. Rendered as `data-variant`, `data-size` and `data-tone`, declared once in the CSS module.
- **No escape hatches**: public props never include `className` or `style`, and components don't spread unknown props onto the DOM.
- **Refs**: `ref` is a normal prop (React 19), forwarded to the root element.
- **Labels**: every form control requires `label`. `isLabelHidden` keeps it for screen readers only (grid cells use the column name). An icon only button requires `label`, as the artifact does.
- **States** (every component that can have them):
  - `isLoading`: skeleton or spinner, through `useDelayedLoading` (200 ms delay, 300 ms minimum);
  - `error`: a sentence that says how to fix it;
  - `isReadOnly` with `readOnlyReason`;
  - `isDisabled` with `disabledReason` (both reasons show as the hint the Field card asks for);
  - empty: built in text from `strings.ts`, or an `emptyState` slot.
- **Modules that load**: `status: 'ready' | 'loading' | 'error' | 'no-access'`, with `onRetry` for `error`. `no-access` shows `EmptyState` in its locked tone, for a whole view only (#24: a hidden field or record is simply absent).
- **Overflow** of chips and tags ("+N"): measured with a `ResizeObserver` in cells, a fixed 3 on cards, and a `maxVisible` prop that stories and screenshots set, so they are deterministic. The "+N" chip opens a popover with the rest.
- **Clipboard** (`CopyButton`, `SecretReveal`, the grid): a failed write shows an error toast and selects the text, so it can be copied by hand.

## Styling

- One CSS module per component, all rules inside `@layer components`. Tokens only (Stylelint, spec 0002).
- Class names come out as `ws-<component>-<local>`, through `css.modules.generateScopedName` in `uiVite()`. The app, Storybook and the artifact build share it, so dev tools and the artifact show the same names (spec 0001).
- State styling reads React Aria's attributes: `[data-hovered]`, `[data-pressed]`, `[data-focus-visible]`, `[data-selected]`, `[data-disabled]`, `[data-invalid]`, `[data-entering]`, `[data-exiting]`.
- Hover rules sit inside `@media (hover: hover) and (pointer: fine)`.
- Focus: `box-shadow: var(--shadow-focus)` (or `--shadow-focus-inset` inside cells), with the 1px accent border carrying the contrast. Under `@media (forced-colors: active)`, the focus and selected states use `outline` with system colours (`Highlight`, `CanvasText`). Stylelint allows system colour keywords only inside that media query.
- Adapting to the slot: container queries on `bp-container-sm` and `bp-container-md`. Page layout uses `bp-page-compact` media queries only (the `crm/breakpoint-tokens` rule).
- Logical properties (`margin-inline`, `inset-block`), nesting, `:has()` and `:focus-visible` are fine; every target browser has them.
- An inline style may only set a custom property, which the module then reads (`style={{ '--row-offset': ... }}`), per the existing lint rule.
- Third party CSS (React Flow's base styles) is imported into `@layer components` inside our module, and its variables are mapped to tokens.

## Motion

- Enter and exit use CSS animations on `[data-entering]` and `[data-exiting]`. React Aria keeps an exiting overlay mounted until its animation ends, which gives us the exit animations the artifact lacks.
- Values come from tokens:
  - Durations: `duration-press` 160 ms, `duration-popover` 180 ms, `duration-move` 200 ms, `duration-modal` 240 ms, `duration-exit` 120 ms.
  - Curves: `ease-out`, `ease-in-out`, `ease-drawer`, `ease-hover`.
  - Scales: `scale-press` 0.97 and the popover start scale.
- Origins: menus and popovers grow from their trigger (React Aria's `--trigger-anchor-point` variable gives the transform origin), dialogs from the centre, and toasts rise from below.
- Opened by keyboard means instant. Triggers record React Aria's interaction modality when an overlay opens (`getInteractionModality()`) as `data-opened-by="keyboard"`, and the module skips the animation for it. This includes ⌘K.
- `@media (prefers-reduced-motion: reduce)` keeps opacity transitions and drops transforms. The spinner then pulses its opacity instead of turning, as the skeleton does.

## Copy and formats

- Built in copy lives in `strings.ts` as one `as const` object. Members are plain English strings, or functions for counts and plurals (`hiddenColumns: (n, plural) => ...`), which take an `Intl.PluralRules` for the provider's locale. Components read it, and callers override domain words through props (`emptyTitle`, `confirmLabel`).
- Lint (`no-restricted-syntax`, in `packages/ui/src/**/*.tsx` outside stories) refuses literal copy: JSX text containing letters, and string literals in `aria-label`, `title`, `placeholder`, `alt` and `label` attributes.
- Placeholders follow the Field card ("Set <Attribute>..."), and error sentences say how to fix it.
- Formatting only ever uses the provider's `locale` and `timeZone`, through `Intl` and `@internationalized/date`.
  - **Numbers and money:** formatting passes the decimal string straight to `Intl.NumberFormat`, which formats strings exactly, with `minimumFractionDigits: 0` and `maximumFractionDigits: 4`. For money, it shows at least the currency's minor units and at most 4. `Intl`'s defaults would round to 3 decimals, or to the currency's 2.
  - **Typing numbers:** typed numbers are parsed by our own decimal parser, which reads the locale's group and decimal signs (`1.234,5` in `de-DE` is 1234.5). It runs in a text `Field`, never React Aria's `NumberField`, which holds a lossy JS number. The field's hint shows the expected format.
  - **Dates and times:** dates use `dateStyle: 'medium'` ("Oct 8, 2026"). Exact times in tooltips use `dateStyle: 'medium'` and `timeStyle: 'short'`, with the time zone name.
  - **Relative times:** `Intl.RelativeTimeFormat` with `numeric: 'auto'`, using the largest whole unit. Under a minute shows as "now", past 7 days becomes the date, and it renders again on the provider's 30 second tick.
- Links go through `safeHref(href)`, which allows `http:`, `https:`, `mailto:`, `tel:` and single slash paths on our origin (routed by the router). Images go through `safeImageSrc(src)`, which allows our origin, `data:image/` and `blob:`. Each returns `undefined` when refused, and the component falls back to text, initials or a file icon.

## The provider

```tsx
const toasts = createToasts();        // once, in main.tsx; also passed to createDataLayer
<UiProvider
  locale={navigator.languages[0] ?? 'en-US'}
  timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
  navigate={(href) => router.history.push(href)}
  useHref={(href) => router.history.createHref(href)}
  toasts={toasts}
>
```

- It wraps:
  - React Aria's `I18nProvider` and `RouterProvider`. React Aria hands over full href strings, with search and hash, so they go straight to the router's history. A test checks `?q=a#x`.
  - A clock context (`useNow()`), from `createClock()`. It ticks every 30 seconds and pauses while the tab is hidden.
  - The `ToastRegion` for `toasts`.
- `createToasts()` returns `{ toast({ tone, message, action? }), dismiss(id), queue }` and holds no module level state. Storybook creates one per story.
  - Confirmations last 5 seconds, paused while hovered or focused.
  - Errors, and toasts with an action, stay until dismissed.
  - At most three show at once, and older ones queue.
- `useDelayedLoading(isLoading)` returns whether to show the skeleton (200 ms delay, 300 ms minimum).
- `apps/web/src/main.tsx` passes the browser's language and time zone today. When #23 adds them to the profile, the saved values are passed instead, and no component changes.

## Lint guards (added to `packages/config`)

- **UI libraries stay in the library**: the `client` and `screens` presets refuse imports of `react-aria-components`, `react-aria`, `@react-aria/*`, `@react-stately/*`, `@internationalized/*`, `@tanstack/react-virtual`, `@tiptap/*`, `yjs`, `y-protocols`, `@visx/*`, `@xyflow/react`, `elkjs` and `libphonenumber-js`. `packages/ui`'s own config allows them across the package (they are building blocks, not vendor SDKs, so the one wrapper rule doesn't apply). `packages/data` may also import `yjs` and the Hocuspocus provider, for #27's sessions.
- **One field design, enforced**: screens (`apps/web`) may not import the value atoms (`Currency`, `Tag`, `TagList`, `StatusDot`, `Rating`, `LinkChip`); they render values through `AttributeDisplay`. Inside `packages/ui`, `design-system-guardian` checks that modules do the same.
- **No network in the library**: `packages/ui` refuses `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `@orpc/*` and `@crm/data`, matching the rule `apps/web` already has outside `packages/data`.
- **No literal copy** in `packages/ui` markup (above).
- **System colours** only inside `forced-colors` media (Stylelint).
- **Browser policy**: the root `package.json` gets `"browserslist": ["last 2 Chrome versions", "last 2 Edge versions", "last 2 Firefox versions", "last 2 Safari versions"]`. Vite keeps its default build target (Baseline widely available, which is older than this policy, so it is safe). The three engines in CI are the check that matters.

## README per component

Every README has the same sections:
- **What it is for**: the first sentence, which becomes the artifact summary.
- **Why it exists**: for a new component, why reuse and a variant didn't fit (house rule 5).
- **Use**: a short example and the props.
- **States**.
- **Keyboard**: the keys it answers to.
- **Differences from the artifact**.

Ported components carry the artifact card's guidance forward, rewritten for the code API.
