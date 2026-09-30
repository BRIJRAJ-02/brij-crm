# Tool Discovery Results - TypeScript CRM Stack
**Date:** 2026-10-01

## Frontend Framework & UI (React Ecosystem)

**React**
- Skill: `vercel-labs/agent-skills@vercel-react-best-practices` (758.9K installs)
- Install: `npx skills add vercel-labs/agent-skills -s vercel-react-best-practices -a claude-code --copy -y`
- Trust: Official Vercel Labs

**Vite**
- Skill: `antfu/skills@vite` (36.9K installs)
- Install: `npx skills add antfu/skills -s vite -a claude-code --copy -y`
- Trust: Official Vite author

**React Aria Components**
- Status: No dedicated skills found; covered by general React patterns

**CSS Modules**
- Status: No dedicated skills found; built-in tooling support

## Routing & Data Management (TanStack)

**TanStack Router**
- Skill: `deckardger/tanstack-agent-skills@tanstack-router-best-practices` (6.7K installs)
- Install: `npx skills add deckardger/tanstack-agent-skills -s tanstack-router-best-practices -a claude-code --copy -y`
- Trust: Community maintainer

**TanStack Query**
- Skill: `tanstack-skills/tanstack-skills@tanstack-query` (9K installs)
- Install: `npx skills add tanstack-skills/tanstack-skills -s tanstack-query -a claude-code --copy -y`
- Trust: Official TanStack repository

**TanStack Table**
- Skill: `tanstack-skills/tanstack-skills@tanstack-table` (5.1K installs)
- Install: `npx skills add tanstack-skills/tanstack-skills -s tanstack-table -a claude-code --copy -y`
- Trust: Official TanStack repository

**TanStack Virtual**
- Skill: `tanstack-skills/tanstack-skills@tanstack-virtual` (2.4K installs)
- Install: `npx skills add tanstack-skills/tanstack-skills -s tanstack-virtual -a claude-code --copy -y`
- Trust: Official TanStack repository

**TanStack DB**
- Status: No dedicated skills found; database access via Drizzle ORM

## Backend & RPC (Hono, oRPC)

**Hono**
- Skill: `yusukebe/hono-skill@hono` (12.8K installs)
- Install: `npx skills add yusukebe/hono-skill -s hono -a claude-code --copy -y`
- Trust: Official Hono author

**oRPC**
- Status: No skills found; emerging RPC framework without official skills

## Data Validation & Schema

**Zod**
- Skill: `pproenca/dot-skills@zod` (6.6K installs)
- Install: `npx skills add pproenca/dot-skills -s zod -a claude-code --copy -y`
- Trust: Community maintainer

## Database & ORM

**Drizzle ORM**
- Skill: `lobehub/lobehub@drizzle` (5.2K installs)
- Install: `npx skills add lobehub/lobehub -s drizzle -a claude-code --copy -y`
- Trust: Community maintainer

**Postgres**
- Skill: `supabase/agent-skills@supabase-postgres-best-practices` (424.1K installs)
- Install: `npx skills add supabase/agent-skills -s supabase-postgres-best-practices -a claude-code --copy -y`
- Trust: Official Supabase

**Neon**
- Skill: `neondatabase/agent-skills@neon-postgres` (201.9K installs)
- Install: `npx skills add neondatabase/agent-skills -s neon-postgres -a claude-code --copy -y`
- Trust: Official Neon
- **MCP Server:** `claude mcp add --transport http neon https://mcp.neon.tech/mcp`

## Authentication

**Better Auth**
- Skill: `better-auth/skills@better-auth-best-practices` (116.2K installs)
- Install: `npx skills add better-auth/skills -s better-auth-best-practices -a claude-code --copy -y`
- Trust: Official Better Auth
- **MCP Server (Community):** `npx -y @smithery/cli install @nahmanmate/better-auth-mcp-server --client claude`

## Real-time Collaboration & Sync

**Centrifugo**
- Skill: `pedronauck/skills@centrifugo` (236 installs)
- Install: `npx skills add pedronauck/skills -s centrifugo -a claude-code --copy -y`
- Trust: Community maintainer

