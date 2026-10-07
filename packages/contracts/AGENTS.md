# packages/contracts

## Overview

The oRPC contract and the Zod schemas the web app, the API and the worker all share. Changing a shape here breaks the build everywhere it's used, rather than in production. Tagged `shared`, so both client and server code may import it.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The one `contract` object, with one namespace per feature, and every schema and type |
| `src/system.ts` | The pattern to copy: schemas, their types, and `systemContract` |
| `src/codes.ts` | `@crm/contracts/codes`: every stable error code as plain lists with no Zod, so the browser's data layer recognises a code without loading the schema library. `errors.ts` builds `ErrorCode` from it |
| `src/monitoring/` | `@crm/contracts/monitoring` (spec 0010): `scrub`, the one rule for what may leave for Sentry, run by every send hook of both SDKs. Plain TypeScript, no Zod, no vendor, so the browser's lazy Sentry chunk shares it |
| `src/values/` | `@crm/contracts/values`: the attribute value shapes, filters, sorts, options, hues, countries and currencies, as plain Zod with no oRPC and no I/O, so `packages/ui` can parse what its editors emit |

## Conventions

- One file per feature holds its schemas and a `<feature>Contract`, joined into `contract` in `src/index.ts`.
- Every procedure declares its output (`oc.output(...)`), and its input when it takes one.
- A schema and its type share a name. Timestamps are ISO 8601 UTC strings (`z.iso.datetime()`).
- No runtime dependencies beyond `@orpc/contract` and `zod`, and no imports from any other workspace.
- `src/values/` imports only Zod and its own files, never `@orpc/contract`: the component library loads it on the client.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
