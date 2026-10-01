---
name: crm-design-system
description: House rules for every piece of UI in this CRM. Use it whenever you build, change, style or review anything visual here, including screens, components, CSS, colours, spacing, tables, fields, forms, drawers, modals, empty states, icons and small visual tweaks, even when the request doesn't mention the design system. It tells you where the design system lives, how to use its tokens and components, and when you're allowed to make a new component.
---

# CRM design system rules

The CRM has one design system, built up front and large on purpose. Every screen is assembled from it. These rules keep a large app looking like one product while many sessions build it in parallel. Without them, each feature drifts a little, and after fifty features the app looks like fifty apps.

## Where it lives

The design system has two halves, and each flows one way (spec 0003):

- **Tokens and the brand book live in the artifact** at https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh?sk=NUiJdAv_8B9f6a2uJRrpBg. Always use this exact link. Read its README first with the Artifact tool (`action: "read"`, `path: "project/README.md"`): copy style, layout, states and icons. Tokens come from its `project/tokens.json` into `packages/tokens` (`pnpm tokens:build`, spec 0002). Read its **Changelog** at the start of each UI task, and bring `packages/tokens` up to date first if the tokens changed.
- **Components live in code**, in `packages/ui`, and are published to the artifact from there (`pnpm ui:artifact`, then the agent publishes after the engineer's OK). The code is the source of truth for every component: its look, its states, its README. The artifact shows what the code ships. Edits someone makes to a component's README on the artifact page are merged back into the code README before the next publish; everything else on the page (bundle, styles, previews) is overwritten by the next publish.
- **Before you use a component**, read its README in `packages/ui/src/<kind>/<Name>/README.md` (what it is for, its states, its keys, how its API differs from the artifact's) and its stories in Storybook (`pnpm storybook`; the Storybook MCP server lets you read stories and props while it runs). The full list of what the library will hold is the inventory in `docs/specs/0003-component-library/0003-inventory.md`; what exists today is what `packages/ui/src/index.ts` exports.
- **Use the right control:**
  - Checkbox is a real checkbox with indeterminate support, used for "select all" in tables.
  - Select shows its options as tags, status dots or people, depending on the attribute.
  - SegmentedControl switches views, such as Table / Board.
  - Field covers long text too: a textarea that grows, with a character count.
  - ThemeSwitch (Light / Dark / System) lives in the sidebar footer.
- **States:** Field, Button and DataTable have their state props built in. Other components (the board, the feed, menus) get their loading, empty, error and no access states by combining Skeleton and EmptyState, so reach for those two before inventing a state.
- **Which control per attribute type:** the field set (spec 0003, `0003-attribute-values.md`) decides which display and which editor each attribute type uses. Follow it exactly.

## The look, in one paragraph

Dense and neutral, in the refined Attio blue direction:
- **Colour:** it comes from the data (tags, statuses, avatars). The chrome stays grey, with greys carrying a faint tint of the blue. One blue marks the action to take, and purple marks anything AI.
- **Objects:** Companies, People, Deals and each list get their own colour tile in the sidebar and top bar.
- **Themes:** every colour has a light and a dark value. In dark mode, surfaces get lighter as they rise, so layers read without heavy shadows.
- **Details:** buttons and keycaps have a hairline keycap edge.
- **Sizes:** type is Inter, 13px for body and 11px for labels. Rows are 34px, buttons 26px and the sidebar 260px.

Use those numbers through their tokens, never as literals.

## The rules, and why

1. **Tokens only.** Every colour, size, space, radius, shadow and motion value comes from a token. Never write a raw hex, px or ms value in app code. Tokens are what let light and dark themes, density changes and rebrands happen in one place. The build has a check that fails on raw values, so it's cheaper to get it right first.
2. **Componentised: atoms, molecules, modules.** A screen composes modules. Modules compose molecules, and molecules compose atoms. If a screen needs markup that isn't one of these, that's a signal something belongs in the library.
3. **One field design everywhere.** Each attribute type has exactly one editor and one display, and they're the same in a table cell, the record page, a create form, a board card, a filter and an import preview. A tag in a table cell is the same Tag in the details panel and on a card. People learn one control once. It also means an attribute type is built in one place and fixed in one place. The Field card's table decides which display and editor each type gets (for example, record references render as RecordChip, links as LinkChip, and selects as Tag). Add a type there before building it anywhere.
4. **No new CSS for an element that already exists.** If a module, molecule or atom of that kind is already in the library, extend it with a variant. A second button style is how a design system dies.
5. **Think before a new component.** Before creating anything:
   1. Search the library and reuse.
   2. If nothing fits, add a variant to the closest component.
   3. Only then create a new one, in `packages/ui`. Write down why in its README (what it's for, and why neither of the first two worked), give it every state and a story for each, and publish it to the artifact with the next `pnpm ui:artifact`.
6. **Every component has every state:** empty, loading, error, read only and disabled, plus hover, focus and selected where they apply. A CRM spends much of its life in these states (no records yet, still loading a million rows, no permission).
7. **Accessible by default.** Everything works by keyboard, focus is visible, and contrast holds in both themes: every text colour, including placeholders, meets 4.5:1, and control outlines meet 3.5:1. If a token is ever flagged as failing, don't "fix" it quietly; raise it, because changing a token changes every screen.
8. **Motion follows the design system's tokens and rules** (derived from `emil-design-eng`):
   - **Curves:** `ease-out` for enter and exit, the ease in out curve for movement, the drawer curve for side panels, and `ease-hover` for hover colour.
   - **Durations:** press 160ms, menus 180ms, sliding indicators 200ms, dialogs 240ms, and exits a faster 120ms. Always use the `duration-*` tokens; `duration-fast`, `duration-base` and `ease-standard` were renamed in version 8 and must not be used.
   - **Behaviour:**
     - Buttons scale to 0.97 while pressed.
     - Menus grow from their trigger, dialogs from the centre, and toasts rise from below.
     - Tab and segment indicators slide.
     - Anything opened from the keyboard, including ⌘K, appears instantly.
     - Hover styles apply only under `@media (hover: hover) and (pointer: fine)`.
     - Reduced motion keeps fades and drops movement.
   - **Exit animations live in `packages/ui`.** The artifact animates menus and dialogs in but not out, because exits need real open and close state. The code version must add them, using the exit duration token.
9. **Icons are Lucide** (https://lucide.dev/icons/), the project's only icon library, drawn through the Icon atom with size and stroke from tokens. In code, `packages/ui/src/atoms/Icon/icons.ts` is the registry: add one import and one line for an icon you need, under its current 1.x lucide.dev name (`building`, `circle-question-mark`, `trash`). People pick object icons from the curated `ObjectIcon` set only. Never draw or import icons from anywhere else. One library keeps the line weight consistent, and one atom means a size or stroke change touches one place.

## CSS that scales

The stack spec picks the styling tool. Whatever it picks has to meet these requirements, because a 56 feature app written by many sessions breaks plain global CSS fast:

- **Tokens are CSS custom properties.** Themes (light, dark, density) swap variables and never selectors. Components read variables and never literal values.
- **Styles are scoped to their component.** No global selectors outside the reset and base layer, no styling another component's insides, and no descendant chains more than one level deep.
- **Cascade layers fix the order:** reset, tokens, base, components, then utilities. Specificity never has to fight, and `!important` is never needed.
- **Variants are declared once per component,** as a small typed set (size, tone, state), not as ad hoc class combinations at the call site.
- **Components adapt with container queries,** so a record panel or table works in any slot. Page layout uses media queries only.
- **Use modern platform CSS where it's supported:** logical properties, nesting, `:has()`, `:focus-visible` and `prefers-reduced-motion`. The `modern-css-html` skill has the current support notes.
- **No runtime styling cost,** and unused styles never ship.

## Think like a design engineer on every screen

Every screen gets a design engineering pass, not just a visual check. The installed collection from Emil Koch (`kemiljk/skills`) covers each step:

1. **Before building,** write a three line brief: what the screen is for, the one main task, and what it deliberately leaves out (`write-first-design`).
2. **While building:**
   - use real semantics first: buttons, forms, dialogs and disclosures (`semantic-html-first`);
   - use modern CSS and HTML (`modern-css-html`);
   - make every action discoverable, with clear hit targets (`interface-affordances`);
   - make motion and layout continuity feel physical, and respect reduced motion (`fluid-design`).
3. **Before calling it done:**
   - remove anything that doesn't serve the task (`subtractive-design`);
   - add care where it helps, not novelty (`product-delight`);
   - harden failure, empty and permission states (`prototype-to-production`).
4. **Then review it.** Run `dxe quick` on the screen, or `dxe review <path>` for a larger surface, and judge any generated draft with `ai-output-judgement` before it ships.


## Before you finish any UI change

- [ ] No raw colour, size, spacing or motion values; tokens only.
- [ ] Only library components on the screen; no one off markup or styles.
- [ ] Attribute values render through their one field design.
- [ ] Any new component or variant is justified in writing, has a story per state, and goes to the artifact with the next publish.
- [ ] Empty, loading, error, read only and disabled states exist.
- [ ] Keyboard, focus and contrast checked in light and dark.
- [ ] Styles are scoped, layered and variable driven, with no `!important` and no global selectors.
- [ ] The screen has its three line brief, and a `dxe quick` pass found nothing open.

For a second opinion, ask the `design-system-guardian` agent to review the change. For broader craft, the `impeccable`, `emil-design-eng`, `building-components` and `web-design-guidelines` skills are installed too. Where they conflict with these rules, these rules win.
