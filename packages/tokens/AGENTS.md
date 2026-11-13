# packages/tokens

## Overview

The design tokens: a byte for byte copy of the Timefix design system's token file (`design/timefix-design-system/tokens.json`, published to the [Timefix design system artifact](https://claude.ai/artifact/KzpzW1c8binDdobPZ2HB11); spec 0071), the legacy tokens the code still needs that the source lacks, and the CSS and TypeScript generated from both. The source is written at full size; the app draws at `density-app` (0.88), so the scaled families are generated twice: full size for guest pages and emails, and the app's values under `<html data-scale="app">`. Tagged `shared`. It depends on nothing else in the repo, so the web app and the email templates can both read it.

## Key files

| File | Owns |
|---|---|
| `tokens.json` | A byte for byte copy of the source named in `source.json` (`design/timefix-design-system/tokens.json`), written by `pnpm tokens:build`. Never edited by hand: change the source, then build |
| `source.json` | The source file, the design system artifact, its published version (`unpublished` until someone publishes) and the date of the sync |
| `legacy.json` | Hand edited: every token the code still needs that the source lacks (sizes such as `size-toolbar`, `size-chip` and the guest pages' 46px `size-bar`, the `tag-*-border` colours, `shadow-control`, the focus shadows, the public booking page's `duration-public-*`), in the source's grammar with every family optional and a required `retire` note naming the port phase that removes it. Never scaled. Shrinks each phase; a guest page or a stopgap only, never a home for a new app token |
| `fonts/` | Geist and Geist Mono (variable, Latin, from Fontsource), and the six link page packs (Fontsource's Latin subsets), with the SIL Open Font License text in `LICENSE.md` |
| `fallbacks.css` | Hand written: the metric matched local stand ins `Geist Fallback` (over Arial) and `Geist Mono Fallback` (over Courier New), which the type families list right after each face, so text drawn before the woff2 arrives takes the same room. Re-measure if the Geist files change. Imported by `@crm/ui/styles.css` |
| `packs.css`, `packs-templates.css`, `src/packs.ts` | The link page's font packs (spec 0060, AC-12): six open licence faces (Host Grotesk, Fraunces, Newsreader, Bricolage Grotesque, Outfit, Instrument Serif), each with a metric matched local fallback, and the `--font-pack-*` families. The three the templates wear (Host Grotesk, Fraunces, Outfit: Classic, Studio, Night) live in `packs-templates.css`, which `packs.css` imports and the booking page and hosted form pull into their own module stylesheet with `@import`, so neither carries the other three nor a file of its own (the booking page's CSS budget). Hand written, not generated: the faces are the link page's, not the design system's, so `tokens.json` never names them. `FONT_PACKS` (`@crm/tokens/packs`) names each pack's heading file for the shells' preload; `packs.test.ts` holds the CSS, the map and the contracts' `PAGE_FONTS` together. Imported by `LinkPage`, so only pages that draw a link page carry them, and a face is fetched only once text is drawn in it |
| `tokens.css` | Generated and committed, all inside `@layer tokens`: source and legacy tokens at full size, under `:root` and the theme blocks. Never edited by hand |
| `tokens-app.css` | Generated and committed: the app's sizes alone, under `:root[data-scale='app']` (type sizes and line heights, `spacing`, `radius` except `radius-full`, and `size`, each source value times `density-app`, rounded by the rules in spec 0071). `@crm/ui/app.css` loads it for the app and the stories; public pages never carry it |
| `values.ts` | Generated and committed (`@crm/tokens/values`): every plain, size and type token as `full` and `app` values, plus the legacy tokens. The only way TypeScript reads a token value (`@crm/ui`'s `token-values.ts`, the emails' full values) |
| `src/grammar.ts` | The Zod schema of the artifact's token grammar (each family is a list of tokens, never a name to value map) |
| `src/generate.ts` | `generateTokensCss()`: turns `tokens.json` and `legacy.json` into `tokens.css`, `tokens-app.css` and `values.ts`, or refuses them with a coded error. Holds the scale rules and the lists of which `size` tokens are heights and which are widths |
| `src/contrast.ts` | The WCAG 2 contrast pairs, and the checker the contrast test runs in both themes |
| `scripts/generate.ts` | The command behind `pnpm tokens:build` (copy the source, then write the three generated files) and `pnpm tokens:check` |
| `scripts/rename-0071.ts` | Temporary: spec 0071's rename map from the old token names to the prototype's, as a guarded one pass rewrite for an open branch to run before rebasing onto phase 0. Deleted once no open branch needs it |

