# 0003 · The workbench and the tests

## Summary

Storybook 10 is where components are built and reviewed. Each state is a story, and the same stories run as tests in real Chromium, Firefox and WebKit, with accessibility checks and keyboard scripts. Screenshots of every story, in light and dark, are compared against baselines made in one Linux image, so a stray CSS change can't slip through. The stories also become the artifact's live previews when publishing.

## Versions (checked 2026-10-01)

| Package | Version | Fits |
|---|---|---|
| `storybook`, `@storybook/react-vite` | 10.6.1 | Vite 5 to 8, React 16.8 to 19 |
| `@storybook/addon-vitest` | 10.6.1 | Vitest 3 to 5, `@vitest/browser-playwright` 4 to 5 |
| `@storybook/addon-a11y` | 10.6.1 | axe-core 4.13 underneath |
| `@storybook/addon-mcp` | with Storybook 10.3 and later | the official MCP server |
| `vitest`, `@vitest/browser`, `@vitest/browser-playwright` | 5.0.3 (vitest already in the catalog) | Vite 6.4 to 8 |
| `playwright` | 1.63.0 | Chromium, Firefox, WebKit |
| `size-limit`, `@size-limit/preset-app` | 14.1.0 | |

All are pinned exactly in the catalog, as the house rules require.

## Storybook

- Lives in `packages/ui/.storybook/`. `main.ts` uses `@storybook/react-vite`, with `viteFinal` applying `uiVite()`, so class names and settings match the app.
- `preview.tsx` loads `@crm/ui/styles.css`, wraps every story in `UiProvider` (with a fresh `createToasts()` and a fixed clock per story), wraps the story in an element with `data-testid="story-root"` (Storybook's own root is `#storybook-root`), and adds three toolbar switches:
  - theme: light, dark or system, setting `data-theme` on the preview's `<html>`;
  - language: `en-US`, `en-GB` or `de-DE`, to see formats and the week start change;
  - motion: normal or reduced.
- `preview-head.html` sets a CSP `<meta>` with the production `style-src`, `img-src`, `worker-src` and `frame-src` rules (not `script-src`, which Storybook's own scripts need). A setup file fails any story test that fires a `securitypolicyviolation` event, which catches injected `<style>` tags, `blob:` workers and outside images.
- `pnpm storybook` serves it on :6006. The MCP addon is installed with it. To use it, connect it once in your MCP settings while Storybook runs; agents can then read stories and props.

## Stories

- One `Name.stories.tsx` per component, in CSF 3 with typed `args`. There is one story per state in [0003-conventions.md](0003-conventions.md): `Default`, `Empty`, `Loading`, `Error`, `ReadOnly`, `Disabled`, plus `Selected`, `Invalid` and the variants where they apply.
- Hover, focus and pressed states are reached in `play` functions (`userEvent.hover`, `userEvent.tab`), not faked with CSS.
- Every interactive component has at least one keyboard `play` script. It opens the component, moves through it, chooses something, closes it, and checks that focus returned. These scripts are the proof for AC-6.
- Field set stories cover every type on every surface (cell, panel, card, form, filter, preview). They are the walk AC-4 asks for.
- Stories never fetch. Data comes from fixtures in `packages/ui/src/fixtures/`: realistic people, companies and deals, with long names and empty values.
- Tests get a `parameters.crm.preview` flag for the stories to publish to the artifact (two to four per component).

## Tests

- `packages/ui/vitest.config.ts` defines three projects:
  1. **`stories`**: `storybookTest()` from the Vitest addon runs every story, and its `play` function, as a browser test. The browser provider is `@vitest/browser-playwright`, with instances for `chromium`, `firefox` and `webkit`.
  2. **`unit`**: Node tests for pure helpers (formatting, parsing, the theme controller from spec 0002).
  3. **`visual`**: screenshots (below), Chromium only.
- **Accessibility**: `parameters.a11y.test = 'error'` globally, so an axe violation fails the story test.
  - The dark run: the `stories` project's setup file wraps each story test. After the light run (and its `play`), it sets `data-theme="dark"` on `<html>` and runs axe again through the a11y addon's runner. That covers contrast in both themes.
  - Cost: about 3 engines × stories × 2 themes. The dark rerun is axe only, which is fast.
- **Forced colours**: a story test per interactive component, Chromium only. It switches on `forced-colors: active` through a custom browser command on the Playwright provider (`page.emulateMedia({ forcedColors: 'active' })`), which Vitest's `page` doesn't expose directly. It checks the focused element has a visible outline, and axe's colour contrast rule is skipped in that run.
- **Charts**: a test counts React renders across a theme switch and expects zero (AC-20).
- **Unit tests in contracts**: the value schemas are tested in `packages/contracts` (Node): valid samples, canonical forms, and refusals with `ATTRIBUTE_VALUE_INVALID`.
- **The grid performance test** is its own browser test ([0003-data-grid.md](0003-data-grid.md)).
- **The first load test** lives in `apps/web`: it reads `dist/.vite/manifest.json` and fails if a heavy chunk is in the index route's static imports (AC-18).
- `pnpm --filter @crm/ui test` runs `stories` and `unit`. The root `pnpm test` includes it.

## Screenshots

- The `visual` project renders each story in Chromium and calls `await expect(page.getByTestId('story-root')).toMatchScreenshot()`, once in light and once in dark.
- Screens are captured after `play` completes, with animations and transitions forced to zero duration and the clock fixed.
- Baselines live in `packages/ui/__screenshots__/`, named by Vitest with the platform suffix (`-linux`). Only Linux baselines are committed.
- **Storage**: plain git, no LFS. The update command fails on any PNG over 200 KB, which means the story frames too much. A story can opt out with `parameters.crm.screenshot = false` when another story already shows the same state.
- **Locally**: `pnpm test:visual` runs inside the pinned image `mcr.microsoft.com/playwright:v1.63.0-noble` through Docker (OrbStack works), with the repo mounted. Fonts and rendering then match CI exactly.
  - `pnpm test:visual --update` rewrites baselines in the same image.
  - Running it outside Docker is refused with a message, so stray macOS baselines are never committed.
- **In CI**: a `visual` job runs in that image as a container. A changed screenshot fails the job and uploads the diff images as an artifact for review. Changed baselines show up in the PR as image diffs.

## CI changes (`.github/workflows/ci.yml`)

- The `check` job installs Playwright's browsers (`pnpm exec playwright install --with-deps chromium firefox webkit`, cached by the Playwright version) before `pnpm test`.
- It runs `pnpm size` after building the web app.
- A new `visual` job runs in the Playwright container and runs `pnpm test:visual`.
- `pnpm ui:artifact --check` runs in `check`. It builds the artifact files and checks their size caps, but publishes nothing (CI can't reach the private artifact).
- Story tests shard across runners (`--shard`). Milestone 1 measures the timings and sets the shard count, aiming for a job under 10 minutes.

## What changes for existing tests

- `packages/ui/src/atoms/Icon/Icon.test.tsx` (string parsing in Node) is replaced by Icon stories with `play` checks. The registry and `Hue` checks move to the `unit` project.
- `src/theme/theme.test.ts` and `src/index.test.ts` stay in `unit`. `index.test.ts`'s list of exports grows as components land.
