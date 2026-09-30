# 0001. Stack and architecture: rationale

## Context

The product is an Attio style CRM sold as SaaS to many companies (`docs/scope/index.md`). Each workspace shapes its own objects, attributes and relationships, so the schema is data, not code. The targets:

- 100 people online at once, with room to grow to 1,000 without a redesign.
- Up to a million records per workspace, with filtering and sorting on any attribute, including custom ones.

The builder is one person working with Claude, with no deadline but a strong wish for production quality.

The product's defining forces are collaborative and live:
- Every change shows on every open screen within a second.
- People see who else is on a record, and shared notes take several people typing at once.
- Access control works at every level from day one: roles, objects, fields and records. So anything that ships data to the browser, or broadcasts it, has to respect those rules.
- The user has made state management the top priority. One client copy of each record, optimistic edits, live patches, no screen fetching on its own.

The design system already exists as React components with `ws-` class names and a token set, in a live artifact that keeps updating. The house rules demand tokens only, strict componentisation, and CSS that scales (scoped styles, cascade layers, variables, no runtime cost). Lucide is the only icon library.

Operationally, the user wants managed services for speed, but through open standards, so the product can move to its own cloud later without a rewrite. There's no marketing site and no SEO need; the whole app sits behind login.

Not deciding leaves every foundation spec (data model, client state, realtime, jobs, access) without a platform to design against, and the walking skeleton can't start.

## Options considered

### Option 1: TypeScript single page app, modular API, TanStack DB, Centrifugo, Hocuspocus, Graphile Worker, on Postgres

- **Front end:** a Vite + TanStack Router single page app. The client data layer is TanStack DB behind our own interface, fed by server run queries and patched by change events.
- **Back end:** a Hono + oRPC modular API, with Drizzle over Postgres (row level security for tenancy) and Better Auth.
- **Realtime and notes:** Centrifugo for realtime and presence, and Yjs + Hocuspocus for shared notes.
- **Jobs:** Graphile Worker on Postgres.
- **Hosting:** Neon, Railway and Cloudflare.

**Pros:**
- The server runs every view query, so dynamic custom attributes, a million records, and field and record level rules are handled where the data and the access door live.
- The client still gets one normalised, live, optimistic copy of each record.
- Each hard problem (client state, fan out and presence, collaborative text, jobs) uses a tool built for it, and every tool is open source or standard (Postgres, S3, containers). That keeps it portable.
- Postgres is the only stateful service to run, back up and restore.

**Cons:**
- Several services to operate: web, api, worker and Centrifugo at first, with collab added in Slice 7.
- TanStack DB was beta at last check, so we own a wrapper around it.
- The live patching glue (events to refetch to patch) is our code to build and test.
- oRPC is young.

### Option 2: A sync engine stack with Zero at the centre

- **Stack:** Vite + React with Rocicorp Zero (GA 1.0 in June 2026) as the client data layer and realtime transport, over Postgres, with Better Auth for identity. A small API handles the writes Zero can't express, and Hocuspocus handles notes.

**Pros:**
- The least client state code: queries run instantly against a synced cache, and live updates and optimistic writes come built in.
- Very fast perceived performance.

**Cons:**
- Its queries are defined against a static schema. Custom objects with sort and filter on attribute values across a million records, and field level hiding, push against the model.
- Its server keeps a replica of the synced tables, which is another stateful service to size.
- Newer at production scale than the pieces in Option 1.
- If it can't express a CRM query, there is no easy escape hatch inside the same layer.

### Option 3: One all in one backend platform

- **Stack:** a backend as a service (managed Postgres or a reactive database, with auth, realtime, storage and functions in one), plus a React single page app.

**Pros:**
- The fastest start: sign in, realtime and storage work on day one, with the fewest services to run.

**Cons:**
- The most lock in.
- Its realtime broadcasts row changes, which fights field level and record level rules.
- Presence and collaborative text still need extra tools.
- Heavy dynamic attribute queries at a million records strain its query model.
- Moving off later is a rewrite of auth, realtime and storage at once.

### Option 4: A server rendered full stack framework

- **Stack:** a server rendering React framework on a serverless host, TanStack Query on the client, a managed realtime service for pushes, and a hosted durable jobs service.

**Pros:**
- A familiar, well documented path with great deploy previews.
- Fewer long running services of our own.

**Cons:**
- Server rendering buys nothing behind a login, and fights a heavy client data layer.
- Serverless functions can't hold WebSocket connections or LISTEN.
- Realtime and jobs become per message and per step vendor costs.
- Two rendering models make "one copy of each record" harder to keep true.

## Rationale

The forces that decide this are the dynamic schema with fine grained access, and the demand for one live client copy of every record.

Option 2 and Option 3 put the query engine or the broadcast on the client side of the access line. That's elegant for fixed tables. But this product's tables are defined by customers, and its rules hide fields and records per role, so the safe place to run a view query is the server, next to the access door. Option 1 keeps the server authoritative (it runs the query, applies access, and returns a window of rows). It still gives the client what the user asked for: TanStack DB holds one normalised copy, applies edits optimistically, and receives patches when change events arrive. The sync engine route would save client code but would put the hardest requirement (access on custom attributes at a million records) where it's hardest to meet.

Option 4 is ruled out by the realtime and presence forces. Long lived connections, LISTEN and collaborative editing need processes that stay up, and server rendering adds nothing to an app behind login.

Within Option 1, each layer is the boring, proven pick for its job:
- Postgres for relations, JSON, row level security, search and jobs, so only one stateful service needs operating.
- Centrifugo, rather than our own WebSocket server, because presence, history and recovery on reconnect are exactly what it has solved for years.
- Yjs + Hocuspocus, because collaborative text is a solved problem that we shouldn't reinvent.
- Graphile Worker, because a job queued in the same transaction as its write can't be lost.

The cost is several services and some glue code. The scaffold starts with only web, api (plus its worker entrypoint) and Centrifugo. Railway's multi service model and the monorepo keep that manageable for one person, and the load harness (#12) keeps it honest.

Styling follows the same logic. CSS Modules with variables and layers are native, zero runtime, scoped, and closest to the design system's existing CSS. Stylelint and typed variant props enforce the house rules that a typed styling system would enforce by construction.

## References

**Project sources:**
- `docs/scope/index.md` and `docs/scope/foundations.md`: the house rules, targets, and features #1 to #9.
- The design system artifact (https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh?sk=NUiJdAv_8B9f6a2uJRrpBg): React components, `ws-` classes, tokens and Lucide.
- `.claude/skills/crm-frontend-state/`, `.claude/skills/crm-data-model-access/`, `.claude/skills/crm-api-backend/`: the house rule skills.
- `docs/research/crm-attributes.md`: attribute types and value history, as in Attio.
- `docs/.agent-cache/research/stack-landscape.md`: the landscape check from 2026-10-01.

**Practices & standards:**
- A monolith first, splitting processes only where the runtime demands it (long lived connections, jobs).
- A relational database as the default store, with row level security for tenant isolation designed on day one.
- The transactional outbox, where change events are written in the same transaction as the change.
- A server authoritative data model with optimistic client updates.
- CRDTs for collaborative text.

**Links** (confirmed by the landscape check):
- Rocicorp Zero: https://github.com/rocicorp/zero
- TanStack DB: https://github.com/TanStack/db
- Centrifugo: https://centrifugal.dev
- Better Auth: https://better-auth.com
- Tiptap and Hocuspocus: https://tiptap.dev
- Inngest, considered for jobs: https://www.inngest.com
