# packages/tokens

## Overview

The design tokens: an exact copy of the token file from the design system artifact ([CRM Workspace](https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh)), plus the CSS variables generated from it. Tagged `shared`. It depends on nothing else in the repo, so the web app now, and email templates later, can both read it.

## Key files

| File | Owns |
|---|---|
| `tokens.json` | The artifact's `project/tokens.json`, copied as is. Never edited by hand |
| `source.json` | Which artifact and published version `tokens.json` came from, and the date of the sync |
| `fonts/` | Inter and JetBrains Mono (variable, Latin), from the artifact's `project/fonts/`, with the SIL Open Font License text in `LICENSE.md` |
| `tokens.css` | Generated and committed, all inside `@layer tokens`. Never edited by hand |
| `src/grammar.ts` | The Zod schema of the artifact's token grammar (each family is a list of tokens, never a name to value map) |
| `src/generate.ts` | `generateTokensCss()`: turns `tokens.json` into CSS, or refuses it with a coded error |
| `src/contrast.ts` | The WCAG 2 contrast pairs, and the checker the contrast test runs in both themes |
| `scripts/generate.ts` | The command behind `pnpm tokens:build` and `pnpm tokens:check` |

## Commands

```bash
pnpm tokens:build                 # regenerate tokens.css from tokens.json and source.json
pnpm tokens:check                 # TOKENS_STALE, exit 1, if tokens.css isn't what the generator makes (part of pnpm check)
pnpm --filter @crm/tokens test    # the generator, the command line, and the contrast pairs
```

## Conventions

- A token value is decided only in the artifact. To add or change one:
  1. Publish the change to the artifact.
  2. Read `project/tokens.json` (and any new fonts) back through the Artifact tool, and copy it here byte for byte.
  3. Set `source.json` `version` to the version id that read reports, and `synced` to today.
  4. Run `pnpm tokens:build`, then commit the synced files and the new `tokens.css` together, with the tests green.
- `source.json` `version` is the artifact's published version id. The `version` field inside `tokens.json` is the grammar version, so leave it alone.
- The generated CSS has light values under `:root, [data-theme='light']` and dark values under `[data-theme='dark']`. The dark values appear again under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme])`, so System needs no script. Each theme block sets its `color-scheme`. Aliases become `var()`. Each type style becomes a `--text-<style>` font shorthand plus `--tracking-<style>`.
- Expected failures carry a code: `TOKENS_INVALID`, `TOKENS_UNKNOWN_FAMILY` and `TOKENS_DUPLICATE` from the generator, and `TOKENS_STALE` from the check. The command writes nothing when it fails.
- A new token family needs a schema in `src/grammar.ts` and a rule in `src/generate.ts`. An unknown family is refused, never skipped.
- When a screen starts relying on a new colour pairing, add it to `src/contrast.ts`, so the contrast test guards it in both themes.

## Gotchas

- Prettier ignores `tokens.json` and `tokens.css` (see `.prettierignore`). That keeps the copy byte for byte and leaves the generated file to the check. Never reformat them.
- Stylelint reads `tokens.css` (the names `var()` may use) and `tokens.json` (the allowed breakpoint values) from this folder. A token that is new in `tokens.json` isn't usable in CSS until `pnpm tokens:build` has run.
- The artifact's own generated files (`project/api/tokens.md`, `project/tokens.css`) refresh only when its page saves, so they can lag behind its `tokens.json`. Always sync from `project/tokens.json`.
- The fonts cover Latin only. Text in other scripts falls back to the system font until the fuller subsets are added (spec 0002, Follow-up).

## Related specs

- [0002 Design tokens](../../docs/specs/0002-design-tokens/index.md)

_Drafted by /sync from the introducing change, worth a quick human pass._
