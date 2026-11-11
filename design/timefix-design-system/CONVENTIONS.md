# Timefix design system: build conventions

The source for every component in the Timefix design system artifact. It is laid out like `@crm/ui` so it can move into `packages/ui` later. Read this whole file before writing a component.

## Stack

- React 19 + **react-aria-components** (RAC) 1.21 for every interactive behaviour (focus, keyboard, overlays, selection, drag and drop). Never hand-roll what RAC has: Button, ToggleButton, ToggleButtonGroup, Menu, MenuTrigger, SubmenuTrigger, Popover, Dialog, Modal, ModalOverlay, Tooltip, TooltipTrigger, Select, ComboBox, ListBox, GridList (+ useDragAndDrop), Table, Tabs, Checkbox, CheckboxGroup, RadioGroup, Switch, Slider, TextField, SearchField, NumberField, DatePicker, Calendar, RangeCalendar, DateField, TimeField, Disclosure, Breadcrumbs, ColorSwatch, Toolbar, Tag/TagGroup, ProgressBar, Meter, DropZone, FileTrigger.
- Icons: `lucide-react`, always through our `Icon` re-exports or direct named imports (`import { Plus } from 'lucide-react'`), size 16, `strokeWidth={1.75}`; 14 inside small controls, 20 in empty states.
- Plain CSS, one file per component, imported by the TSX (`import './Button.css'`). The build bundles all CSS into `bundle.css`.
- No other libraries. No CSS-in-JS. No inline style objects except for genuinely dynamic values (positions, widths, CSS custom properties).

## Files

```
src/components/<Name>/
  <Name>.tsx        the component(s), named exports, props typed, a one-line doc comment per export
  <Name>.css        styles, classes prefixed tf-<name>
  <Name>.demo.tsx   export function <Name>Demo(): the live card content, real states, realistic Timefix data
  README.md         guidelines (format below)
  meta.json         {"group": "...", "height": 240, "replaces": ["existing @crm/ui names it merges"]}
```

Register the component in `src/registry.ts` (import the demo, add to `demos`, and export the components from `src/index.ts`).

## CSS rules (house rules from the repo; the reviewer enforces them)

- **Tokens only.** Every colour, size, space, radius, shadow, duration and easing is a `var(--token)` from `tokens.json` (list at the end of this file). No raw hex, no raw px except `0`, `1px` hairlines, and layout numbers that are not design values (e.g. `grid-template-columns: 1fr auto`). If a value you need is missing, use the nearest token and note it in your report; do not invent tokens.
- Classes: `.tf-<component>`, parts `.tf-<component>__<part>`, variants `.tf-<component>--<variant>`. Style RAC state through its data attributes: `[data-hovered]`, `[data-pressed]`, `[data-focus-visible]`, `[data-selected]`, `[data-disabled]`, `[data-open]`/`[data-expanded]`, `[data-entering]`, `[data-exiting]`, `[data-placement]`, `[data-dragging]`, `[data-drop-target]`, `[data-invalid]`, `[data-indeterminate]`.
- No `!important`. Never reach into another component's classes; compose by rendering that component.
- Focus: `outline: var(--border-width-focus) solid var(--focus-ring); outline-offset: 2px;` on `[data-focus-visible]` only.
- Every component works in light and dark (tokens switch under `[data-theme]`). Check both.
- `@media (prefers-reduced-motion: reduce)`: transitions and animations become instant (set `transition: none` / `animation: none` in the component file).

## Visual language (approved by the owner)

