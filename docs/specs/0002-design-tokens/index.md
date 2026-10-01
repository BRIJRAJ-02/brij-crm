# 0002. Design tokens from the design system artifact

**Date**: 2026-10-01
**Status**: Accepted

## Summary

Every colour, size, space, radius, shadow, motion, layer and breakpoint value comes from one place: the design system artifact's token file. A small script turns that file into CSS variables (named values the browser swaps per theme), so light and dark mode change with no screen code touched. This feature also adds the root stylesheet, the theme logic (follow the OS, or a choice saved in the browser), and the Icon atom. It closes the gaps the artifact still has (no layer, breakpoint or opacity tokens, and ten colour pairs that miss the contrast rule), fixing them in the artifact first so it stays the one source of truth.

## Rationale

The reasoning, the options compared and the contrast evidence are in [rationale.md](rationale.md).

## Requirements

**User stories**:
- As someone using the CRM, I want the app to match my OS light or dark setting, or keep the one I picked, so it's comfortable to read all day and never flashes the wrong theme.
- As someone with low vision, I want every text and control to meet contrast in both themes, so nothing is hard to read.
- As an engineer building a screen or component, I want every visual value to be a named token that lint enforces, so the app looks like one product after 56 features.
- As the person who owns the design, I want the artifact to stay the one source of truth, so a token changes in one place and the code follows.

**Acceptance criteria**:
- **AC-1**: `packages/tokens/tokens.json` is the artifact's `project/tokens.json` at the version recorded in `packages/tokens/source.json`. It includes the five new token families, the two focus shadows, `size-tile`, the `label-strong` type style and the contrast fixes (all listed under Feature design), and the artifact shows them too.
- **AC-2**: The generator turns `tokens.json` into `packages/tokens/tokens.css`, with every token as a CSS variable inside `@layer tokens`:
  - light values under `:root` and `[data-theme='light']`;
  - dark values under `[data-theme='dark']`, and again for `:root:not([data-theme])` inside `@media (prefers-color-scheme: dark)`;
  - `color-scheme` set in each theme block;
  - each type style as `--text-<style>` (the `font` shorthand) plus `--tracking-<style>` (its letter spacing);
  - one `@font-face` per font, served from the package.

  Input that breaks the artifact's token grammar stops the generator with a coded error, and nothing is written.
- **AC-3**: `pnpm check` fails when `tokens.css` doesn't match what the generator makes from `tokens.json`.
- **AC-4**: In both themes, every pair in the contrast table (Feature design) meets its minimum: 4.5:1 for text, 3.5:1 for control outlines and 3:1 for accent marks.
- **AC-5**: The app loads one root stylesheet, `@crm/ui/styles.css`, which fixes the cascade layer order `reset, tokens, base, components, utilities`. The status page renders in Inter, with `text` on `surface` and no browser default margins. No screen file holds a raw value, a class name or a style.
- **AC-6**: With no saved choice, the app follows the OS theme, and changing the OS setting switches the open page live, with no reload.
- **AC-7**: A saved Light or Dark choice:
  - is applied before first paint, so the other theme never flashes;
  - survives a reload;
  - reaches every other open tab.

  When storage is blocked, or holds anything other than `light` or `dark`, the app follows the OS and nothing throws.
- **AC-8**: Switching themes changes no screen or component file. Only the `data-theme` attribute on `<html>`, or the OS setting, changes.
- **AC-9**: The Icon atom:
  - draws a Lucide 1.49 icon by its lucide.dev name, from one registry;
  - is sized `md`, `sm` or `xs` from the icon size tokens, and stroked at `icon-stroke`;
  - takes a tone (`inherit`, `muted` or `ai`), and can sit on a hue tile;
  - is hidden from screen readers unless `label` is given, and then reads as an image with that name.

  A name that isn't in the registry is a type error. Only the registry file may import `lucide-react` (lint).
- **AC-10**: Stylelint refuses:
  - raw `opacity`, `scale` and `z-index` values;
  - any length in an `@media` or `@container` condition that isn't a breakpoint token value;
  - any `var(--name)` that no token and nothing in the same file defines, including the renamed `duration-fast`, `duration-base` and `ease-standard`.
- **AC-11**: The production build runs under the existing Content Security Policy, unchanged, with no console errors and no CSP violations. Fonts and the theme boot script both come from the app's own origin: the built CSS references each font only as an `/assets/*.woff2` file, never as a `data:` URI.
- **AC-12**: The styling approach scales:
  - every rule sits in one of the fixed cascade layers;
  - component styles live in that component's CSS module;
  - a component declares its variants once, in its own module, as `data-*` attribute selectors (the Icon proves it);
  - container queries are allowed with breakpoint token values only;
  - nothing uses `!important`, and nothing styles at runtime.

  The existing lint rules (no `!important`, no global or reaching selectors, no `className` or `style` in screens) stay green, and AC-10 adds the rest.

## Decision

**Chosen option**: Option 1, generated CSS variables from a committed copy of the artifact's `tokens.json`, using our own small generator.

