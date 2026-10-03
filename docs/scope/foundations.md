# Foundations

The ground every slice stands on. All ten are decided before Slice 1 starts. See [index.md](index.md) for the house rules and the full order.

### 1. Stack & architecture · done
Decide the language, framework, database, hosting and sign in approach, then scaffold a runnable project so every slice builds on real structure.
**Done when:** the stack is recorded in a spec; the empty app boots locally, builds, and deploys to a preview and a production environment, each with its own database; the code is split into modules with clear edges (data engine, client data layer, access, realtime, jobs, the component library, and one module per feature), and screens get their UI only from the component library.
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
   - [x] Boots locally end to end: typecheck, build, module edges, migrations, the status page, and the web app served through the edge (DW-2, DW-4)
   - [x] Local services and images: Docker Compose with the connection pooler, and both service images build (DW-2, DW-3)
   - [x] Deploys to a preview and to production, each with its own database (DW-3)
Spec [0001](../specs/0001-stack-architecture/index.md) · code in `apps/`, `packages/`, `infra/`

### 2. Coding standards & tooling · done
Capture conventions from the real scaffold, including the house rules, then install linting, formatting, type checks, pre commit hooks, and CI that blocks a red build.
**Done when:** root `AGENTS.md` reflects the real stack and the house rules, and points every session to the house rule skills (`crm-design-system`, `crm-frontend-state`, `crm-data-model-access`, `crm-api-backend`) and the four reviewer agents in `.claude/`; lint, format, typecheck and CI run clean on every push; a check fails the build on any raw colour, size or spacing value in app code, on new styles for an element the library already has, and on a screen that fetches data outside the client data layer.
- [x] Capture conventions + tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test`
code in `packages/config/`, `lefthook.yml`, `.github/workflows/ci.yml`

### 3. Design tokens · done
Every visual value as a named token from the very first screen: colour (light and dark), type scale, spacing, radius, borders, shadow, motion, layers and breakpoints. The tokens come from the design system artifact. Nothing is carried over from Timefix.
**Done when:** the full token set is in the design system and loaded by the app as CSS variables; the first scaffolded screen uses only tokens; light and dark switch with no change to any screen; the styling approach scales (component scoped styles, fixed cascade layers, variants declared once, container queries, no runtime cost, no `!important`); icons come only from Lucide through the Icon atom.
- [x] Design it (spec): `/architect design tokens`
- [x] Build it: `/develop design tokens`
   - [x] Tokens flow from the artifact into the app: the generator, the committed CSS and its staleness check, the root stylesheet, and the status page on tokens following the OS (AC-1, AC-2, AC-3, AC-5, AC-6, AC-8)
   - [x] The artifact gains the missing families and the contrast fixes, published on your OK, synced back with the contrast test green (AC-1, AC-4)
   - [x] A saved theme choice: applied before first paint, kept across reloads, followed in other tabs (AC-7)
   - [x] The Icon atom and the lint guards: Lucide only through the registry, no raw opacity, scale or layer values, breakpoints from tokens, and no unknown tokens (AC-9, AC-10, AC-12)
   - [x] The production build checked in a browser under the CSP (AC-11)
- [x] Verify it: `/check verify design tokens`
- [x] Test it: `/test design tokens`
Spec [0002](../specs/0002-design-tokens/index.md) · code in `packages/tokens/`, `packages/ui/`, `apps/web/public/theme-boot.js`

### 4. Component library · in-progress · GA
A large design system built up front for the whole plan, not piece by piece: atoms (button, input, checkbox, avatar, badge, icon, tooltip), molecules (one field editor and display per attribute type, menu, select, date picker, filter row) and modules (app shell and navigation, data grid, board, record panel, timeline, filter and sort builder, command palette, dialogs, presence bar, notification inbox, comment thread, import mapper, charts, schema map canvas).
**Done when:** every component the 56 features need is in the library with its states (empty, loading, error, read only, disabled) and a preview; each attribute type has exactly one field design, used everywhere; every atom works by keyboard, shows a visible focus ring and meets contrast in light and dark; a grid of 100,000 rows scrolls smoothly; every component records why it exists, and variants are added to existing components rather than new CSS written for the same element.
- [x] Design it (spec): `/architect component library`
- [ ] Build it: `/develop component library`
   - [x] One component through the whole pipeline: Storybook, tests in three browsers, screenshots, the artifact publish with React 19, lint guards and the size budget (AC-1, AC-2, AC-6, AC-10 to AC-13, AC-15 to AC-19)
   - [x] Atoms, overlays, the value schemas in contracts, the field set, molecules, and the status screen on the library (AC-1 to AC-6, AC-10, AC-11, AC-13, AC-14, AC-22)
   - [x] The new size and success tokens, the data grid at 100,000 rows, the app shell and view modules, and the board (AC-4, AC-6 to AC-9, AC-11, AC-21)
   - [ ] Rich text, collaboration, mail, data in and out, settings, auth and builder modules (AC-1, AC-2, AC-14). Deferred until after #10 (the core loop), as agreed on 2026-10-02: build it then, so a working CRM comes first.
   - [ ] Charts, the dashboard, the schema map, and the full publish with design and interaction reviews (AC-1, AC-17, AC-18, AC-20, AC-21). Deferred until after #10 too.
- [ ] Verify it: `/check verify component library`
- [ ] Test it: `/test component library`
- [ ] Review it (fresh model): `/check review component library`
- [ ] Document it: `/document component library`
Spec [0003](../specs/0003-component-library/index.md) · code in `packages/ui/`

### 5. Data model · in-progress · GA
The engine every feature stands on, modelled on how Attio works (not on Timefix): objects, both standard and custom; records; typed attributes, some of which hold many values (several emails, phones or domains); two way relationship attributes; lists whose entries carry their own attributes; status attributes with stages; and the full history of every value. Workspaces, members and teams sit around it, and notes, tasks, comments and files attach to any record. The attribute research in `docs/research/crm-attributes.md` feeds this spec.
**Done when:** People, Companies and Deals run on the same engine as custom objects, just as in Attio; renaming a select option never rewrites records; a relationship is one definition that gives each of the two objects its own paired attribute, and each link is stored once and read from both ends; every value change is kept with who and when, so a value as of any date and time in stage can be answered; every row records its workspace, author and time, and deletes are soft with a restore window; no query can return another workspace's rows, even one that forgets to filter; filtering and sorting on any attribute stays inside the scale budget at a million records.
- [x] Design it (spec): `/architect data model`
- [ ] Build it: `/develop data model`
   - [x] One value through every layer: the first tables with forced row level security and composite keys, the write protocol and hooks, a text attribute end to end, and the query compiler's first slice (AC-1, AC-3, AC-7, AC-9, AC-13, AC-14, AC-17, AC-19)
   - [x] Every type and the rules: options, every type's columns, defaults, required, unique, limits, versions and history reads, and the standard template (AC-1 to AC-4, AC-10 to AC-13, AC-16)
   - [x] Relationships, lists and deletion: links with cardinality on both sides, lists and entries, delete, restore, purge and erasure (AC-3, AC-5, AC-6, AC-8, AC-18)
   - [x] The whole query engine at scale: every operator and sort, filters through relationships, counts, and the million record benchmark grid against the split table variant (AC-6, AC-14, AC-15)
   - [x] One stored sort key through every layer: the `sort_keys` table, text keys written in every save and delete, and exact text jumps and cursors measured at scale ([0004-stored-sort-keys](../specs/0004-data-model/0004-stored-sort-keys.md); AC-20, AC-21, AC-22)
   - [x] Every key kind: number, currency, date, time, option and checkbox keys, stored key filters, big first groups, list views by record attributes, the empties, and capped counts (AC-20 to AC-23)
   - [ ] Fast contains and the proof: the workspace scoped search function (or the narrowed fallback), the extended grid, and the run on a paid Neon branch (AC-22, AC-24, AC-25, AC-26)
- [ ] Verify it: `/check verify data model`
- [ ] Test it: `/test data model`
- [ ] Review it (fresh model): `/check review data model`
- [ ] Document it: `/document data model`
Spec [0004](../specs/0004-data-model/index.md) · code in `packages/db/`, `packages/core/`, `packages/contracts/`

### 6. Client data and state · needs a decision · GA
The backbone of the app and the top priority: one client data layer that holds every record a screen shows in one place, so a record shown in a table, a board, a record page and a search result is a single copy that updates everywhere at once.
**Done when:** no screen fetches or stores records on its own; an edit appears instantly everywhere that record is shown, and rolls back with a message if the server refuses it; incoming changes patch every open view in place, with no reload; two people saving the same field get one clear winner (the last save) and the other sees a notice; the last change can be undone; memory stays flat while you scroll an object with a million records.
- [ ] Design it (spec): `/architect client data and state`

### 7. Change events and realtime · needs a decision
Every write produces one change event that names the records it touched. Those events reach every open screen allowed to see them, feed the client data layer, and later feed search, notifications, webhooks, automations and sync.
**Done when:** a change shows on every permitted open screen within one second (p95) with 100 people online; a screen that drops its connection catches up on reconnect with no gap and no refresh; an event never carries data the viewer may not see.
- [ ] Design it (spec): `/architect change events and realtime`

### 8. Background jobs · needs a decision
A dependable way to run long work (imports, exports, recomputing, indexing, notifications, webhooks, sync) outside the request, so screens stay fast.
**Done when:** a job survives a restart, retries on failure, reports progress and can be cancelled; one workspace's huge import never slows another workspace's work.
- [ ] Design it (spec): `/architect background jobs`

### 9. Access model · needs a decision · GA
One permission model for the whole product: workspace roles as flat lists of permissions, teams, and rules per object, per field and per record, all checked at one door that every read and write passes through.
**Done when:** screens, live events, search, notifications, export and the API all get their data through the same check; an unknown role or a missing rule means no access; an API key is an actor with its own scoped permissions; the last owner can never be removed.
- [ ] Design it (spec): `/architect access model`

### 57. Edge only API access · needs a decision · GA
The API should accept traffic only through the edge in front of the web app, so the forwarded details it reads (like the client IP) can be trusted. Today its host address is public, so anyone can call it directly and fake those headers. This came up during the scaffold build.
**Done when:** a request sent straight to the API's host address is refused in preview and production; the client IP and other forwarded details the API reads can only come from the edge; a missing or wrong edge credential means refused, never allowed; local development still works without the edge.
- [ ] Design it (spec): `/architect edge only API access`
