# 0020. Table views and saved views: decision record

## Context

Today every object has one table (spec 0005) with an unsaved sort (spec 0006) and, once #15 lands, an unsaved filter (spec 0014 AC-301). People need to keep the slices they work in, share some with the team and keep others to themselves, and land on the same slice tomorrow on another device. The scope's "done when" asks for and and or groups on any attribute, through relations and "assigned to me", correct sorting of numbers, dates and currency, saved column choice and order, private and shared views with a default per object, and a filtered first page inside the scale budget at a million records.

The hard parts are not storage. The client data layer (spec 0006) already runs any filter and sort over a million records in windows, and the engine (spec 0004) already compiles every operator and sorts every type correctly. What is left is a model for shared, editable configuration: who may change a shared view, what happens when two people change it at once, what a view built on a field that is later archived or hidden from someone should do, and how an unsaved filter behaves.

Forces: any member edits shared views, with a lock for owners and admins (the brief); hidden must mean absent (spec 0009); schema changes are admins only and happen while people have views open (spec 0012); everything is live within a second (spec 0007); Neon's free plan, so nothing may poll; the house rule that screens hold no server data of their own; and the build approach, a thin real thread first.

## Options considered

### Option 1: a views table with a checked JSON config, explicit query save, instant layout save (chosen)

One row per view with a strict Zod config. The filter and sorts change by an explicit Save with a version check; columns save at once, last save wins. Drafts live in the URL. What runs is worked out at read time from the stored config and today's attributes.

**Pros**: one small table and a handful of procedures; the config is the same shape the toolbar, the grid and the API already use (`FilterGroup`, `SortRules`); archives and access rules never rewrite views; drafts are shareable links for free.
**Cons**: layout clashes resolve silently (last save wins); the config is JSON, so attribute references aren't foreign keys and must be checked in code.

### Option 2: normalised tables (view columns, view filters, view sorts)

Columns, conditions and sorts as rows with foreign keys to attributes.

**Pros**: the database enforces that every referenced attribute exists; per column updates never clash.
**Cons**: nested and or groups and through paths make the filter a tree in rows, rebuilt on every read; every save rewrites many rows; three more tenant tables and their events for no gain the JSON config doesn't give; archiving an attribute would cascade into views (or need a soft link anyway).

### Option 3: every change saves at once (no drafts)

Filter and sort changes write to the view immediately, like columns.

**Pros**: the simplest model; no Save button, no URL state.
**Cons**: on a shared view one member's quick filter changes everyone's screen, the exact problem the brief's draft solves; a typo in a filter is broadcast live; the version check has nothing to protect.

### Option 4: per member copies of shared views

Each member's changes to a shared view are kept as their own overlay; Save pushes the overlay to the shared view.

**Pros**: nobody's layout fiddling affects anyone else.
**Cons**: two states per view per member to explain ("your version of the team view"); the team view drifts from what everyone actually sees; more storage and events. Attio doesn't do this, and the brief chose shared editing with a lock.

## Rationale

Option 1 fits the forces with the least machinery. The engine and windows already take exactly `FilterGroup` and `SortRules`, so storing them as JSON means the toolbar, the URL draft, the saved view and `records.query` share one shape and one validator. The danger of JSON (a reference to an attribute that no longer exists, or that a member can't see) is turned into a feature by working out the effective query at read time: an archive or an access rule never needs to touch views, and restoring an attribute brings every view back as it was.

Splitting how the query and the layout save follows how people use them. A filter on a shared view decides what the team sees, so it is a deliberate act with a clash check; a column width is cheap and frequent, so it saves at once and the last one wins. Option 3 fails the brief's draft requirement and makes shared views fragile; Option 4 doubles the state for a problem the lock already solves. Option 2 pays a lot of write and read cost for a guarantee the per write checks give anyway.

Calls and their runners up:
- **Default view chosen by owners and admins** (runner up: any member). It changes where every member lands, which is closer to a lock than to a filter.
- **Only the creator makes a shared view private** (runner up: owners and admins too). Making a view private removes it from everyone else; only the person who made it should be able to take it back.
- **New attributes only in views that ask for them** (runner up: every view). A curated view should not grow a column each time an admin adds an attribute; the default view still shows everything, which keeps spec 0012's intent.
- **A view built on a hidden attribute or record is absent** (runner up: shown with the hidden condition dropped). Dropping a condition silently shows more rows than the author meant and reveals that something was dropped; absence is what spec 0009 promises.
- **Archived attributes skipped with a warning** (runner up: the view refuses to run). An archive is reversible and admins do it while people work; a view that stops working would punish everyone for a settings change.
- **Hard delete for views, after a confirm** (runner up: a views trash). Views are cheap settings; a trash would add a screen and a purge for little value.
- **Drafts in the URL, not in the database** (runner up: per member drafts stored server side). A URL draft is shareable, survives reload, and costs no write or event; a stored draft would need its own table, events and cleanup.
- **Limits 100 shared per object and 50 private per member per object** (runner up: no limit). Unbounded views make `views.list` and the switcher unbounded; the numbers are generous and live in the one limits module.
- **Private view changes travel as coarse events** (runner up: a channel per member for private views). A per member channel is a second delivery path with its own tokens, history and catch up; the coarse event reuses spec 0009's rule and spec 0006's coalescing, and its cost (one small `views.list` a second at most per tab and object) is measured by #12.
- **A removed member's private views are deleted** (runner up: transfer them to an admin). Nobody else could ever see them, so keeping them only stores rows nobody reads; their shared views stay, since the team uses them.
- **A view with no sorts runs newest first** (runner up: record id order, oldest first). Every other list in the product is newest first (spec 0006 AC-57), and a fresh view should show the latest work.

## References

**Project sources**:
- Spec 0004 (the query engine, sorts, the reference evaluator), spec 0004's stored sort keys (the extended grid).
- Spec 0006 (windows, settle, the row note, the revision rule reused for views).
- Spec 0007 (the `views` kind, `outboxHook` and `context.record`, `planDelivery` and coarse events).
- Spec 0009 (`views.manage`, hidden means absent, `FORBIDDEN`, the `views` rule in `filterEvent`, `removeMember`).
- Spec 0012 (archived attributes, attribute order, `NAME_TAKEN`).
- Spec 0014 (the unsaved Filter and Sort, AC-301).
- `packages/contracts/src/values/filters.ts`, `sorts.ts`; `packages/ui/src/modules/Toolbar`, `FilterBuilder`, `SortBuilder`, `ViewSettings`, `DataGrid` READMEs.
- `.claude/skills/crm-frontend-state`, `crm-design-system`, `crm-data-model-access`, `crm-api-backend`.

**Practices and standards**:
- Optimistic concurrency with a version number for deliberate edits; last write wins for cheap, frequent ones.
- URL as the home of shareable UI state.
- Compute derived state at read time rather than rewriting stored references.
