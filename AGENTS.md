# CRM

A multi tenant CRM sold as SaaS, as flexible as Attio. The plan is in [docs/scope/index.md](docs/scope/index.md), and the stack decision is [spec 0001](docs/specs/0001-stack-architecture/index.md).

## Stack

- **Language / Runtime**: TypeScript 6 (strict) on Node 24 LTS. The API and worker run their `.ts` files directly on Node, with no build step.
- **Web**: React 19 single page app on Vite 8 and TanStack Router, hosted on Vercel, where Routing Middleware proxies `/api/*`, so the app and the API share one origin.
- **API**: one modular Hono + oRPC + Zod 4 service. Its `worker` entrypoint runs jobs (Graphile Worker) and the outbox relay.
- **Data**: Postgres 17 on Neon, Drizzle ORM with committed SQL migrations, and forced row level security per workspace. On the client, one data layer (TanStack DB behind `packages/data`).
- **Realtime**: Centrifugo, one node. Arriving with their features: Better Auth, Hocuspocus + Yjs, Sentry, PostHog, Resend, R2.
- **Hosts**: Vercel (web, project `brij-crm`), Railway (api, worker, centrifugo), Neon through Vercel (one database branch per preview), Cloudflare R2 later for files.
- **Package manager**: pnpm 10 workspaces with one version catalog, and Turborepo 2 for tasks.

## Build approach

**Tracer Bullet**: build one thin, real thread through every layer first, then thicken one strand at a time, always end to end.

## Commands

```bash
pnpm install
pnpm dev            # Docker services, then api, worker and web (needs Docker or OrbStack)
pnpm dev:apps       # api, worker and web only, against a Postgres you run yourself
pnpm build
pnpm typecheck
pnpm boundaries     # module edges: client code may never import server code
pnpm db:setup       # apply migrations, then create the app login role
pnpm db:generate    # SQL from the Drizzle schema; review it and commit it
pnpm check          # everything CI runs: typecheck, lint, format, CSS, boundaries, house rules
pnpm test           # every package's Vitest suite
pnpm lint           # ESLint in every workspace, plus the root files
pnpm format         # Prettier, writing fixes
pnpm lint:css       # Stylelint
pnpm house-rules    # CSS module ownership and component READMEs
```

Local ports: web 5173 (proxies `/api` to the api), api 3000, worker 3001, Postgres 5433, PgBouncer 6432, Centrifugo 8000 (clients) and 9000 (internal). One `.env` at the repo root, copied from `.env.example`.

## Specs

Each spec is a folder, `docs/specs/NNNN-title/`, with `index.md` (the decision), `rationale.md` and `verify.md`. The scope lives in `docs/scope/`.

## Rules

