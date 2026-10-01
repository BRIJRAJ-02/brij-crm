# Scope: CRM

A generic, multi tenant CRM sold as SaaS, as flexible as Attio. Any company can sign up, shape its own objects, attributes and relations, invite its team, and work together live. It is built for 100 people online at once, with room to grow to 1,000, and up to a million records per workspace.

**Build approach:** Tracer Bullet (build one thin, real thread through every layer first, then thicken one strand at a time, always end to end).
**Workflow:** Beta (after `/develop`, run `/check verify`, then `/test`). This is the project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but you can skip it when you already know how to build. Any feature can carry its own tag (for example `· GA`) to do more or less.

**House rules (every feature follows these):**
- **Tokenised from day one.** Every colour, font size, spacing, radius, border, shadow and motion value is a named token. No screen uses a raw value, starting with the very first one.
- **Componentised.** Every screen is assembled only from the shared component library: atoms (the smallest pieces, like a button or an input), molecules (small groups, like a field or a menu) and modules (whole blocks, like the data grid or the record panel).
- **One field design everywhere.** Each attribute type has one editor and one display. They look and behave the same in tables, boards, record pages, create forms, filters and import previews.
- **No new CSS for an element that already exists.** If a module, element or atom of that type is already in the library, you add a variant to it instead of writing new styles.
- **Think before a new component.** First check the library and reuse. If nothing fits, extend an existing component with a variant. Only then create a new one, and write down why it was needed.
- **The design system comes first, and large.** It is built up front for the whole plan, in its own artifact (https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh?sk=NUiJdAv_8B9f6a2uJRrpBg), before feature slices begin.
- **Lucide is the icon library** (https://lucide.dev/icons/), used only through the Icon atom.
- **CSS that scales.** Tokens are CSS variables. Styles are scoped per component in fixed cascade layers, variants are declared once, components adapt with container queries, and nothing has a runtime cost or needs `!important`.
- **A design engineer pass on every screen.** Each screen starts with a three line brief (its purpose, its main task, and what it leaves out), gets built with real semantics and modern CSS, and gets a `dxe quick` review before it's done. The skill `crm-design-system` spells this out.
- **State management is the backbone.** Every screen reads and writes records through the one client data layer (#6). No screen keeps its own copy of a record or fetches data on its own.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## Areas

- [Foundations](foundations.md): stack, tooling, tokens, components, data model, client state, realtime, jobs, access, edge only API access · 2 done, 1 in progress, 7 planned
- [Data engine](engine.md): the core loop, objects, attributes, relations, computed attributes, the schema map, layouts, lists · 8 planned
- [Records and views](records-and-views.md): record page, notes and tasks, table and board views, bulk actions, reports · 6 planned
- [Team and security](team-and-security.md): workspaces, members, teams, access rules, account security, audit and privacy · 4 planned
- [Collaboration](collaboration.md): presence, shared notes, notifications, comments · 4 planned
- [Data in and out](data-in-out.md): import, export, merge, files, search, API, webhooks, backups · 7 planned
- [Business and operations](business-and-ops.md): monitoring, scale, plans, operator console, onboarding, billing · 7 planned
- [Integrations](integrations.md): email, calendar, sending, sequences, enrichment, forms, Slack, Zapier, other CRMs · 8 planned
- [Intelligence](intelligence.md): automations, AI assistant, AI attributes · 3 planned

## At a glance

Build order is the order of the rows below (a feature added later takes the next free `#` and sits in its build position). Slices 1 to 10 are the first release; slices 11 to 20 come after it.

| # | Feature | Phase | Area | Status |
|---|---------|-------|------|--------|
| 1 | Stack & architecture | Foundation | [Foundations](foundations.md) | done |
| 2 | Coding standards & tooling | Foundation | [Foundations](foundations.md) | done |
| 3 | Design tokens | Foundation | [Foundations](foundations.md) | in-progress |
| 4 | Component library | Foundation | [Foundations](foundations.md) | planned |
| 5 | Data model | Foundation | [Foundations](foundations.md) | planned |
| 6 | Client data and state | Foundation | [Foundations](foundations.md) | planned |
| 7 | Change events and realtime | Foundation | [Foundations](foundations.md) | planned |
| 8 | Background jobs | Foundation | [Foundations](foundations.md) | planned |
| 9 | Access model | Foundation | [Foundations](foundations.md) | planned |
| 57 | Edge only API access | Foundation | [Foundations](foundations.md) | planned |
| 10 | Core loop | Slice 1 | [Data engine](engine.md) | planned |
| 11 | Monitoring and product analytics | Slice 1 | [Business and operations](business-and-ops.md) | planned |
| 12 | Scale budget and load harness | Slice 1 | [Business and operations](business-and-ops.md) | planned |
| 13 | Objects and attributes | Slice 2 | [Data engine](engine.md) | planned |
| 14 | Validation and type changes | Slice 2 | [Data engine](engine.md) | planned |
| 15 | Relations | Slice 3 | [Data engine](engine.md) | planned |
| 16 | Computed attributes | Slice 3 | [Data engine](engine.md) | planned |
| 56 | Schema map | Slice 3 | [Data engine](engine.md) | planned |
| 17 | Record page | Slice 4 | [Records and views](records-and-views.md) | planned |
| 18 | Attribute groups and layouts | Slice 4 | [Data engine](engine.md) | planned |
| 19 | Notes and tasks | Slice 4 | [Records and views](records-and-views.md) | planned |
| 20 | Table views and saved views | Slice 5 | [Records and views](records-and-views.md) | planned |
| 21 | Board view | Slice 5 | [Records and views](records-and-views.md) | planned |
| 22 | Bulk actions and trash | Slice 5 | [Records and views](records-and-views.md) | planned |
| 23 | Workspaces, members and teams | Slice 6 | [Team and security](team-and-security.md) | planned |
| 24 | Access rules | Slice 6 | [Team and security](team-and-security.md) | planned |
| 25 | Account security | Slice 6 | [Team and security](team-and-security.md) | planned |
| 26 | Presence | Slice 7 | [Collaboration](collaboration.md) | planned |
| 27 | Shared notes | Slice 7 | [Collaboration](collaboration.md) | planned |
| 28 | Notifications | Slice 7 | [Collaboration](collaboration.md) | planned |
| 29 | Comments and mentions | Slice 7 | [Collaboration](collaboration.md) | planned |
| 30 | Import and export | Slice 8 | [Data in and out](data-in-out.md) | planned |
| 31 | Duplicate detection and merge | Slice 8 | [Data in and out](data-in-out.md) | planned |
| 32 | File attachments | Slice 8 | [Data in and out](data-in-out.md) | planned |
| 33 | Global search | Slice 8 | [Data in and out](data-in-out.md) | planned |
| 34 | Public API and keys | Slice 9 | [Data in and out](data-in-out.md) | planned |
| 35 | Webhooks | Slice 9 | [Data in and out](data-in-out.md) | planned |
| 36 | Audit log and privacy tools | Slice 10 | [Team and security](team-and-security.md) | planned |
| 37 | Backups and full export | Slice 10 | [Data in and out](data-in-out.md) | planned |
| 38 | Plans and limits | Slice 10 | [Business and operations](business-and-ops.md) | planned |
| 39 | Operator console | Slice 10 | [Business and operations](business-and-ops.md) | planned |
| 40 | Templates and onboarding | Slice 10 | [Business and operations](business-and-ops.md) | planned |
| 41 | Scale hardening | Slice 10 | [Business and operations](business-and-ops.md) | planned |
| 42 | Billing | Slice 11 | [Business and operations](business-and-ops.md) | planned |
| 43 | Email sync | Slice 12 | [Integrations](integrations.md) | planned |
| 44 | Calendar sync | Slice 12 | [Integrations](integrations.md) | planned |
| 45 | Send email from records | Slice 12 | [Integrations](integrations.md) | planned |
| 46 | Sequences | Slice 13 | [Integrations](integrations.md) | planned |
| 47 | Enrichment | Slice 14 | [Integrations](integrations.md) | planned |
| 48 | Forms | Slice 15 | [Integrations](integrations.md) | planned |
| 49 | Slack and Zapier | Slice 15 | [Integrations](integrations.md) | planned |
| 50 | CRM connectors | Slice 16 | [Integrations](integrations.md) | planned |
| 51 | Lists and pipelines | Slice 17 | [Data engine](engine.md) | planned |
| 52 | Reports and dashboards | Slice 18 | [Records and views](records-and-views.md) | planned |
| 53 | Automations | Slice 19 | [Intelligence](intelligence.md) | planned |
| 54 | AI assistant | Slice 20 | [Intelligence](intelligence.md) | planned |
| 55 | AI attributes | Slice 20 | [Intelligence](intelligence.md) | planned |

## Deferred
Out of scope for the current plan, kept here so it stays honest.
- **Full WCAG AA audit**: a formal accessibility audit and fixes, beyond what the component library builds in · needs a decision
- **Multiple languages**: translated interface and local formats · needs a decision
- **Offline use**: keep working without a connection and merge on reconnect · needs a decision
- **Mobile apps**: phone apps over the public API · needs a decision
- **SSO and SCIM**: company sign in and automatic member provisioning · needs a decision · GA
- **Browser extension**: add people and companies while browsing LinkedIn or Gmail · needs a decision
- **Data residency**: choose EU or US hosting per workspace · needs a decision · GA
- **Marketing site**: public landing, pricing and SEO · needs a decision

## Legend

**The decision box.** Every feature that needs a decision carries exactly one box whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills find it by that `(spec)` ending, never by an exact label. Every other box is an execution box, and `/architect` never ticks one.

**Feature lifecycle.** The scope updates as a feature moves:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | `/architect` at spec capture | `Design it` ticked, spec linked, `Build it: /develop <feature>` with 2 to 5 milestones, then the tier's closing boxes (`Verify it` for Alpha and up, `Test it` for Beta and up, `Review it` and `Document it` for GA) |
| `in-progress` (building) | `/develop` | milestone boxes tick one by one, code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` and its milestones ticked, `Verify it` ticked |
| `done` | you, when you decide (any skill sets it when you say so); `/sync` reconciles | the boxes you ran are ticked, skipped ones marked skipped |

- **Next step** is the first unticked box, always a command or a tracked milestone.
- **needs a decision** means run `/architect` first; otherwise go straight to `/develop` (or `/audit` for standards and tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in each spec's `## Build plan`**, never here. The scope carries only the milestone rollup.
- **Status** moves `planned` → `in-progress` → `done`, plus `existing` (built before this workflow) and `dropped` (taken out of scope, kept for history).
- **Workflow tier tag** beside a heading (for example `· GA`) sets that feature's rigor above or below the project default; no tag means it uses the default.
- **Workflow** (the header line) is what runs after `/develop` by default: Prototype runs nothing more; Alpha runs `/check verify`; Beta runs `/check verify` then `/test`; GA adds a fresh model `/check review` then `/document`.
- **Pointer line** (`spec <n> · code in <path>`) appears once a spec or code exists: the spec link from `/architect`, the code path from `/develop`.