- Soft grey `canvas`; white `surface` cards; related cards grouped in a `surface-shell` (6px padding, `radius-xl` 20) with `radius-lg` 14 cards inside.
- Buttons are pills. The main action is ink (`--primary` / `--on-primary`). Blue (`--accent`) marks selection and time only (checked, selected, chosen date, active tab line, progress, meetings). Blue is never a button fill.
- Controls: 28 (`--size-control-sm`), 36 (`--size-control`), 44 (`--size-control-lg`). Rows 44. Menu items 36 with `radius-md`. Nav items 34 pills.
- Inputs are filled `surface-subtle` with no border at rest; on focus white with an `accent` 1px edge plus a 2px `accent-border` ring. Search is an outlined pill.
- Status tags: text and icon take the hue (`--tag-<hue>-text` on `--tag-<hue>-bg`), with a shape per status (dashed circle draft, half circle in progress, pie in review, filled check done, crossed circle failed/cancelled, clock waiting/expired). These icons live in `src/components/Icon/StatusIcon.tsx`.
- Type: Geist. Titles 500 weight; `heading` 600; body 14/20; labels 12-13/16-20 500; grey sub-lines `--text-secondary` 13px. Numbers: `font-variant-numeric: tabular-nums`.
- Person/record rows: avatar, name (`body-strong`) over a grey sub-line, 12px gap.
- No gradients, no coloured left borders, no emoji, no illustrations, no glassmorphism.

## Interaction and motion spec (transitions.dev)

