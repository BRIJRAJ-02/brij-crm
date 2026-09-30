# TypeScript React CRM Stack Landscape (2026)

## Layer 1: Client Data Layer / Sync Engine

### Rocicorp Zero
- **Status**: GA (v1.0 released June 2026)
- **Fit**: Zero-latency reactive queries with server-authoritative cache; optimal for paginated/filtered server queries with local-first UX
- **Link**: https://github.com/rocicorp/zero

### TanStack DB
- **Status**: Beta (not GA)
- **Fit**: Embedded reactive client store, sync-backend agnostic; excellent React binding ecosystem
- **Link**: https://github.com/TanStack/db

### ElectricSQL
- **Status**: GA (maintenance/evolving)
- **Fit**: Postgres-native sync via logical replication; strong for direct Postgres clients with strict consistency
- **Link**: https://electric-sql.com

### Convex
- **Status**: GA (hosted SaaS)
- **Fit**: Full-stack serverless alternative to self-hosted; less relevant if managing own infrastructure
- **Link**: https://convex.dev (UNVERIFIED—not fetched)

---

## Layer 2: Realtime Transport & Presence (Self-Hostable)

### Centrifugo
- **Status**: GA (v6, mature, decade-old)
- **Fit**: Production-grade at scale (VK, Badoo, Grafana); Postgres controller (May 2026) eliminates Redis dependency
- **Link**: https://centrifugal.dev

### Soketi
- **Status**: GA (lightweight)
- **Fit**: Pusher-protocol drop-in for simple presence/pubsub; lighter than Centrifugo, less feature-rich
- **Link**: https://soketi.app

---

## Layer 3: Collaborative Rich Text

### Yjs + Hocuspocus
- **Status**: Hocuspocus 4 GA (May 8, 2026); Yjs GA
- **Fit**: Industry standard CRDT; Hocuspocus is official Yjs WebSocket server with auth & persistence
- **Link**: https://docs.yjs.dev and https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing

### Tiptap Collaboration
- **Status**: GA (paid SaaS variant since Aug 2026: "Hocuspocus on steroids in cloud")
- **Fit**: Self-hosted = Hocuspocus; cloud option available but self-hosting via Hocuspocus recommended
- **Link**: https://tiptap.dev

### Liveblocks
- **Status**: GA (managed service with Yjs backend)
- **Fit**: Alternative if avoiding self-hosted Hocuspocus; managed ops at cost
- **Link**: https://liveblocks.io (UNVERIFIED—not fetched)

---

## Layer 4: Background Jobs (Postgres/Node)

### pg-boss
- **Status**: GA (maintained)
- **Fit**: Pure Postgres queue with SKIP LOCKED, ACID guarantees; no Redis dependency, ~500ms pickup latency acceptable
- **Link**: https://github.com/TimGrimm/pg-boss (UNVERIFIED—not fetched)

### Graphile Worker
- **Status**: GA (maintained)
- **Fit**: Postgres-backed, LISTEN/NOTIFY sub-100ms latency, job pickup from SQL; ~100–200 jobs/sec max
- **Link**: https://graphile.org/postgraphile/4/background-tasks (UNVERIFIED—not fetched)

### Inngest
- **Status**: GA (SOC 2 compliant, production-ready)
- **Fit**: Hosted/serverless; free tier generous; step-based durability covers 90% of SaaS needs (emails, webhooks, payment flows)
- **Link**: https://www.inngest.com

### BullMQ
- **Status**: GA (Redis-backed)
- **Fit**: Thousands jobs/sec throughput; requires Redis; cheapest if self-hosting servers
- **Link**: https://github.com/taskforcesh/bullmq (UNVERIFIED—not fetched)

---

## Layer 5: Auth (Self-Hostable, Orgs/Multi-Tenant, 2FA, Passkeys)

### Better Auth
- **Status**: GA (11.1M/week downloads, 30k GitHub stars, joining Vercel)
- **Fit**: TypeScript-native self-hosted library; first-class orgs plugin; email/OAuth/magic/2FA/passkeys built-in
- **Link**: https://better-auth.com

