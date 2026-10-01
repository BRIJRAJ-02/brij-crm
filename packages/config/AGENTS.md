# packages/config

## Overview

Shared configuration for every workspace: the TypeScript configs, the one ESLint and Stylelint config (which enforce the house rules), and the house rule check script. Tagged `shared`.

## Key files

| File | Owns |
|---|---|
| `tsconfig.base.json` | Strict flags for all code: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| `tsconfig.node.json` | Node 24 code (`nodenext`) |
| `tsconfig.react.json` | Browser code (`bundler`, `react-jsx`, Vite types) |
| `eslint.js` | The ESLint presets (`server`, `client`, `screens`, `repoRoot`) and the house rules as lint rules |
| `stylelint.js` | Tokens only CSS, no `!important`, styles kept inside their component (loaded by the root `stylelint.config.js`) |
| `scripts/house-rules.ts` | `pnpm house-rules`: no CSS in `apps/web`, one owner per CSS module, a README beside every styled component |

## Conventions

- Each workspace extends `@crm/config/tsconfig.node.json` or `@crm/config/tsconfig.react.json`, and never loosens a base flag locally.
- A config change here affects every workspace, so run `pnpm typecheck` across the repo after one.
- Each workspace's `eslint.config.js` picks one preset and passes `import.meta.dirname`. `packages/db` alone passes `databaseDriver: true`.
- When a feature brings in a vendor SDK (Sentry, PostHog, Resend, the S3 client, Centrifugo's client), its one wrapper file switches off `@typescript-eslint/no-restricted-imports` for itself in that workspace's `eslint.config.js`, and nowhere else.
- The tests here (`pnpm --filter @crm/config test`) lock in every house rule. Change a rule and its test together.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