The artifact decides every value. `packages/tokens` holds a copy of its token file and fonts, and a script turns them into one committed `tokens.css`. `packages/ui` layers that under a reset and base, and adds the theme logic and the Icon atom. Lint rules make sure nothing else invents a value.

**Implementation skills**:
- `crm-design-system` (`.claude/skills/crm-design-system/`): the house rules, which always apply
- `modern-css-html` (`kemiljk/skills`, `.claude/skills/modern-css-html/`): cascade layers, `color-scheme`, container queries
- `building-components` (`vercel/components.build`, `.claude/skills/building-components/`): the Icon atom's API and accessibility
- `semantic-html-first` (`kemiljk/skills`, `.claude/skills/semantic-html-first/`): decorative versus labelled icons
- `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`): parsing the artifact's token grammar
- `vitest` (`antfu/skills`, `.claude/skills/vitest/`): generator, contrast, theme and lint tests
- `pnpm` (`antfu/skills`, `.claude/skills/pnpm/`) and `turborepo` (`vercel/turborepo`, `.claude/skills/turborepo/`): the two new workspaces, their tags and the check task

## Feature design

**Data model sketch**: nothing is stored in Postgres. The only state is the token file (a committed copy of the artifact's), and one browser setting: `localStorage['crm.theme']`, which is `light`, `dark` or absent (System). It moves to the user's profile with #23.

### Where things live

| Path | Owns |
|---|---|
| `packages/tokens/tokens.json` | The artifact's token file, copied as is. Never edited by hand |
| `packages/tokens/source.json` | `{ "artifact": "https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh", "version": "<published version id>", "synced": "<date>" }` |
| `packages/tokens/fonts/` | `Inter-Variable-latin.woff2` and `JetBrainsMono-Variable-latin.woff2` from the artifact's `project/fonts/`, plus `LICENSE.md` (both fonts are under the SIL Open Font License 1.1, with its full text) |
| `packages/tokens/scripts/generate.ts` | `generateTokensCss()` and the CLI (`pnpm tokens:build`, and `pnpm tokens:check` with `--check`) |
| `packages/tokens/src/grammar.ts` | The Zod schema of the artifact's token grammar (lists, never a name to value map) |
| `packages/tokens/tokens.css` | Generated and committed. Never edited by hand |
| `packages/ui/src/styles/index.css` | The layer order statement, then `@import` of the tokens, reset and base |
| `packages/ui/src/styles/reset.css`, `base.css` | `@layer reset { … }` and `@layer base { … }` |
| `packages/ui/src/theme/theme.ts` | Theme choice parsing, the controller, and safe storage access |
| `packages/ui/src/atoms/Icon/` | `Icon.tsx`, `Icon.module.css`, `icons.ts` (the registry, and the only `lucide-react` import), `README.md` |
| `apps/web/public/theme-boot.js` | The classic script `index.html` loads first in `<head>` |
| `packages/config/stylelint/breakpoint-tokens.js` | The `crm/breakpoint-tokens` Stylelint rule |

### Package wiring

- **`packages/tokens/package.json`** (`@crm/tokens`):
  - exports `./tokens.css` and `./tokens.json`;
  - scripts `build:tokens` (`node scripts/generate.ts`), `check:tokens` (`node scripts/generate.ts --check`), `test` (`vitest run`), `typecheck` and `lint`.
- **`packages/tokens/turbo.json`:** `{ "extends": ["//"], "tags": ["shared"] }`, the same as `packages/config`. Email templates will read it later, which is why it's `shared`.
- **`packages/ui/package.json`** (`@crm/ui`):
  - exports `.` (`./src/index.ts`), `./styles.css` (`./src/styles/index.css`) and `./theme` (`./src/theme/theme.ts`, so tests and the boot script test import the theme logic without pulling in React);
  - depends on `@crm/tokens` (`workspace:*`) and on `react` and `lucide-react` from the catalog.
- **`packages/ui/turbo.json`:** `{ "extends": ["//"], "tags": ["client"] }`. Its `eslint.config.js` uses the `client` preset, plus the one `icons.ts` exception.
- **`apps/web/package.json`:** gains `@crm/ui` (`workspace:*`).
- **Root `package.json`:**
  - `tokens:build` runs `pnpm --filter @crm/tokens build:tokens`;
  - `tokens:check` runs `pnpm --filter @crm/tokens check:tokens`;
  - `check` appends `&& pnpm tokens:check`.

  No Turbo task is needed, since the check is a fast, cache free comparison.
- **Boundaries:** both workspaces join `pnpm boundaries`. `shared` has no deny rule today, and needs none, since `packages/tokens` depends on nothing.

### What the artifact gains (step 4 of the build plan)

These values are proposed. You review them before they're published to the artifact.

| Family (`tokens.json` key) | Tokens |
|---|---|
| `zIndex` | `z-raised` 1 (above siblings inside a component), `z-sticky` 2 (sticky table header and columns), `z-popover` 100 (menus, selects, date pickers, the format toolbar), `z-drawer` 200 (side panels), `z-modal` 300 (scrim, dialogs, the command palette), `z-toast` 400, `z-tooltip` 500 |
| `opacity` | `opacity-disabled` 0.5, `opacity-busy` 0.7 (a loading button), `opacity-pulse` 0.45 (the skeleton's low point) |
| `scale` | `scale-press` 0.97 (pressables), `scale-press-sm` 0.92 (checkbox and radio), `scale-enter` 0.97 (popovers and dialogs start here), `scale-shrunk` 0.5 (the radio dot when off) |
| `borderWidth` | `border-width-hairline` 1px, `border-width-thick` 2px (the active tab line, a remote cursor) |
| `breakpoint` | `bp-page-compact` 1024px (below this the shell uses its compact layout, and nothing narrower is tailored), `bp-container-sm` 320px, `bp-container-md` 480px |
| `shadow` (added) | `shadow-focus`: `0 0 0 3px #266df04d` light, `0 0 0 3px #709ff599` dark (the halo, in the `focus-ring` colour). `shadow-focus-inset`: `inset 0 0 0 2px #266df0` in both (the ring on rows, tabs and menu items) |
| `size` (added) | `size-tile` 20px (the icon tile) |
| `type`, Text group (added) | `label-strong`: 11px/16px, weight 500 (sidebar section labels) |

Contrast fixes. Only OKLCH lightness moves, so hue and chroma stay the same. The usage notes that quote ratios get updated too. Before showing you the values, the builder runs the contrast test against them as a fixture. If any of the 96 checks misses, it may move only that token's OKLCH lightness, by the smallest step that clears every pair, and it says so.

| Token | Theme | Now | Proposed |
|---|---|---|---|
| `text-tertiary` | light | `#6c7077` | `#676b72` |
| `text-tertiary` | dark | `#888c94` | `#999da5` |
| `danger` | light | `#cf3432` | `#c92e2d` |
| `control-border` | light | `#838892` | `#7b808a` |
| `accent-hover` | dark | `#538bf3` | `#1d63e5` (darker than `accent`, so white labels hold 5.2:1 on hover) |

### Generated CSS shape

```css
/* Generated from tokens.json (artifact version <source.json version>) by scripts/generate.ts. Do not edit. */
@layer tokens {
  :root,
  [data-theme='light'] {
    color-scheme: light;
    --surface: #fdfdff; /* every colour and shadow token, light value */
  }
  [data-theme='dark'] {
    color-scheme: dark;
    --surface: #18191c; /* every colour and shadow token, dark value */
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) {
      color-scheme: dark;
      --surface: #18191c; /* the same dark block again */
    }
  }
  :root {
    --space-8: 8px; /* every other family, the type families and styles */
    --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --text-body: 400 13px/20px var(--font-sans);
    --tracking-body: 0;
  }
}
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter-Variable-latin.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

**Families:**
- Any top level key shaped `{ "tokens": [...] }` is emitted as plain `:root` variables, so a family the artifact adds later flows through with no code change.
- `color`, `shadow` and `type` have their own shapes. `version`, `name` and `meta` are skipped.
- Any other key is refused with `TOKENS_UNKNOWN_FAMILY`.
- The artifact's global type classes (`.heading`, `.body`, and the rest) are not emitted. Components set `font: var(--text-body)` and `letter-spacing: var(--tracking-body)`.

**Values:**
- A colour written as an alias (`"{other-token}"`, which the artifact's grammar allows, per theme too) becomes `var(--other-token)`.
- Any other value is copied exactly as the artifact gives it, quotes included (the families use double quotes), with no rewriting of numbers or colours.

**Type styles:**
- `--text-<style>` is `<fontStyle when italic> <fontWeight> <fontSize>/<lineHeight> var(--font-<family>)`.
- A style with a non null `opticalSize` is refused with `TOKENS_INVALID` until something needs it.

**One namespace:** every emitted name (colours, shadows, every plain family, `--font-*`, `--text-*`, `--tracking-*`) shares one namespace. Two of them meeting, for example a type style named `secondary` against the colour `text-secondary`, is refused with `TOKENS_DUPLICATE`.

**Fonts:** a font file that `type.fonts[]` names but `packages/tokens/fonts/` lacks is refused with `TOKENS_INVALID`.

**Output format:**
- Tokens come out in the order `tokens.json` lists them, never sorted.
- Two space indent, one declaration per line, a blank line between top level blocks, and one trailing newline.
- The generator is the only formatter (Prettier ignores the file), which is what makes byte equality in `tokens:check` reliable.

**Header:** the version comes from `source.json`. `generate.ts` reads both files, and `tokens:check` therefore also fails when `source.json` changed without a regenerate.

### The root stylesheet

`packages/ui/src/styles/index.css` opens with `@layer reset, tokens, base, components, utilities;`, then imports `@crm/tokens/tokens.css`, `./reset.css` and `./base.css`. `apps/web/src/main.tsx` imports `@crm/ui/styles.css` once. The status screen's markup doesn't change; only its brief comment does.

A test on the built CSS in `apps/web/dist/assets` checks that:
- the layer order statement comes before any layered rule (so Vite's `@import` inlining kept it first);
- the font URLs are `/assets/*.woff2`, not `data:` URIs.

If Vite ever hoists the statement, the fallback is `@import '@crm/tokens/tokens.css' layer(tokens);` with the layer order statement kept first.

- **Reset:**
  - `box-sizing: border-box` everywhere;
  - zero margins on `body`, headings, `p`, `dl`, `dd`, `figure`, `blockquote` and lists;
  - `font: inherit` on headings and form controls, and `color: inherit` on form controls;
  - `display: block` and `max-inline-size: 100%` on `img`, `video` and `canvas`.

  It never removes focus outlines.
- **Base**, from the artifact's base layer:
  - `html` and `body` get `background: var(--surface)`;
  - `body` gets `font: var(--text-body)`, `color: var(--text)`, `-webkit-font-smoothing: antialiased` and `font-feature-settings: 'cv11', 'ss01'`;
  - `code`, `samp` and `pre` get `font-family: var(--font-mono)` (`kbd` stays sans, so ⌘ and ↵ come from the system face).

### Theme choice

**State transitions**: the choice is one of `system` (the default: nothing saved, no `data-theme`), `light` or `dark`. Any choice can move to any other. Only `set()` (the ThemeSwitch in #4), or a change from another tab, moves it.

- **Storage:** `localStorage` key `crm.theme`, holding `light` or `dark`. System means the key is absent.
- **Boot script:** `apps/web/public/theme-boot.js` is a plain classic script, loaded with `<script src="/theme-boot.js"></script>` as the first child of `<head>` (not `async`, not a module, so it runs before first paint). In a `try`, it reads the key, and only for `light` or `dark` sets `document.documentElement.dataset.theme`. On any error it does nothing.
- **Runtime:** in `@crm/ui/theme`, `createThemeController({ storage, root, onStorage })` returns `{ get, set, subscribe, dispose }`.
  - `set('light' | 'dark')` writes the key and sets the attribute.
  - `set('system')` removes both.
  - Writes that throw are swallowed, and the attribute still changes for this page.
  - A `storage` event for the key, from another tab, is parsed, applied and passed on to subscribers.
- **System mode** is pure CSS: no `matchMedia` and no listener.
- **Wiring (in #3):**
  - `apps/web/src/main.tsx` creates one controller:

    ```ts
    createThemeController({
      storage: safeLocalStorage(window),
      root: document.documentElement,
      onStorage: (handler) => {
        const listener = (event: StorageEvent) => handler(event.key, event.newValue);
        window.addEventListener('storage', listener);
        return () => window.removeEventListener('storage', listener);
      },
    })
    ```

    It puts the controller in router context as `theme`, next to `data`.
  - So in #3 a choice saved in one tab reaches the others. #4's ThemeSwitch reads `context.theme`, with no new wiring.

### Icon atom

```tsx
<Icon name="building" />                     // 16px, inherits colour, hidden from screen readers
<Icon name="sparkles" size="sm" tone="ai" />
<Icon name="users" tile="green" />           // the People object tile
<Icon name="circle-question-mark" label="Help" />
```

| Prop | Type | Maps to |
|---|---|---|
| `name` (required) | `IconName`, the keys of `icons.ts` | the Lucide component |
| `size` | `'md' \| 'sm' \| 'xs'`, default `md` | `--size-icon` 16, `--size-icon-sm` 14, `--size-icon-xs` 12 |
| `tone` | `'inherit' \| 'muted' \| 'ai'`, default `inherit` | `currentColor`, `--text-secondary`, `--ai` |
| `label` | `string` | given: `role="img"` and `aria-label` (never a `<title>`). Absent: `aria-hidden="true"` |
| `tile` | `Hue` (`gray`, `red`, `orange`, `yellow`, `lime`, `green`, `sky`, `blue`, `purple`) | a `--size-tile` square with `radius-xs`, `tag-<hue>-bg` fill, `tag-<hue>-text` icon colour, and a `border-width-hairline` solid border in `tag-<hue>-border`, holding an `sm` icon |

- **Tile rules:**
  - The props are a union: with `tile`, `size` and `tone` are type errors, since a tile always holds an `sm` icon in the hue's text colour.
  - The edge is a real border, not a box shadow. It passes the strict value rule and survives Windows forced colours mode. The reset's `border-box` keeps the tile 20px.
  - With a tile, `role="img"` and `aria-label` go on the wrapping `span`, and the `svg` is always `aria-hidden`.
- **The `svg`:** always gets `focusable="false"`, and is stroked with `stroke-width: var(--icon-stroke)`, set in CSS so it overrides Lucide's attribute.
- **Variants:** size, tone and hue are `data-*` attributes, styled once in `Icon.module.css`.
- **`Hue`:** a hand written union in `packages/ui/src/hue.ts`. A test checks that it lists exactly the hues `tokens.json` has `tag-<hue>-bg` tokens for.
- **Why it differs from the artifact's API:**
  - The artifact takes a pixel `size` and a `tileSize`. Code takes token names, because raw numbers aren't allowed.
  - `tone` replaces the artifact's `ws-icon-muted` and `ws-icon-ai` classes, because no caller passes a class.
  - Nothing else passes through to the `svg`.

  `README.md` records this.
- **The registry starts with:**
  - the icon for each attribute type from the artifact's Icon card: `globe`, `tag`, `calendar`, `circle-dollar-sign`, `users`, `building`, `user`, `star`, `map-pin`, `phone`, `at-sign`, `hash`;
  - `sparkles` for AI;
  - `circle-question-mark`.

  Adding an icon is one import and one line.

### API surface

| Export | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `@crm/tokens/tokens.css` | CSS | none | every token in `@layer tokens`, plus `@font-face` | none | none |
| `@crm/tokens/tokens.json` | JSON | none | the artifact copy, read by the lint rules and the contrast test | none | none |
| `generateTokensCss(input: unknown)` | function | the parsed `tokens.json` | `{ ok: true, css }` or `{ ok: false, error: { code, message } }` | none | `TOKENS_INVALID`, `TOKENS_UNKNOWN_FAMILY`, `TOKENS_DUPLICATE` |
| `pnpm tokens:build` | CLI | `tokens.json` | writes `tokens.css` (exit 0) | none | prints the error, writes nothing, exits 1 |
| `pnpm tokens:check` | CLI, part of `pnpm check` | `tokens.json`, `tokens.css` | exit 0 when they match | none | `TOKENS_STALE`: names the fix (`pnpm tokens:build`), exits 1 |
| `@crm/ui/styles.css` | CSS | none | layer order, tokens, reset, base | none | none |
| `Icon` from `@crm/ui` | component | `name`, `size?`, `tone?`, `label?`, `tile?` | an `svg` (in a tile `span` when `tile` is set) | none | an unknown `name` is a type error |
| `createThemeController` from `@crm/ui/theme` | factory | `storage` (or `undefined`), `root`, `onStorage` | `{ get, set, subscribe, dispose }` | none | never throws |
| `parseThemeChoice(value: unknown)` | function | anything | `'light'`, `'dark'` or `'system'` | none | none, since anything else is `'system'` |
| `safeLocalStorage(win)` | function | `window` | its `localStorage`, or `undefined` when reading it throws | none | none |
| `THEME_STORAGE_KEY` | constant | none | `'crm.theme'` | none | none |
| `theme-boot.js` | classic script | `localStorage['crm.theme']` | `data-theme` on `<html>` | none | swallows every error |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Generate | every CSS variable's name and value | `packages/tokens/tokens.json` (the artifact's file at `source.json`'s version) |
| Generate | an alias colour's value | `var(--<target>)`, from the `"{target}"` string |
| Generate | the dark values under System | the same token's `dark` value, written again inside the `prefers-color-scheme` block |
| Generate | `color-scheme` per block | the theme id (`light`, `dark`) |
| Generate | `--text-<style>` | that style's `fontWeight`, `fontSize`/`lineHeight` and family (the style's own, else its group's) as `var(--font-<family>)` |
| Generate | `--tracking-<style>` | that style's `letterSpacing` |
| Generate | `@font-face` rules | `type.fonts[]`, files resolved to `packages/tokens/fonts/` |
| Generate | the header's version | `source.json` `version`, read by `generate.ts` |
| Sync | `tokens.json`, the fonts | the artifact read through the Artifact tool (`project/tokens.json`, `project/fonts/*`) |
| Sync | `source.json` `version` | the version id that Artifact read reports for the files it saved, for example `1790844598-fab8` (not `tokens.json`'s own `version` field, which is the grammar version) |
| Sync | `source.json` `synced` | the date of the sync |
| New families and fixes | their values | the two tables above, published to the artifact first and then synced back |
| Boot | the theme before first paint | `localStorage['crm.theme']` when it's `light` or `dark`, else no attribute (the OS decides through CSS) |
| Runtime | the theme after a change | `set()` from the ThemeSwitch (#4), or a `storage` event from another tab, through the controller `main.tsx` creates |
| Render | the page colours under System | `prefers-color-scheme`, read by the browser |
| Icon | the glyph | `lucide-react` 1.49.0, through `icons.ts` |
| Icon | the size, stroke and tone colour | `size` prop → `--size-icon*`; `--icon-stroke`; `tone` → `currentColor`, `--text-secondary` or `--ai` |
| Icon | the tile colours and size | `tile` → `--tag-<hue>-bg`, `-text`, `-border`; `--size-tile`; `--radius-xs` |
| Lint | the breakpoint values allowed | the `breakpoint` family in `tokens.json`: `bp-page-*` for `@media`, `bp-container-*` for `@container` |
| Lint | the names `var()` may use | `packages/tokens/tokens.css`, plus custom properties the same file declares |
| Lint | where those two files are | resolved from the config file's own folder (`import.meta.dirname`), never the working folder |
| Contrast test | each pair's colours | `tokens.json`, both themes, parsed by the same grammar as the generator, with aliases resolved to their target |
| Icon | the `Hue` list | `packages/ui/src/hue.ts`, checked against the `tag-<hue>-bg` tokens |

### Contrast pairs (AC-4)

| Foreground | Backgrounds | Minimum |
|---|---|---|
| `text`, `text-secondary`, `text-tertiary` | `surface`, `surface-sidebar`, `surface-raised`, `surface-subtle`, `surface-hover`, `surface-selected`, `surface-column` | 4.5 |
| `link` | `surface`, `surface-raised`, `accent-soft` | 4.5 |
| `on-accent` | `accent`, `accent-hover` | 4.5 |
| `on-inverse` | `surface-inverse` | 4.5 |
| `danger` | `surface`, `surface-subtle`, `surface-raised`, `surface-hover`, `surface-selected` | 4.5 |
| `tag-<hue>-text` | `tag-<hue>-bg`, for all nine hues | 4.5 |
| `control-border` | `surface`, `surface-sidebar`, `surface-raised`, `surface-subtle`, `surface-hover` | 3.5 |
| `accent` | `surface`, `surface-raised` | 3 |

Ratios use the WCAG 2 relative luminance formula. The test reads colours through the generator's grammar and resolves an alias (`"{token}"`) to its target first. If either colour in a pair is a colour function (`oklch()`, `rgb()` and the rest) or carries alpha, the test fails and names the pair, rather than guessing what it sits on. Every pair is opaque hex today.

### Lint changes (`packages/config`)

- **Stylelint `scale-unlimited/declaration-strict-value`:** add `opacity` and `scale` (`z-index` is already there).
  - Through per property ignore values, `opacity` also accepts `0` and `1`, and `scale` accepts `none` and `1`. `line-height: 1` stays refused.
  - `scale: 1 1` and other multi value forms are refused, so use a token.
- **Stylelint unknown custom properties:** from `stylelint-value-no-unknown-custom-properties` 6.1.1.
  - `importFrom` is the absolute path to `packages/tokens/tokens.css`, resolved from `packages/config`, so `stylelint` gives the same answer from any folder.
  - Use the rule name the plugin actually registers; the builder confirms it from the package rather than assuming `csstools/value-no-unknown-custom-properties`.
- **Stylelint `crm/breakpoint-tokens`:** a local plugin made with `stylelint.createPlugin`, in `packages/config/stylelint/breakpoint-tokens.js`, imported and listed in `plugins` next to the strict value plugin. It reads `packages/tokens/tokens.json` from a path resolved off its own folder.
  - In an `@media` condition, every length must exactly equal a `bp-page-*` value. In `@container`, a `bp-container-*` value.
  - Both range syntax (`(width < 1024px)`, `(width >= 1024px)`) and `min-width`/`max-width` are accepted.
  - Any other length is refused: `1023.98px`, `calc()`, and any `em` or `rem` value. Write the range form instead of an off by one value.
  - Conditions with no length (`(hover: hover) and (pointer: fine)`, `(prefers-reduced-motion: reduce)`) are ignored.
  - `unit-disallowed-list` gets `ignoreMediaFeatureNames: { px: ['width', 'min-width', 'max-width'] }`, so `px` passes it in media size conditions and this rule decides. If `unit-disallowed-list` turns out not to check `@container` at all, this rule is the only gate there. Tests cover both query kinds and both syntaxes either way.
- **ESLint `@typescript-eslint/no-restricted-imports`:** add `lucide-react` and `lucide-react/*` to the vendor SDKs, and switch the rule off only for `packages/ui/src/atoms/Icon/icons.ts`.
- **Lint for `apps/web/public/*.js`:** linted as plain browser scripts with no type information, or ignored.
- **Prettier:** `.prettierignore` gets `packages/tokens/tokens.json` and `packages/tokens/tokens.css`, so a sync copies the file byte for byte and the staleness check owns the generated one.

**Key invariants**:
- A token value is decided only in the artifact. `packages/tokens` changes only by a sync, followed by `pnpm tokens:build`.
- `tokens.css` is always exactly what the generator makes from `tokens.json` (AC-3).
- Every colour and shadow token has both a light and a dark value. The generator refuses one without (`TOKENS_INVALID`), so a theme switch can never fall back silently.
- `shadow-focus` uses the `focus-ring` colour in each theme (tested), so changing the colour without the shadow fails.
- `data-theme` is absent, or exactly `light` or `dark`. Storage holds only `light` or `dark`, and is parsed against that list before it reaches the DOM.
- Only `icons.ts` imports `lucide-react`.
- A custom property that a component reads but only sets through an inline style gets a default declared in its CSS module, so the unknown property rule knows it.

**Security model**: nothing here is user data or tenant data. The theme choice isn't sensitive, and it lives only in that browser. No new origin is added: fonts and the boot script are same origin, so `script-src 'self'` and `font-src 'self'` stay as they are, and there's no inline script to allow. The boot script only ever writes `light` or `dark` into the DOM.

**Configuration required**: none. No new environment variables or credentials.

**New dependencies** (pinned in the `catalog:`): `lucide-react` 1.49.0 (matches the artifact's Lucide 1.49), `stylelint-value-no-unknown-custom-properties` 6.1.1. `zod`, `react` and `vitest` are already there.

**Critical test scenarios**:
- Happy path, generator:
  - a fixture `tokens.json` produces the light, dark and System blocks, `color-scheme`, type shorthands with tracking, and `@font-face` → **AC-2**;
  - the committed `tokens.css` equals a fresh run → **AC-3**.
- Happy path, browser: the production build, with the OS set to light then dark, switches the status page live, with Inter loaded from the same origin and 0 console errors → **AC-5**, **AC-6**, **AC-8**, **AC-11**.
- Saved choice: with `crm.theme=dark` and the OS set to light, a reload paints dark from the first frame. A second tab follows a change made in the first → **AC-7**.
- Failure cases:
  - each of these stops the generator with its code and leaves `tokens.css` untouched → **AC-2**:
    - a colour missing its dark value;
    - an unknown top level key;
    - a duplicate name, including a `--text-*` against a colour;
    - a missing font file;
    - a non null `opticalSize`;
  - an alias colour comes out as `var(--target)`, and a second run produces byte identical output → **AC-2**;
  - a hand edit to `tokens.css` makes `pnpm check` fail → **AC-3**;
  - blocked storage, or `crm.theme=purple`, follows the OS without throwing, in the boot script (run in `node:vm`) and in the controller → **AC-7**.
- Contrast → **AC-4**:
  - every listed pair passes in both themes on the synced file;
  - it fails on the current artifact values (a fixture), which proves the test catches the ten known misses;
  - a pair holding an alpha or function colour fails with its name.
- Icon → **AC-9**, **AC-12**:
  - it renders `aria-hidden` and `focusable="false"` by default, and `role="img"` with the label when given (on the tile `span` when tiled);
  - size, tone and tile reach their data attributes;
  - every registry key is a real Lucide 1.49 name (its PascalCase form equals the component's `displayName`);
  - `Hue` matches the tag hues in `tokens.json`;
  - `name="nope"`, and `tile` together with `size`, each fail typecheck (`@ts-expect-error`).
- Built CSS: in `apps/web/dist`, the layer order statement comes first, and fonts are `/assets/*.woff2`, never `data:` → **AC-5**, **AC-11**.
- Lint:
  - each of these is refused: `opacity: 0.5`, `scale: 0.97`, `z-index: 10`, `@container (width < 400px)`, `@media (max-width: 1023.98px)`, `@media (min-width: 64rem)` and `var(--duration-fast)`;
  - each of these passes: `opacity: var(--opacity-disabled)`, `@container (width < 480px)`, `@media (width < 1024px)`, `@media (min-width: 1024px)` and a module's own `--tile-bg`;
  - the same results come back when `stylelint` runs from inside a workspace folder;
  - `lucide-react` imported outside `icons.ts` fails ESLint → **AC-9**, **AC-10**.
- The boot script and the controller use the same key: the `apps/web` test runs `theme-boot.js` and imports `THEME_STORAGE_KEY` from `@crm/ui/theme` → **AC-7**.
- The controller: a `storage` event carrying `dark` sets the attribute and notifies subscribers, and `dispose()` removes the listener → **AC-7**.

## Build plan

Tracer Bullet: the first two steps push one thin thread through every layer (artifact file → generator → CSS variables → root stylesheet → app → status page in both themes). The rest thickens it one strand at a time.

1. Create `packages/tokens` (tagged `shared`):
   - copy the artifact's current `project/tokens.json` and both font files, and write `source.json`;
   - write `generateTokensCss()` for the colour and shadow theme blocks (light, dark, the System media block, `color-scheme`) and the plain families;
   - add `tokens:build` and commit `tokens.css`.

   Satisfies **AC-1** (the first sync), **AC-2**.
2. Create `packages/ui` (tagged `client`) with `src/styles/index.css`, `reset.css` and `base.css`, exported as `@crm/ui/styles.css`.
   - Add the package wiring listed above, and add `@crm/ui` to `apps/web`.
   - Import the stylesheet in `apps/web/src/main.tsx`, and update the status screen's brief so it no longer says it carries no styles.
   - Add the built CSS test (the layer order comes first).

   The status page now draws from tokens and follows the OS. Satisfies **AC-5**, **AC-6**, **AC-8**, **AC-12**.
3. Thicken the generator:
   - type families and styles (`--font-*`, `--text-*`, `--tracking-*`), aliases and `@font-face`;
   - the Zod grammar with its coded errors, the light and dark completeness rule, the one namespace rule and the output format;
   - `tokens:check` reading `source.json` too, added to `pnpm check`, and the `.prettierignore` lines;
   - its tests.

   Satisfies **AC-2**, **AC-3**.
4. Contrast and the artifact update, one milestone, so no commit ever carries a red test:
   - write the contrast test over the pair table, with the fixture proving it fails on today's values;
   - run it against the proposed values;
   - prepare the artifact edit: the `zIndex`, `opacity`, `scale`, `borderWidth` and `breakpoint` families, `shadow-focus`, `shadow-focus-inset`, `size-tile` and `label-strong`, plus the five contrast fixes and their usage notes. Follow the artifact type's own editing instructions;
   - show the engineer the changed values, and publish only on their OK;
   - sync back `tokens.json` and `source.json`, run `tokens:build`, and commit the test, the synced files and the regenerated CSS together, with the suite green.

   Until the engineer approves, this milestone stays uncommitted, and steps 5 to 7 can go ahead in parallel. Satisfies **AC-1**, **AC-4**.
5. Add theme choice:
   - `@crm/ui/theme` (`parseThemeChoice`, `createThemeController`, `safeLocalStorage`, `THEME_STORAGE_KEY`);
   - the controller created in `apps/web/src/main.tsx` and put in router context as `theme`;
   - `apps/web/public/theme-boot.js`, loaded first in `index.html`'s `<head>`;
   - controller tests with fake storage, root and storage events, and the `apps/web` boot script test in `node:vm`.

   Satisfies **AC-7**, **AC-11**.
6. Add the Icon atom:
   - `hue.ts`, `icons.ts` with the starting registry, `Icon.tsx`, `Icon.module.css` and `README.md` (what it's for, and why its API differs from the artifact's);
   - `lucide-react` in the catalog, and the ESLint vendor restriction with its one exception;
   - render tests with `react-dom/server`, the registry name test, the `Hue` test and the type tests.

   Satisfies **AC-9**, **AC-12**.
7. Add the lint guards in `packages/config`: `opacity` and `scale` as strict values, the `crm/breakpoint-tokens` plugin, and the unknown custom property plugin (with paths resolved from the config's folder). Lock each in with a config test. Satisfies **AC-10**, **AC-12**.
8. Build for production and check it in a browser with the Playwright MCP:
   - System in light and dark, then a saved choice across a reload and a second tab (set in one tab's storage, followed live in the other);
   - `document.fonts.check('13px Inter')` is true;
   - fonts come from `/assets/`;
   - the console shows 0 errors and 0 CSP violations.

   Satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-11**.

## Consequences

**Positive**:
- A theme, a rebrand or a contrast fix happens in one file, in the artifact, and reaches every screen through one regenerate.
- No runtime styling cost: plain CSS variables in a fixed layer, with no theme code on the render path.
- Lint, not review, catches a raw value, a typo'd or renamed token, an off scale breakpoint and a stray icon import.
- Contrast is guarded by a test, so a later artifact change can't quietly break it.

**Negative / tradeoffs**:
- Every new token needs an artifact edit and a sync before code can use it, which is slower than typing a value, on purpose.
- Breakpoint numbers appear as literals in queries. Lint guarantees they're token values, but a reader sees `480px`, not a name.
- The dark values appear twice in `tokens.css` (the attribute block and the System block). It's generated, so it costs nothing to keep, but the file is longer.
- The boot script repeats the storage key outside TypeScript. A test keeps them equal.
- A committed generated file can conflict in a merge. The fix is always to run `pnpm tokens:build`.
- The contrast fixes shift five colours slightly on every future screen. None are built yet, so now is the cheapest time.

**Neutral**:
- #4 ports components token only. `bundle.css` still has about 50 raw lengths (font sizes, 22px, 24px, 40px heights, menu and modal widths). Each needs a token added to the artifact as its component is ported.
- The `font` shorthand resets `font-variant-numeric`, so `tabular-nums` must come after `font` in a rule.
- `packages/tokens` and `packages/ui` are new areas, so `/sync` writes their nested `AGENTS.md` files.

## Follow-up

- [ ] Component library (#4): put the ThemeSwitch in the sidebar footer, reading the controller from router context (`context.theme`). Add component sizes to the artifact as each component is ported. Check focus rings in Windows forced colours mode, where box shadows disappear and the 1px accent border has to carry focus.
- [ ] Workspaces, members and teams (#23): move the theme choice onto the user's profile through `@crm/data`, keeping `crm.theme` as the first paint cache.
- [ ] Sign in emails (#23): React Email templates can't read CSS variables. When they arrive, generate a light theme value map in TypeScript from `tokens.json`.
- [ ] The first feature that lets people pick an icon, stored as a name, loads it through Lucide's dynamic loader inside the Icon atom only. Replaced by [spec 0003](../0003-component-library/0003-attribute-values.md): object icons come from a curated `ObjectIcon` set in the registry, and the dynamic loader isn't used.
- [ ] Monitoring (#11): measure the font swap on a first visit, and preload Inter if it shows.
- [ ] The font files cover Latin only. Names in other scripts (Cyrillic, Greek, Vietnamese, CJK) fall back to the system font. Before the first customers outside Latin script markets, add the artifact's fuller Inter subsets with `unicode-range`.