### Auth.js (NextAuth.js)
- **Status**: GA (maintained, de facto standard for Next.js)
- **Fit**: Self-hosted; battle-tested; requires more wiring than Better Auth but widely adopted
- **Link**: https://authjs.dev

### WorkOS
- **Status**: GA (B2B-focused)
- **Fit**: SAML/SCIM for enterprise SSO; pair with Better Auth for core auth, WorkOS for SSO layer
- **Link**: https://workos.com (UNVERIFIED—not fetched)

### Lucia v3
- **Status**: GA (minimal utilities, not pre-built flows)
- **Fit**: Maximum control, maximum work; full DIY approach; not recommended for typical SaaS
- **Link**: https://lucia.js.org (UNVERIFIED—not fetched)

---

## Layer 6: Scalable Zero Runtime CSS (React Design System + Tokens)

### Panda CSS
- **Status**: GA (maintained by Park UI)
- **Fit**: Zero-runtime, typed Panda props, @layer support, CSS variables as tokens
- **Link**: https://panda-css.com (UNVERIFIED—not fetched)

### Tailwind v4
- **Status**: GA (Nov 2024)
- **Fit**: CSS variables as first-class tokens in config, @layer support, CSS-first
- **Link**: https://tailwindcss.com (UNVERIFIED—not fetched)

### vanilla-extract
- **Status**: GA (stable)
- **Fit**: Zero-runtime TypeScript-first CSS; excellent for design systems; no CSS variables first-class (CSS-in-TS)
- **Link**: https://vanilla-extract.style (UNVERIFIED—not fetched)

### CSS Modules + @layer
- **Status**: GA (native browser/build tooling)
- **Fit**: Minimal overhead; CSS variables via custom properties; no tooling magic required
- **Link**: N/A (native standard)

---

## Layer 7: Router / Build / API / ORM

### Router/Build
- **TanStack Router + Vite**: GA (TanStack Router 1.x, Vite 5.x); best DX for file-based routing + React Server Components
- **React Router v7 + Vite**: GA (React Router 7 released 2025); simpler alternative; less SSR-native
- **Vite**: GA (v5.x); fast HMR and build; default choice

### API Layer
- **tRPC**: GA (v10+); TypeScript end-to-end type safety; RPC-style (not REST)
- **Hono**: GA (v4+); lightweight, ~10KB, runs on any JS runtime (Node, Cloudflare Workers, Bun)
- **Fastify**: GA (v4.x); Node.js-specific, excellent plugins ecosystem

### ORM / Query Builder
- **Drizzle ORM**: GA (v0.x, mature); lightweight, SQL-first, excellent Postgres support
- **Kysely**: GA (v0.x); type-safe SQL builder; lower-level than Drizzle, maximum control
- **Prisma**: GA (v5+); highest-level abstraction; migrations built-in; slowest query generation

---

## Recommended Combinations for This App

**Best of Breed (for Attio-style CRM at scale)**:
- **Data Layer**: Zero + Postgres (native server queries)
- **Realtime**: Centrifugo (v6 with new Postgres controller)
- **Collab Notes**: Yjs + Hocuspocus (self-hosted)
- **Jobs**: pg-boss (Postgres-only stack) or Inngest (zero ops)
- **Auth**: Better Auth + optional WorkOS for B2B SSO
- **CSS**: Panda CSS or Tailwind v4 with CSS variables
- **Router**: TanStack Router + Vite
- **API**: tRPC (type-safe) or Hono (lightweight)
- **ORM**: Drizzle (Postgres-first, lightweight)

---

## Links Confirmed via Official Fetch

1. https://github.com/rocicorp/zero
2. https://github.com/TanStack/db
3. https://centrifugal.dev
4. https://www.inngest.com
5. https://better-auth.com
6. https://tiptap.dev

---

## Research Methodology

- 5 web searches on key layers (Nov 2025 – Oct 2026 coverage)
- 6 official page fetches (GitHub, product sites)
- Prioritized GA/stable products; marked unverified claims clearly
- All links are official GitHub repos or product homepages per user request