Motion follows **transitions.dev** (the owner's reference). The `transitions-dev` skill's files (`~/.claude/skills/transitions-dev/`) (`SKILL.md` has the decision rules and the token table; `NN-*.md` has each transition's tuned CSS and JS). For every component, pick the matching transition with the decision rules, **read that reference file**, and port it onto React Aria's state attributes (`[data-entering]`, `[data-exiting]`, `[data-selected]`, `[data-open]`, `aria-expanded` …) instead of the snippet's `.t-*` classes. Keep its timings, easings and distances exactly, expressed with our tokens below, and keep its reduced-motion guard. House rules win over the reference: **no blur in motion** (opacity and translate only) and **no press scale** (a pressed control changes colour, never size; `--scale-press` stays 1). Scales are for surfaces opening and closing, not for presses.

Motion tokens (choose by usage, not number):
- Durations: `--duration-stagger` 40, `--duration-micro` 80 (delays, shake segments), `--duration-quick` 150 (hover, press, close of menus/selects/dialogs, text swap, tooltip appear, checkbox fill), `--duration-fast` 250 (menu/popover/select/dialog open, icon swap, tab and segmented pill slide, page slide), `--duration-medium` 350 (drawer and toast close, tick draw, switch travel), `--duration-slow` 400 (drawer and panel open, skeleton reveal, input clear), `--duration-very-slow` 500 (success check, badge appear, hero text reveal, rolling digits).
- Easings: `--ease-smooth-out` (default for open, close, move, resize, press), `--ease-in-out` (crossfades: icon and text swap, reveals), `--ease-out` (tooltips, hover colour), `--ease-linear` (spinners, pulse), `--ease-bounce` (small pops: badges, counts, switch overshoot, digits), `--ease-bounce-strong` (only the hovered avatar/chip return).
- Distances: `--distance-micro` 4, `--distance-small` 6, `--distance-base` 8, `--distance-medium` 12, `--distance-large` 30. Scales: `--scale-large` .96 (dialog), `--scale-medium` .97 (menus open), `--scale-small` .98 (tooltip), `--scale-tiny` .99 (menu close). Blur: `--blur-small` 2, `--blur-medium` 3, `--blur-large` 8.

Which transition for what (from the decision rules):
- Menus, selects, comboboxes, popovers, date pickers → **05 menu dropdown** (origin-aware from the trigger, 250 in / 150 out, .97 → 1 open, .99 out).
- Dialogs → **06 modal**. Drawers / side panels → **07 panel reveal**. Multi-step flows inside one surface → **08 page side-by-side**. Size changes of a card or popover → **01 card resize**.
- Tabs and segmented controls → **16 tabs sliding** (measured pill). Accordions, disclosures, "show more", filter sections → **21 accordion**.
- Toasts → **22 toast**; several at once → **32 banner stacking**. Save/confirm moments → **10 success check**. Labels that change state → **33 text morph** when they share letters (Copy link → Copied), **04 text states swap** otherwise, **34 text swap soft** for values recomputed in place (a chart period, a currency).
- Numbers that change → **02 number pop-in** (or `NumberRoll` from Motion for counters). New-count dots on a trigger → **03 notification badge**.
- Two icons in one slot (play/pause, copy/check, chevrons) → **09 icon swap**. Avatar, chip or tag stacks on hover → **11 avatar group hover**.
- Invalid field or wrong code → **12 error state shake**. Clearing a search or filter → **13 input clear with dissolve**. Loading → **14 skeleton reveal**; AI thinking → **15 shimmer text** / **28 thinking states**; AI writing → **30 streaming text**.
- Tooltips → **17 tooltip**. Empty states and onboarding headlines → **18 texts reveal**. A + button that becomes its menu → **20 plus to menu morph**. "Learn more" links → **24 learn more hover**. Checkboxes → **25 checkbox check**. Switches → **27 toggle**. Donut charts → **35 donut chart**.

Crafted details the owner loves (keep them):
1. The trigger stays pressed (`surface-selected`) while its menu or select is open.
2. Picking an option shows its tick drawing, then the menu closes ~120ms later.
3. Lists: new rows drop in at the top (grid-template-rows 0fr → 1fr + `distance-medium` rise, `duration-fast`); removed rows collapse the same way, or collapse in place to "Deleted · Undo"; a changed row gets a brief `accent-soft` wash.
4. Drag: the dragged item lifts (`shadow-md`, scale 1.02, no tilt), the source leaves a faint ghost, the drop slot opens as a dashed `border-strong` placeholder; drop settles over `duration-fast`.
5. Destructive actions prefer Undo in a toast over a confirm.
6. Keyboard is first-class: every demo fully usable with Tab, arrows, Enter, Space, Esc; shortcuts shown as `Kbd`.
7. Press: buttons `scale(var(--scale-medium))`, icon buttons `scale(var(--scale-large))`, over `duration-quick`. Rows and menu items wash instead of scaling.

## Demo rules

- The demo is the component's card in the artifact: show the real states side by side (default, hover can't be shown statically so make it live, selected, disabled, invalid, loading, empty) and make every control actually work (state with `useState`).
- Realistic Timefix data: people (Priya Raman, Sam Kim, Jo Mendes, Ava Chen, Maria Bell), companies (Acme Corp, Northwind, Globex, Initech), meetings (Discovery call 30 min, Demo 45 min), booking pages, forms.
- The card's root has `className="tf-demo"` (padding 16, surface background) unless it needs the canvas (`tf-demo tf-demo--canvas`).
- Keep each demo under ~250 lines.

## README format (guidelines shown beside the card)

First sentence: what it is for (it becomes the summary). Then: **Use it for / Don't use it for**, **The consumer provides** (props), **States**, **Interaction** (keyboard + motion specifics), **Replaces** (the existing `@crm/ui` components it merges). Plain sentences, sentence case, no emoji, about 120-220 words.

## Tokens available

Colours (per theme): canvas, surface-shell, surface, surface-raised, surface-subtle, surface-hover, surface-selected, border-subtle, border, border-strong, control-border, text, text-secondary, text-tertiary, primary, primary-hover, on-primary, accent, accent-hover, accent-soft, accent-border, on-accent, link, focus-ring, success, success-soft, warning, warning-soft, danger, danger-soft, on-danger, ai, surface-inverse, on-inverse, scrim, dot-{gray,red,orange,yellow,lime,green,sky,blue,purple}, tag-{hue}-bg, tag-{hue}-text for the same nine hues.
Shadows: shadow-xs, shadow-sm, shadow-md, shadow-lg.
Spacing: space-2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64.
Radius: radius-xs 4, radius-sm 6, radius-md 10, radius-lg 14, radius-xl 20, radius-full.
Size: size-control-sm 28, size-control 36, size-control-lg 44, size-row 44, size-nav-item 34, size-topbar 56, size-sidebar 256, size-icon 16, size-icon-lg 20, size-avatar 28, size-avatar-lg 44, size-menu 240, size-dialog 480, size-dialog-wide 720, size-panel 440, size-measure 640.
Motion: see the motion tokens above (duration-*, ease-*, distance-*, scale-*, blur-*).
Other: z-sticky, z-popover, z-drawer, z-modal, z-toast, z-tooltip; opacity-disabled, opacity-busy; border-width-hairline, border-width-focus.
Fonts: `var(--font-sans)`, `var(--font-mono)`. Type sizes are set directly with `font: <weight> <size>/<line-height> var(--font-sans)` using the type scale: 32/40, 24/32, 18/26, 15/22, 16/24, 14/20, 13/20, 12/16, 11/16.

## Already built (wave 1: reuse, never restyle or copy)

Every folder in `src/components/` is a finished, reviewed component; read its `.tsx` exports before writing anything. Key shared parts:
- Overlays: `Popover`, `InfoTip` (Popover), `MenuTrigger`/`Menu`/`MenuItem`/`MenuSection`/`SubmenuTrigger`/`ContextMenu` (Menu), `Select`/`MultiSelect` (Select), `ReferencePicker` (ComboBox), `DatePicker`/`Calendar`/`DateRangePicker`/`DateNav` (DatePicker), `TimeSelect`/`TimeField` (TimeField), `Dialog`/`ConfirmDialog`/`StepDialog` (Dialog), `Drawer`/`DrawerPanel` (Drawer), `Tooltip`.
- Inputs: `TextField`/`TextArea`/`Form`/`FieldGroup` (Field), `SearchField`, `NumberField`, `PhoneField`, `CodeInput`, `Slider`, `ChoiceChips`, `FileDrop`, `Checkbox`/`RadioGroup`/`Radio`/`Switch`, `ColorSwatchPicker`/`AccentPicker` (ColorPicker), `IconPicker`.
- Feedback: `ToastProvider`/`useToast` (Toast), `FloatingBar`/`SaveBar`/`PublishBar`/`BulkActionBar`, `Callout`, `EmptyState`/`NoResults`, `Checklist`, `Steps`, `ProgressBar`/`Meter`/`Donut` (Progress).
- Layout and navigation: `Card`/`Shell`/`StatCard`/`TileGrid` (Card), `Tabs`, `SegmentedControl`, `Disclosure*`, `Breadcrumbs`, `Pagination`, `AppShell`/`TopBar`/`Toolbar`, `SettingsLayout`/`SettingsSection`/`SettingsRow`, `Sidebar`, `CommandPalette`.
- Data and records: `Tag`/`StatusDot`/`Count`, `Avatar`/`AvatarGroup`/`PersonLine`, `Kbd`, `DataGrid`, `FilterBar`, `Board`, `Chart` parts, `DescriptionList`, `RecordChip`/`Mention`/`Variable`, `AttributeField`/`AttributeDisplay`/`AttributeEditor`, `RecordHeader`, `RecordPanel`, `ActivityFeed`, `CommentThread`, `NoteList`, `TaskList`, `NotificationList`, `AIAssist` parts.
- Scheduling: `BookingFlow`, `WeekCalendar`/`formatClock`/`formatClockRange` (the one time formatter), `DayStrip`, `HoursEditor`, `MeetingList`/`MeetingCard`, `CalendarConnections`.
- Brand and motion: `Logo`/`LogoMark`, `Button`/`IconButton`, `NumberRoll`/`TextSwap`/`SuccessCheck`/`Spinner`/`Skeleton` (Motion), `StatusIcon`, `cx`.

Times always go through `formatClock` / `formatClockRange` ("9:30 AM", "09:30", "9:30 – 10:00 AM").

## Width: design for the card the owner sees

The artifact draws each card about **650px wide** (it can be wider on large screens). Every demo must look right at 650px: rows must not wrap into tall blobs, nothing may overflow. Use container queries for narrow layouts. A pill radius (`radius-full`) is only for things that stay one line tall; a container that can wrap uses `radius-lg` or none.

## Class names: each folder owns its prefix

Every class a folder styles starts with that folder's own prefix (`tf-floatbar…`, `tf-filterbar…`). Never style a class another folder owns, and never reuse another folder's prefix; compose by rendering the other component. `node scripts/collisions.mjs` must print "collisions: none".

## Building and checking

- `src/registry.ts` and `src/exports.ts` are generated by `node scripts/registry.mjs`; never edit them by hand.
- Check one or a few components compile on their own: `node build.mjs dist/check Name1,Name2`.
- `node scripts/collisions.mjs` must print "collisions: none".
- `./make.sh` builds everything into `dist/`, including the local harness (`dist/index.html?only=Name&w=650&theme=dark`) for screenshots at the artifact's card width, in both themes.
- Report for each change: the components, the `@crm/ui` names they replace, the transitions.dev pattern each uses, and anything left undone.
