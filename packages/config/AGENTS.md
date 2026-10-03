# packages/config

## Overview

Shared configuration for every workspace: the TypeScript configs, the one ESLint and Stylelint config (which enforce the house rules), and the house rule check script. Tagged `shared`.

## Key files

| File | Owns |
|---|---|
| `tsconfig.base.json` | Strict flags for all code: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| `tsconfig.node.json` | Node 24 code (`nodenext`) |
| `tsconfig.react.json` | Browser code (`bundler`, `react-jsx`, Vite types) |
| `eslint.js` | The ESLint presets (`server`, `client`, `screens`, `repoRoot`) and the house rules as lint rules, including: React Aria, Tiptap and other UI building blocks only in `packages/ui`, Yjs only there and in `packages/data`, no value atom imports in screens, no literal copy in the library's markup, and no network calls from the library |
| `stylelint.js` | Tokens only CSS, no `!important`, styles kept inside their component, and only token names that exist in `packages/tokens/tokens.css` (loaded by the root `stylelint.config.js`) |
| `stylelint/system-colors.js` | The `crm/system-colors` rule: system colours (`Canvas`, `CanvasText` and the rest) only inside `@media (forced-colors: active)` |
| `stylelint/breakpoint-tokens.js` | The `crm/breakpoint-tokens` rule: `@media` and `@container` conditions may only use the `breakpoint` token values from `packages/tokens/tokens.json` |
| `scripts/house-rules.ts` | `pnpm house-rules`: no CSS in `apps/web`, one owner per CSS module, a README and stories beside every component, and unique CSS module names and story titles in `packages/ui` |

## Conventions

- Each workspace extends `@crm/config/tsconfig.node.json` or `@crm/config/tsconfig.react.json`, and never loosens a base flag locally.
- A config change here affects every workspace, so run `pnpm typecheck` across the repo after one.
- Each workspace's `eslint.config.js` picks one preset and passes `import.meta.dirname`. `packages/db` alone passes `databaseDriver: true`. `packages/ui` passes `client({ library: true })`, and `packages/data` passes `client({ collaboration: true })` for Yjs.
- When a feature brings in a vendor SDK (Sentry, PostHog, Resend, the S3 client, Centrifugo's client, Better Auth and its browser client), its one wrapper file switches off `@typescript-eslint/no-restricted-imports` for itself in that workspace's `eslint.config.js`, and nowhere else. Lucide already works this way: `packages/ui/src/atoms/Icon/icons.ts` is its one wrapper. In client code, `client({ vendorWrappers: [{ files, allow }] })` lets a wrapper folder import only the named entries instead (`packages/data/src/auth/` imports `better-auth/client`, while `better-auth` itself stays refused there).
- Screens may throw the router's `redirect()` (`only-throw-error` allows TanStack's `Redirect`); any other non error throw is refused.
- The Stylelint rules read `packages/tokens/tokens.css` and `tokens.json` by a path resolved from this folder, never the working folder. A new token reaches lint only after `pnpm tokens:build`.
- The tests here (`pnpm --filter @crm/config test`) lock in every house rule. Change a rule and its test together.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