- **Functional first.** Plain functions, and factories that return objects (`createDatabase`, `createApp`, `createDataLayer`). Dependencies come in as arguments. No classes, and no mutable state at module level.
- **Pure core, I/O at the edges.** Services in `packages/core` get their dependencies passed in and never read env, HTTP or globals. Treat data as immutable: `const`, `readonly` types, return new objects, never mutate an argument.
- **Errors.** An expected failure is a typed value, or an error with a stable `code` and a plain `message` (the `{ code, message }` shape). Anything unexpected throws and reaches the one error handler. Prefer `undefined` to `null`, except where Postgres or a wire format needs `null`.
- **One schema, one name.** A Zod schema and its type share a name (`export const ApiEnv = z.object(…)`, then `export type ApiEnv = z.infer<typeof ApiEnv>`). Shared shapes live in `packages/contracts`.
- **Node runs the TypeScript.** Erasable syntax only (no `enum`, `namespace` or constructor parameter properties). Relative imports keep their `.ts` or `.tsx` extension, and type imports use `import type`.
- **Strict types.** No `any` and no non null `!`, both lint errors. Use `unknown` and narrow it, or parse with Zod.
- **Exports.** Named exports only, with a default export only where a tool requires one (config files, the Worker entry, `.railway/railway.ts`). Every export from `packages/*` gets a short doc comment saying what it's for and any rule it enforces.
- **Startup.** Every app validates its environment with Zod and refuses to boot if a variable is missing. New dependencies are pinned exactly in the `catalog:` of `pnpm-workspace.yaml`.
- **Accessibility.** Every screen meets WCAG AA: contrast, labels, focus order and full keyboard use. The formal audit is deferred, but the baseline isn't.
- **Commits** follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`), scoped by feature or workspace when that helps.

## House rules and reviewers

These override general habits. Load the skill before you touch its area, and run the reviewer before the change lands.

- [crm-design-system](.claude/skills/crm-design-system/): any UI at all. Reviewers: `design-system-guardian`, then `ux-interaction-reviewer` for screens and flows.
- [crm-frontend-state](.claude/skills/crm-frontend-state/): any client code that reads, writes or reacts to CRM data. Reviewer: `state-performance-reviewer`.
- [crm-data-model-access](.claude/skills/crm-data-model-access/): the data model, tenancy, permissions, and any query that reads records. Reviewer: `security-access-reviewer`.
- [crm-api-backend](.claude/skills/crm-api-backend/): anything that runs on the server. Reviewers: `security-access-reviewer`, plus `state-performance-reviewer` for queries and jobs.

The reviewer agents live in `.claude/agents/`.

## Tooling

`/audit` chose this, and `/develop tooling` installed it. The shared ESLint and Stylelint configs live in `packages/config`.

- **Lint**: ESLint (flat config) with type aware typescript-eslint rules. The house rules become lint rules: no raw `pg` pool outside `packages/db` (queries go through `withWorkspace()`), no network calls or API client in `apps/web` outside `packages/data`, no vendor SDK imports outside the one wrapper module for that vendor, and no inline styles with raw values.
- **Format**: Prettier, matching the scaffold (single quotes, semicolons, two space indent).
- **CSS**: Stylelint refuses raw colour, size, spacing, radius, shadow and motion values (tokens only), `!important`, and selectors that reach outside their component. A house rule check also fails on new CSS for an element the library already has.
- **Git hooks** (lefthook, `lefthook.yml`): each commit runs Prettier, ESLint and Stylelint on the staged files. Each push runs typecheck, boundaries, full lint and the house rule checks.
- **CI** (GitHub Actions, `ci.yml`): every push, on any branch, runs typecheck, lint, the format check, Stylelint, boundaries, the house rule checks and the tests. A red build blocks the merge. The preview and deploy workflows are already in `.github/workflows/`.
- **Tests**: Vitest for unit and integration tests (against a real Postgres, never a mocked database), and Playwright for key flows, including two browsers to prove live updates. Two guard tests always exist: every tenant table forces row level security and has a policy, and a cross workspace read returns nothing. Each package runs its own suite (`vitest run`), with tests beside the source as `*.test.ts`. Playwright arrives with the first flow test.

## Git

- integration: on
- branch prefix: feat/
- commit: per-milestone

## Agent skills

These skills apply across the repo. Skills for one area are listed in that area's `AGENTS.md`.

- [turborepo](.claude/skills/turborepo/): `vercel/turborepo`, tasks, caching, boundaries and filters (the installed docs win, see the block at the end)
- [pnpm](.claude/skills/pnpm/): `antfu/skills`, workspaces, the catalog, filters and overrides
- [zod](.claude/skills/zod/): `pproenca/dot-skills`, schemas, parsing and inferred types (contracts, env, forms)
- [vitest](.claude/skills/vitest/): `antfu/skills`, unit and integration tests
- [playwright-cli](.claude/skills/playwright-cli/): `microsoft/playwright-cli`, driving the real app and end to end tests
- [system-design](.claude/skills/system-design/): `anthropics/knowledge-work-plugins`, service boundaries and architecture calls
- [api-and-interface-design](.claude/skills/api-and-interface-design/): `addyosmani/agent-skills`, module edges and type contracts between packages
- [domain-modeling](.claude/skills/domain-modeling/): `mattpocock/skills`, the glossary and decision records
- [security-and-hardening](.claude/skills/security-and-hardening/): `addyosmani/agent-skills`, untrusted input, sessions, secrets, dependency audits
- [security-best-practices](.claude/skills/security-best-practices/): `openai/skills`, security reviews when one is asked for
- [use-railway](.claude/skills/use-railway/): `railwayapp/railway-skills`, services, environments, variables and deploys
- [cloudflare](.claude/skills/cloudflare/): `cloudflare/skills`, R2 file storage (from #32)
- [sentry-fix-issues](.claude/skills/sentry-fix-issues/): `getsentry/sentry-for-ai`, fixing production errors found in Sentry
- [write-first-design](.claude/skills/write-first-design/): `kemiljk/skills`, a short written brief before an uncertain build
- [prototype-to-production](.claude/skills/prototype-to-production/): `kemiljk/skills`, hardening failure states, security edges and upkeep
- [ai-output-judgement](.claude/skills/ai-output-judgement/): `kemiljk/skills`, critiquing generated UI, copy or code
- [user-research](.claude/skills/user-research/): `anthropics/knowledge-work-plugins`, interviews, usability tests and surveys

Declined: the community Centrifugo skill (low trust). The Hono skill (`yusukebe/hono-skill`) still has no valid `SKILL.md`, so retry it later.
MCP servers: neon (connected), sentry (connected), playwright (connected), github (recommended, add it once the repo exists).

## Context files

- [apps/web/AGENTS.md](apps/web/AGENTS.md): the single page app and the edge Worker in front of it
- [apps/api/AGENTS.md](apps/api/AGENTS.md): the API and worker processes, one image with two entrypoints
- [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md): the oRPC contract and Zod schemas shared by every app
- [packages/core/AGENTS.md](packages/core/AGENTS.md): domain services and (later) the access door, with no HTTP
- [packages/data/AGENTS.md](packages/data/AGENTS.md): the one client data layer every screen goes through
- [packages/db/AGENTS.md](packages/db/AGENTS.md): schema, migrations, roles, row level security and `withWorkspace()`
- [packages/config/AGENTS.md](packages/config/AGENTS.md): shared TypeScript config (lint config joins it)
- [infra/AGENTS.md](infra/AGENTS.md): Centrifugo and local Postgres setup

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
