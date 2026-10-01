# packages/ui

## Overview

The component library every screen draws with. Today it holds the root stylesheet (cascade layers, reset and base), the theme controller and the Icon atom. The components arrive with Component library (#4). Tagged `client`. Build everything here to the design system artifact and the `crm-design-system` house rules.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public surface screens import from `@crm/ui`: components and their types (today `Icon` and `HUES`) |
| `src/styles/index.css` | `@crm/ui/styles.css`: the layer order `reset, tokens, base, components, utilities`, then the tokens, the reset and the base styles |
| `src/styles/reset.css`, `src/styles/base.css` | `@layer reset` and `@layer base`: the page background, and body type and colour, all from tokens |
| `src/theme/theme.ts` | `@crm/ui/theme`: the `crm.theme` storage key, `parseThemeChoice`, `safeLocalStorage` and `createThemeController` |
| `src/hue.ts` | `HUES` and `Hue`, the nine data hues used by tags and icon tiles |
| `src/atoms/Icon/` | The Icon atom, its CSS module, its README, and `icons.ts` (the icon registry) |

## Commands

```bash
pnpm --filter @crm/ui test         # the theme controller, the Icon atom and the public surface
pnpm --filter @crm/ui typecheck
```

## Conventions

- Each component's CSS lives in a CSS module beside it, inside `@layer components`, using tokens only. Variants are data attributes (`data-size`, `data-tone`, `data-hue`) declared once in that module. Callers never pass a class name or a style.
- Every styled component has a `README.md` beside it (`pnpm house-rules` checks this). The README says where its API differs from the artifact's, and why.
- Icons come only from Lucide, through `src/atoms/Icon/icons.ts`, the one file ESLint lets import `lucide-react`. To add an icon, add one import and one line there, under its lucide.dev name.
- `src/hue.ts` must list exactly the hues that have `tag-<hue>-*` tokens. A test checks it against `tokens.json`.
- The theme logic stays on the `@crm/ui/theme` subpath, with no React, so the boot script test and other tools can load it. The main entry exports components and their types only, and `src/index.test.ts` pins that list.
- A theme choice is `system`, `light` or `dark`. System saves nothing and sets no `data-theme`, so the OS decides through CSS alone. Never add a `matchMedia` listener for it.
- An icon is hidden from screen readers unless it has a `label`. With a label, it reads as an image with that name.

## Gotchas

- `apps/web/public/theme-boot.js` repeats the storage key and the `light` or `dark` check, because it has to run before any module loads. Change `THEME_STORAGE_KEY` and that file together (`apps/web/theme-boot.test.ts` checks they match).
- Vite's CSS minifier (Lightning CSS) removes the `@layer` order statement from the build. The order still holds, because each layer first appears in that order, and `apps/web/build.test.ts` checks it.
- The tests run in Node with no DOM, so components are checked through `renderToStaticMarkup`.

## Agent skills

- [building-components](../../.claude/skills/building-components/): `vercel/components.build`, accessible, composable components
- [semantic-html-first](../../.claude/skills/semantic-html-first/): `kemiljk/skills`, the right element and accessible behaviour for each control
- [modern-css-html](../../.claude/skills/modern-css-html/): `kemiljk/skills`, native CSS and HTML features and browser support
- The rest of the UI skills (motion, polish, reviews) are listed in [apps/web/AGENTS.md](../../apps/web/AGENTS.md).

## Related specs

- [0002 Design tokens](../../docs/specs/0002-design-tokens/index.md)

_Drafted by /sync from the introducing change, worth a quick human pass._
