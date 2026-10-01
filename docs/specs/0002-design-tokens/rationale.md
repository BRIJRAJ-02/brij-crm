# 0002. Design tokens: rationale

## Context

The house rules say every visual value is a named token from the first screen, and that the design system artifact (CRM Workspace, version 8) is the source of truth. If the artifact and the code disagree, the artifact wins. Spec 0001 already chose CSS Modules, CSS variables and cascade layers, with `packages/tokens` generated from the artifact's `tokens.json` by a script. What that spec left open is how the file becomes CSS, how themes switch, and what to do where the artifact itself falls short.

Reading the live artifact turned up five gaps:
1. Its compiled `tokens.css` has light under `:root` and dark under `[data-theme="dark"]`, but no `prefers-color-scheme` rule. So "System" (remove the attribute and let the OS decide) can't actually follow the OS from CSS alone.
2. It has no tokens for stacking layers, breakpoints, border widths, opacity or the press scale, though its own components use all of them as raw values (`z-index: 10`, `opacity: .5`, `scale(0.97)`, `1px` borders, `@container (max-width: 480px)`).
3. Its type styles exist as global classes with raw pixel values. Its `--text-*` font shorthands can't carry letter spacing.
4. Ten colour pairs its components actually draw fall below the house contrast rule (evidence below).
5. Spec 0001 mentions density, but the artifact has one density only.

Further constraints:
- The web app's Content Security Policy allows only `'self'` for scripts, styles and fonts, so no inline script and no font host.
- The app targets laptop widths and up (1024px), since phone apps come later over the public API.
- The repo runs TypeScript on Node with no build step, and every check must run in `pnpm check` and CI.
- The artifact is private, so CI can't fetch it. Syncing is an agent step through the Artifact tool, as spec 0001 says.

Leaving this undecided means the first component port (#4) would either invent values or copy raw ones. After 56 features that's how the app ends up looking like fifty apps.

## Options considered

### Option 1: Our own generator over a committed copy of `tokens.json`

Copy the artifact's `tokens.json` and fonts into `packages/tokens`. A small TypeScript script (run by Node directly, with Zod parsing the artifact's grammar) writes one committed `tokens.css`: theme blocks, a System media block, the other families, the type shorthands, and `@font-face`.

**Pros**:
- Reads the artifact's own list grammar exactly, with no adapter, and refuses anything it doesn't understand.
- About a hundred lines, no new dependency, and the output is a readable diff in review.
- Generates what the artifact's compiler lacks (the System block, `color-scheme`, letter spacing) without changing the artifact's format.

**Cons**:
- We own the script and its tests. A grammar change in the artifact type means a code change here.

### Option 2: Style Dictionary

The common token build tool, with transforms and formats for many platforms.

**Pros**:
- Widely used and documented, with ready made outputs for CSS, TypeScript and native apps.

**Cons**:
- It expects its own format or DTCG (name to value maps). The artifact uses lists, so we'd write a custom parser and a custom format anyway.
- It adds a dependency and a config layer for a single web output.

### Option 3: Use the artifact's compiled `tokens.css` as is

Download the CSS the artifact already compiles, and load it.

**Pros**:
- Nothing to build. The file is exactly what the artifact previews use.

**Cons**:
- No System block, so the OS setting is ignored. No cascade layer. Global type classes with raw values. No letter spacing tokens.
- We'd patch it by hand after every sync, or live with the gaps.

### Option 4: A typed theme in TypeScript (vanilla-extract or similar)

Define tokens as a TypeScript theme contract that compiles to CSS variables.

**Pros**:
- Type checked token names everywhere, including in components.

**Cons**:
- Moves styling away from the CSS Modules spec 0001 chose. It adds a build plugin, and makes the artifact's styles harder to port by hand.
- The artifact would still be a separate source to translate.

## Rationale

Option 1 is the only choice that keeps the artifact as the single source of truth and still fills its gaps without editing its format by hand. The artifact's grammar (lists of `{ name, value, usage }`, colours with per theme values) is simple enough that a direct generator is smaller than the adapter Style Dictionary would need. It also fits the repo: Node runs the script directly, Zod already validates every other input, and the check runs in `pnpm check` like the rest. Option 3 fails the first Done when line that matters, a System theme that follows the OS. Option 4 undoes a decision spec 0001 made for good reasons (native CSS, readable ports).

Committing the generated CSS (your pick) means dev, tests, Vitest and the Vercel build need no extra task. A staleness check makes a hand edit or a forgotten regenerate fail fast, and a token change reads as a diff a person can review.