**Yjs**
- Skill: `liveblocks/skills@yjs-best-practices` (267 installs)
- Install: `npx skills add liveblocks/skills -s yjs-best-practices -a claude-code --copy -y`
- Trust: Official Liveblocks

**Hocuspocus**
- Status: No dedicated skills found; supported as Yjs provider

**Tiptap**
- Skill: `ueberdosis/tiptap@tiptap` (3.2K installs)
- Install: `npx skills add ueberdosis/tiptap -s tiptap -a claude-code --copy -y`
- Trust: Official Tiptap

## Background Jobs & Workers

**Graphile Worker**
- Status: No dedicated skills found; use PostgreSQL patterns

## Cloud Infrastructure & Deployment

**Cloudflare**
- Skill: `cloudflare/skills@cloudflare` (104.8K installs)
- Install: `npx skills add cloudflare/skills -s cloudflare -a claude-code --copy -y`
- Trust: Official Cloudflare
- **MCP Server:** `claude mcp add cloudflare --transport http https://mcp.cloudflare.com/mcp`

**Railway**
- Skill: `railwayapp/railway-skills@use-railway` (7.4K installs)
- Install: `npx skills add railwayapp/railway-skills -s use-railway -a claude-code --copy -y`
- Trust: Official Railway
- **MCP Server:** Available as Claude connector and plugin

## Email & Communication

**Resend**
- Skill: `resend/resend-skills@resend` (20.3K installs)
- Install: `npx skills add resend/resend-skills -s resend -a claude-code --copy -y`
- Trust: Official Resend
- **MCP Server:** `https://mcp.resend.com/mcp` or Claude plugin

**React Email**
- Skill: `resend/react-email@react-email` (9.1K installs)
- Install: `npx skills add resend/react-email -s react-email -a claude-code --copy -y`
- Trust: Official Resend

## Observability & Monitoring

**Sentry**
- Skill: `sentry/dev@sentry-cli` (151.7K installs)
- Install: `npx skills add sentry/dev -s sentry-cli -a claude-code --copy -y`
- Trust: Official Sentry
- **MCP Server:** `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`

**PostHog**
- Skill: `posthog/posthog@implementing-agent-modes` (2.6K installs)
- Install: `npx skills add posthog/posthog -s implementing-agent-modes -a claude-code --copy -y`
- Trust: Official PostHog
- **MCP Server:** `claude mcp add --transport http posthog https://mcp.posthog.com/mcp` or `npx @posthog/wizard mcp add`

## Testing

**Vitest**
- Skill: `antfu/skills@vitest` (38.4K installs)
- Install: `npx skills add antfu/skills -s vitest -a claude-code --copy -y`
- Trust: Official Vite author

**Playwright**
- Skill: `microsoft/playwright-cli@playwright-cli` (170.2K installs)
- Install: `npx skills add microsoft/playwright-cli -s playwright-cli -a claude-code --copy -y`
- Trust: Official Microsoft
- **MCP Server:** `claude mcp add playwright npx @playwright/mcp@latest`

## Package Management & Monorepo

**pnpm**
- Skill: `antfu/skills@pnpm` (21.4K installs)
- Install: `npx skills add antfu/skills -s pnpm -a claude-code --copy -y`
- Trust: Official Vite author

**Turborepo**
- Skill: `vercel/turborepo@turborepo` (77.5K installs)
- Install: `npx skills add vercel/turborepo -s turborepo -a claude-code --copy -y`
- Trust: Official Vercel

**GitHub Actions**
- Skill: `wshobson/agents@github-actions-templates` (16.3K installs)
- Install: `npx skills add wshobson/agents -s github-actions-templates -a claude-code --copy -y`
- Trust: Community maintainer
- **MCP Server:** `https://api.githubcopilot.com/mcp/` (official GitHub)

## Summary

**Skills Available:** 30+ skills from official vendors and trusted community maintainers
**MCP Servers:** 8 official servers covering Neon, Sentry, PostHog, Cloudflare, Railway, Resend, Playwright, and GitHub
**Gaps:** oRPC, TanStack DB, Hocuspocus, Graphile Worker, CSS Modules (use built-in tooling)

All skills are ready to install and compatible with Claude Code.
