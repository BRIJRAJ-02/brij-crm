# packages/ui

## Overview

The component library every screen draws with. It holds the root stylesheet (cascade layers, reset and base), the theme controller, the provider every app wraps itself in, and the components, built on React Aria Components. Components are code first: they are built and storied here, then published to the design system artifact (spec 0003). Tokens still flow the other way, from the artifact into code. Component library (#4) is still adding components. Tagged `client`. Build everything here to the `crm-design-system` house rules.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public surface screens import from `@crm/ui`: components and their types. `src/index.test.ts` pins the list |
| `src/styles/index.css` | `@crm/ui/styles.css`: the layer order `reset, tokens, base, components, utilities`, then the tokens, the reset and the base styles |
| `src/styles/reset.css`, `src/styles/base.css` | `@layer reset` and `@layer base`: the page background, and body type and colour, all from tokens |
| `src/theme/theme.ts` | `@crm/ui/theme`: the `crm.theme` storage key, `parseThemeChoice`, `safeLocalStorage` and `createThemeController` |
| `src/hue.ts` | `HUES` and `Hue`, the nine data hues used by tags and icon tiles |
| `src/atoms/Icon/` | The Icon atom, its CSS module, its README, and `icons.ts` (the icon registry) |
| `src/atoms/<Name>/` | One component: `<Name>.tsx`, its CSS module, `strings.ts` for its built in copy, `README.md` and `<Name>.stories.tsx` |
| `src/provider/` | `UiProvider` (language, time zone, router links, the toast queue, the clock, loading timing), `createToasts()`, `createClock()` and `useDelayedLoading()` |
| `src/vite.ts` | `@crm/ui/vite`: `uiVite()`, which names CSS module classes `ws-<component>-<local>` (every Vite build that renders the library uses it), and `layerOrder()`, which links the layer order ahead of an app's bundled stylesheets |
| `src/workbench/` | `Stage` and `StoryRoot`, used only by stories. Never exported |
| `.storybook/` | Storybook config. `preview.tsx` wraps every story in the provider with a frozen clock; `vitest.setup.ts` runs axe in light and dark and fails a story on any CSP violation |
| `vitest.config.ts` | Four test projects: `unit` (Node), `stories` (Chromium, Firefox, WebKit), `browser` (`*.browser.test.tsx`, Chromium) and `visual` (screenshots) |
| `scripts/test-visual.ts` | `pnpm test:visual`: runs the `visual` project in the pinned Playwright Linux image, against `__screenshots__/` |
| `scripts/artifact/` | `pnpm ui:artifact`: builds the React scripts, the bundle, its stylesheet, its types and one preview per flagged story for the design system artifact |
| `artifact.json` | The artifact's URL and the version id of the last publish |

## Commands

```bash
pnpm --filter @crm/ui test         # unit (Node), every story in Chromium, Firefox and WebKit, and the browser tests
pnpm --filter @crm/ui test:unit    # the Node tests only
pnpm --filter @crm/ui typecheck
pnpm storybook                     # Storybook on :6006 (also serves the Storybook MCP at /mcp)
pnpm test:visual                   # screenshots in the pinned Playwright Linux image (needs Docker); add --update to rewrite baselines
pnpm ui:artifact                   # build the artifact files into .artifact/; --check builds and render checks them only
```

## Conventions

- Each component's CSS lives in a CSS module beside it, inside `@layer components`, using tokens only. Variants are data attributes (`data-size`, `data-tone`, `data-hue`) declared once in that module. Callers never pass a class name or a style.
- Every styled component has a `README.md` beside it (`pnpm house-rules` checks this). The README says where its API differs from the artifact's, and why.
- Icons come only from Lucide, through `src/atoms/Icon/icons.ts`, the one file ESLint lets import `lucide-react`. To add an icon, add one import and one line there, under its lucide.dev name.
- `src/hue.ts` must list exactly the hues that have `tag-<hue>-*` tokens. A test checks it against `tokens.json`.
- The theme logic stays on the `@crm/ui/theme` subpath, with no React, so the boot script test and other tools can load it. The main entry exports components and their types only, and `src/index.test.ts` pins that list.
- A theme choice is `system`, `light` or `dark`. System saves nothing and sets no `data-theme`, so the OS decides through CSS alone. Never add a `matchMedia` listener for it.
- An icon is hidden from screen readers unless it has a `label`. With a label, it reads as an image with that name.
- Interactive components wrap React Aria Components. Only this package may import React Aria, Tiptap or Yjs (lint), and it makes no network calls and never imports `@crm/data` or `@orpc/*`: data comes in through props.
- Every word a component shows by itself (labels, announcements) lives in its `strings.ts`. Lint refuses literal text in the library's markup.
- Every component folder has a README and stories (`pnpm house-rules`). CSS module file names and story titles are unique across the package, because class names are `ws-<component>-<local>` with no hash.
- Stories are the browser tests. Each one runs in three engines with axe in light and dark, under a strict CSP. States you reach by interacting (hover, focus, press, typing) are set up in `play` functions with `storybook/test`.
- A story flagged `parameters.crm.preview` becomes the component's live preview in the artifact. Keep preview stories cheap: build menus and long lists inside a function, never as JSX at module level, or the preview carries them.
- `parameters.crm.screenshot = false` leaves a story out of the screenshots; do it when another story already shows the same thing. Baselines over 200 KB are refused.
- After changing a component, run `pnpm ui:artifact`, publish `.artifact/project/` to the artifact from `artifact.json`, then write the new version id back into `artifact.json`.
- Components read the language, time zone and current time from `UiProvider`, never from `navigator`, `Intl` defaults or `Date.now()`. Stories freeze the clock at 8 October 2026, 14:30 UTC, in Europe/London.
- One exception to "no mutable state at module level": `lib/intl-memo.ts` caches `Intl` formatters (and the segmenter) by kind, language and options, through `memoIntl(key, make)`. It holds only immutable values, so nothing behaves differently for it; a grid scroll formats hundreds of values a step, and building each formatter again broke the long task budget (AC-7). Nothing else lives at module level.

## Gotchas

- `apps/web/public/theme-boot.js` repeats the storage key and the `light` or `dark` check, because it has to run before any module loads. Change `THEME_STORAGE_KEY` and that file together (`apps/web/theme-boot.test.ts` checks they match).
- Vite's CSS minifier (Lightning CSS) removes the `@layer` order statement from the build, and a shared chunk's CSS can load before the reset. So `layerOrder()` in `src/vite.ts` publishes the root stylesheet's `@layer` statement as `/layers.css` and links it ahead of every bundled stylesheet; `apps/web/build.test.ts` checks it.
- The `unit` project runs in Node with no DOM, so anything that renders belongs in a story or a `*.browser.test.tsx`, which run in real browsers.
- React Aria's `Button` drops `aria-keyshortcuts`. Pass it through the `render` prop, as `Button.tsx` does.
- Toast is still `UNSTABLE_` in React Aria. Only `src/provider/toasts.tsx` imports it, so an upgrade changes one file.
- Storybook injects a few styles of its own while tests run. `vitest.setup.ts` allows exactly those sources through the CSP check; anything else that injects a style fails the story.
- Screenshots never run outside the pinned image (the `visual` project refuses), since fonts render differently per machine. If Playwright's Firefox won't start on your machine, the Firefox stories run in that image too.
- The artifact previews load React as browser globals, so a preview story may import only the library, React and `storybook/test` (stubbed). Anything else lands in the bundle.

## Agent skills

- [building-components](../../.claude/skills/building-components/): `vercel/components.build`, accessible, composable components
- [semantic-html-first](../../.claude/skills/semantic-html-first/): `kemiljk/skills`, the right element and accessible behaviour for each control
- [modern-css-html](../../.claude/skills/modern-css-html/): `kemiljk/skills`, native CSS and HTML features and browser support
- [react-aria](../../.claude/skills/react-aria/): `react-aria.adobe.com`, Adobe's docs for every React Aria component, hook and testing guide
- [stories](../../.claude/skills/stories/): `storybookjs/storybook`, writing and previewing stories through the Storybook CLI and MCP
- [tiptap](../../.claude/skills/tiptap/): `ueberdosis/tiptap`, the rich text editor (from milestone 4 of #4)
- [react-flow](../../.claude/skills/react-flow/): `existential-birds/beagle`, the schema map (from milestone 5 of #4)
- [tanstack-virtual](../../.claude/skills/tanstack-virtual/): `tanstack-skills/tanstack-skills`, the grid and long lists
- [vitest](../../.claude/skills/vitest/): `antfu/skills`, the four test projects and browser mode
- [playwright-cli](../../.claude/skills/playwright-cli/): `microsoft/playwright-cli`, the browsers behind them
- The rest of the UI skills (motion, polish, reviews) are listed in [apps/web/AGENTS.md](../../apps/web/AGENTS.md).
- Declined: a community axe skill (`airowe/claude-a11y-skill` has no valid `SKILL.md`). No size-limit skill exists.
- MCP servers: storybook (project, in `.mcp.json`; live only while `pnpm storybook` runs), lists the stories and their docs.

## Related specs

- [0002 Design tokens](../../docs/specs/0002-design-tokens/index.md)
- [0003 Component library](../../docs/specs/0003-component-library/index.md)

_Drafted by /sync from the introducing change, worth a quick human pass._