Fixing the gaps in the artifact first, rather than in a local supplement, follows the house rule that the artifact wins. The artifact type accepts extra token families (up to twelve plain `{ tokens: [...] }` families, which these five stay within), so nothing about its format has to bend.

### Smaller calls, and why

- **System mode in CSS, not JavaScript.**
  - **Pick:** a `prefers-color-scheme` block for `:root:not([data-theme])`. The OS change applies live with no listener.
  - **Runner up:** `matchMedia` in the controller, which costs a script and a frame of lag.
- **Theme blocks, not `light-dark()`.**
  - **Why not `light-dark()`:** it handles colours only. The shadows change shape between themes (the keycap edge sits at the bottom in light and the top in dark), so blocks are needed anyway. One mechanism for both is simpler.
- **A same origin boot script, not an inline one.**
  - **Pick:** `theme-boot.js` in `public/`, loaded first in `<head>`. It satisfies `script-src 'self'` as it stands.
  - **Runner up:** an inline script with a CSP hash, which breaks silently the day someone edits it without updating the hash.
- **The saved choice lives in `localStorage` now, and on the profile from #23** (your pick). The key holds only `light` or `dark`, and System is the key's absence, so there's no third value to drift.
- **One density now** (your pick). The variables are flat names, so a later `[data-density='compact']` block can override sizes and spacing without touching components.
- **Breakpoints as token values, checked by lint** (your pick). With a 1024px floor there's one page breakpoint, and the component container sizes come from the artifact's own components. The runner up, compiled `@custom-media`, works only for `@media`, so containers would still need the lint rule.
- **Unknown tokens caught by `stylelint-value-no-unknown-custom-properties`** (your pick). It runs in the editor, on commit and in CI, and works with Stylelint 17. It also catches the renamed version 7 motion tokens.
- **The Icon atom keeps the artifact's `name` API, backed by an explicit registry.**
  - **Pick:** names match lucide.dev and the artifact, the type system refuses unknown names, and only registered icons ship.
  - **Runner up:** pass the Lucide component itself (`icon={Building}`), equally typed but different from the artifact's API.
  - **Rejected:** a plain string over all 1,857 icons. It ships every icon, or loads each one on demand so it pops in.
- **Fonts self hosted from the artifact's files.** `font-src 'self'` rules out a font host. Vite fingerprints them under `/assets/`, which already get immutable caching.
- **`z-*` for stacking, not `layer-*`.** "Layer" already means a cascade layer here, so the stacking tokens get a name that can't be confused.
- **Focus rings as shadow tokens.** The artifact draws them with raw `3px` and `2px` shadows. As `shadow-focus` and `shadow-focus-inset`, they combine with other shadows (`box-shadow: var(--shadow-control), var(--shadow-focus)`), and a test ties them to `focus-ring`.
- **Contrast fixes move only OKLCH lightness.** Hue and chroma stay, so the look holds. Each value is the smallest change that clears every pair.

### Contrast evidence (computed 2026-10-01 on artifact version 1790844598-fab8)

These are the pairs below their minimum, with the WCAG 2 contrast ratio now and after the proposed fix:

| Theme | Pair (where it appears) | Now | Minimum | After fix |
|---|---|---|---|---|
| Light | `text-tertiary` on `surface-hover` (an empty value on a hovered row) | 4.44 | 4.5 | 4.78 |
| Light | `text-tertiary` on `surface-selected` (menu meta on the highlighted row) | 4.20 | 4.5 | 4.52 |
| Light | `danger` on `surface-hover` (a hovered destructive menu item) | 4.47 | 4.5 | 4.79 |
| Light | `danger` on `surface-selected` (a highlighted destructive menu item) | 4.23 | 4.5 | 4.53 |
| Light | `control-border` on `surface-sidebar` | 3.37 | 3.5 | 3.76 |
| Light | `control-border` on `surface-subtle` | 3.32 | 3.5 | 3.70 |
| Light | `control-border` on `surface-hover` (a checkbox in a hovered row) | 3.18 | 3.5 | 3.54 |
| Dark | `text-tertiary` on `surface-hover` | 4.26 | 4.5 | 5.28 |
| Dark | `text-tertiary` on `surface-selected` | 3.64 | 4.5 | 4.51 |
| Dark | `on-accent` on `accent-hover` (a hovered primary button label) | 3.25 | 4.5 | 5.20 |

Every other pair in the table in `index.md` already passed: 48 pairs, 96 checks across both themes, and all 96 pass after the five fixes. After the fix, `text-tertiary` stays visibly below `text-secondary` in both themes: on `surface` it's 5.27 against 6.72 in light, and 6.46 against 7.63 in dark.
