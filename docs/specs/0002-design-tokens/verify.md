# Verify: Design tokens · spec 0002 · updated 2026-10-01
_Steps derived from spec 0002 acceptance criteria (AC-1 to AC-12) and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Build the web app (`pnpm --filter @crm/web build`) and serve `apps/web/dist` with the headers from `apps/web/vercel.json` (or open a Vercel preview). With the OS on light, open it → the status page is `text` (`#18191d`) on `surface` (`#fdfdff`), in Inter at 13px, with no browser default margins → AC-5 _(passed 2026-10-01: production build served with the vercel.json headers on :4173, headless Chromium; body rgb(24, 25, 29) on rgb(253, 253, 255), Inter 13px, h1 margin 0)_
- [x] Switch the OS (or the browser's emulated colour scheme) to dark without reloading → the page turns to `#ebedef` on `#18191c` live, and `<html>` has no `data-theme` → AC-6, AC-8 _(passed 2026-10-01: emulated dark without reload gave rgb(235, 237, 239) on rgb(24, 25, 28), no data-theme)_
- [x] In the console, `localStorage.setItem('crm.theme', 'dark')`, set the OS to light, reload → the page paints dark from the first frame (`data-theme="dark"` is already set when the document becomes interactive, before the app script runs) → AC-7 _(passed 2026-10-01: data-theme was already dark when the document became interactive, before the app script)_
- [x] Open a second tab on the app, then in the first tab run `localStorage.setItem('crm.theme', 'light')` → the second tab turns light without a reload. `localStorage.removeItem('crm.theme')` in the first → the second follows the OS again → AC-7 _(passed 2026-10-01: the second tab went light, then back to no data-theme, without reloading)_
- [x] Block site storage for the page (or throw from `localStorage`), reload → the page still renders and follows the OS, with no errors → AC-7 _(passed 2026-10-01: localStorage throwing on access, the page rendered dark from the OS with no errors)_
- [x] `localStorage.setItem('crm.theme', 'purple')`, reload → the page follows the OS, and `<html>` has no `data-theme` → AC-7 _(passed 2026-10-01: no data-theme, light from the OS)_
- [x] With the console open across all of the above → 0 errors, 0 warnings and no Content Security Policy violations. The network panel shows `Inter-Variable-latin-*.woff2` loaded from `/assets/`, and `theme-boot.js` from the same origin → AC-11 _(passed 2026-10-01: 0 console errors or warnings in six pages; every request on localhost:4173, Inter from /assets/, theme-boot.js same origin)_
- [ ] Open the design system artifact (https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh) → its token cards list the `zIndex`, `opacity`, `scale`, `borderWidth` and `breakpoint` families, `shadow-focus`, `shadow-focus-inset`, `size-tile`, `label-strong`, and the new `text-tertiary`, `danger`, `control-border` and `accent-hover` values, with a Version 9 changelog entry → AC-1 _(blocked 2026-10-01: the artifact's `tokens.json` matches the repo byte for byte and its Changelog shows Version 9, but the page itself needs your login to open, and its generated agent card `api/tokens.md` still listed version 8 values)_

## Commands
- [x] `pnpm tokens:check` → "tokens.css matches tokens.json". Add a character to `packages/tokens/tokens.css` and run it again → `TOKENS_STALE`, exit 1. Run `pnpm tokens:build` to restore it → AC-3 _(passed 2026-10-01: exit 0, then TOKENS_STALE exit 1, then exit 0 after tokens:build)_
- [x] `shasum -a 256 packages/tokens/tokens.json` equals the artifact's `project/tokens.json` at the version in `packages/tokens/source.json` (`1790848498-5204`) → AC-1 _(passed 2026-10-01: both 6948850a5c36…387c)_
- [x] `pnpm --filter @crm/tokens test` → the generator suite passes: theme blocks, the System media block, `color-scheme`, type shorthands with tracking, aliases as `var()`, `@font-face`, and each coded refusal → AC-2 _(passed 2026-10-01: 33 tests)_
- [x] Same run → the contrast suite passes 96 checks in both themes, and its version 8 fixture fails on exactly the ten known pairs → AC-4 _(passed 2026-10-01)_
- [x] Change `text-tertiary`'s light value in a copy of `tokens.json` to `#6c7077` and run the contrast test against it → it fails, naming `text-tertiary` on `surface-hover` and `surface-selected` → AC-4 _(passed 2026-10-01: 4.44 on surface-hover, 4.20 on surface-selected)_
- [x] `pnpm --filter @crm/web test` → the built CSS keeps the layer order `reset, tokens, base, components, utilities`, the fonts are `/assets/*.woff2` (never `data:`), and the built `index.html` runs `theme-boot.js` before the stylesheet and the app script → AC-5, AC-11, AC-12 _(passed 2026-10-01: 18 tests)_
- [x] `pnpm --filter @crm/ui test` → the theme controller (save, clear, other tabs, blocked storage) and the Icon atom (decorative by default, labelled, sizes, tones, tiles, registry names, `Hue` against the tag tokens) pass → AC-7, AC-9 _(passed 2026-10-01: 35 tests)_
- [x] `pnpm --filter @crm/config test` → Stylelint refuses raw `opacity`, `scale` and `z-index`, `@container (width < 400px)`, `@media (max-width: 1023.98px)`, `@media (min-width: 64rem)`, `calc()` in a condition and `var(--duration-fast)`, and allows the token forms. ESLint refuses `lucide-react` outside the registry → AC-9, AC-10 _(passed 2026-10-01: 73 tests)_
- [x] Write `.x { opacity: 0.5; }` into any `packages/ui` CSS module and run `pnpm lint:css` → refused. Import `lucide-react` in any `packages/ui` file other than `icons.ts` and run `pnpm lint` → refused → AC-9, AC-10 _(passed 2026-10-01: both refused, files restored)_
- [x] `pnpm check` and `pnpm test` → both green → AC-12 _(passed 2026-10-01: check exit 0; 163 tests in 5 packages)_
- [x] Search `apps/web/src` for `className`, `style=` or a hex, px or ms value → none → AC-5, AC-8 _(passed 2026-10-01: 0 matches in 4 files)_

## Value sourcing
- [x] Every CSS variable in `tokens.css` comes from `tokens.json`: pick three tokens (a colour, a shadow, a plain one) and compare their values in both files, in both themes → Generate _(passed 2026-10-01: text-tertiary, shadow-focus and z-modal match in both themes)_
- [x] The System block's values equal the `[data-theme='dark']` block's, token for token → Generate _(passed 2026-10-01: 72 declarations, identical)_
- [x] `--text-label-strong` is `500 11px/16px var(--font-sans)` and `--tracking-heading` is `-0.01em`, from the `label-strong` and `heading` styles → Generate _(passed 2026-10-01)_
- [x] The header of `tokens.css` names version `1790848498-5204`, from `source.json` → Generate, Sync _(passed 2026-10-01)_
- [x] `tokens.json`'s own `version` field stays `1` (the grammar version), while `source.json` holds the artifact version → Sync _(passed 2026-10-01)_
- [x] With `crm.theme` unset, `<html>` never gets `data-theme`; the colours come from `prefers-color-scheme` alone → Boot, Render _(passed 2026-10-01)_
- [x] `<Icon name="users" tile="green" />` renders with the `tag-green-*` colours and a `size-tile` square, holding a 14px icon → Icon _(passed 2026-10-01 in a Vite harness: 20px tile, rgb(217, 244, 228) fill, rgb(0, 48, 27) icon, 1px rgb(190, 231, 207) border, 4px radius, 14px icon at 1.5 stroke, role img "People")_
- [x] Change `bp-container-md` in a copy of `tokens.json`, point the breakpoint rule at it, and lint `@container (width < 480px)` → refused, so the allowed values really come from the token file → Lint _(passed 2026-10-01: with it at 500px, 480px was refused and 500px allowed; restored)_

## Acceptance-criteria coverage
- AC-1: artifact card check, the sha comparison, and the header version
- AC-2: the generator suite and the Value sourcing steps
- AC-3: `tokens:check`, stale then rebuilt
- AC-4: the contrast suite and the changed `text-tertiary` check
- AC-5: the light render, the built CSS test, and the screen search
- AC-6: the live OS switch
- AC-7: the saved choice reload, the second tab, blocked storage, the unknown value, and the ui and web suites
- AC-8: the live switch with no `data-theme`, and the screen search
- AC-9: the ui suite, the config suite, and the stray `lucide-react` import
- AC-10: the config suite and the stray `opacity` value
- AC-11: the console, network and CSP check, and the built page test
- AC-12: the built CSS test, `pnpm check` and `pnpm test`