## Commands

```bash
pnpm tokens:build                 # copy the source tokens.json, then regenerate tokens.css, tokens-app.css and values.ts
pnpm tokens:check                 # exit 1 on TOKENS_SOURCE_DRIFT (the copy differs from the source) or TOKENS_STALE (a generated file isn't what the generator makes); part of pnpm check
pnpm --filter @crm/tokens test    # the generator, the command line, and the contrast pairs
```

## Conventions

- A token value is decided in the source, `design/timefix-design-system/tokens.json` (spec 0071). To add or change one:
  1. Edit the source (a new font file goes in `fonts/` here).
  2. Run `pnpm tokens:build`, then commit the source, the copy and the generated files together, with the tests green.
  3. Publish the design system artifact from `design/timefix-design-system`, and set `source.json` `version` to the published version id and `synced` to today.
- `source.json` `version` is the artifact's published version id. The `version` field inside `tokens.json` is the grammar version, so leave it alone.
- **Porting rule (phases 1 to 9, spec 0071 AC-17):** every raw length in prototype CSS becomes a token; if no token fits, the source gains one first. Nothing ports a raw prototype pixel value. Token names are the prototype's, so its CSS is copied, not translated.
- **Names are steps, not pixels.** `space-16` draws 16px on a guest page and 14px in the app. A new `size` token in the source must be on the generator's height list or its width list (each scales and rounds differently), or the build refuses it with `TOKENS_INVALID`.
- **Legacy tokens** are merged with the source as data before anything is written: a legacy colour or shadow joins the theme blocks, a plain one the `:root` block, never scaled. A name in both files is refused (`TOKENS_DUPLICATE`). A port phase deletes the entries its `retire` notes name.
- The generated CSS has light values under `:root, [data-theme='light']` and dark values under `[data-theme='dark']`. The dark values appear again under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme])`, so System needs no script. Each theme block sets its `color-scheme`. Aliases become `var()`. Each type style becomes a `--text-<style>` font shorthand plus `--tracking-<style>`.
- Expected failures carry a code: `TOKENS_INVALID`, `TOKENS_UNKNOWN_FAMILY` and `TOKENS_DUPLICATE` from the generator, and `TOKENS_SOURCE_DRIFT` and `TOKENS_STALE` from the check. The command writes nothing when it fails.
- A new token family needs a schema in `src/grammar.ts` and a rule in `src/generate.ts`. An unknown family is refused, never skipped.
- When a screen starts relying on a new colour pairing, add it to `src/contrast.ts`, so the contrast test guards it in both themes.

## Gotchas

- Prettier ignores `tokens.json`, `tokens.css`, `tokens-app.css`, `values.ts` and `legacy.json` (see `.prettierignore`). That keeps the copy byte for byte, leaves the generated files to the check, and keeps the legacy file in the source's layout. Never reformat them.
- Stylelint reads `tokens.css` (the names `var()` may use) and `tokens.json` (the allowed breakpoint values) from this folder. A token that is new in `tokens.json` isn't usable in CSS until `pnpm tokens:build` has run.
- `:root` without `data-scale` is full size, the safe default: anything that misses the attribute draws like a guest page, never smaller. The app's `theme-boot.js` sets the attribute (see `apps/web/AGENTS.md`).
- The fonts cover Latin only. Text in other scripts falls back to the system font until the fuller subsets are added (spec 0002, Follow-up).

## Related specs

- [0002 Design tokens](../../docs/specs/0002-design-tokens/index.md)
- [0071 Port phase 0: the Timefix type scale and tokens](../../docs/specs/0071-port-tokens/index.md)

_Drafted by /sync from the introducing change, worth a quick human pass._
