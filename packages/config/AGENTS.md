# packages/config

## Overview

Shared configuration for every workspace. Today it holds the TypeScript configs. The ESLint, Prettier, Stylelint and test configs join it with Coding standards & tooling (#2). Tagged `shared`.

## Key files

| File | Owns |
|---|---|
| `tsconfig.base.json` | Strict flags for all code: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| `tsconfig.node.json` | Node 24 code (`nodenext`) |
| `tsconfig.react.json` | Browser code (`bundler`, `react-jsx`, Vite types) |

## Conventions

- Each workspace extends `@crm/config/tsconfig.node.json` or `@crm/config/tsconfig.react.json`, and never loosens a base flag locally.
- A config change here affects every workspace, so run `pnpm typecheck` across the repo after one.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
