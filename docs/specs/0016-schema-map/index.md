# 0016. Schema map: the workspace's data model as one live picture

**Date**: 2026-10-03
**Status**: Proposed

## Summary

The schema map is a picture of how a workspace's data fits together: every object as a card listing its attributes, and a line for every relationship, labelled with both attribute names and how many records each side may link to. It sits beside the list of objects in settings, every member can look at it, and owners and admins can draw a line between two objects to create a relationship through the same dialog #15 builds. It reads the whole model in one call, lays it out the same way every time (no saved layout in this version), updates live, and stays usable at 50 objects through find, focus, a minimap and a compact zoomed out view. It is built in three visible steps: a read only map, then live and at scale, then drawing.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a member, I want to see every object I can use and how they connect, so I understand where data lives before I build a view or an import.
- As an admin, I want to click an object or a line and land on its settings, so the map is a way into the model, not only a picture of it.
- As an admin, I want to draw a line between two objects to create a relationship, so connecting data feels as direct as it looks.
- As a member in a workspace with many objects, I want to find one object and see only what touches it, so a large model stays readable.
- As anyone with the map open, I want changes a teammate makes to the model to appear without a reload, so the picture is never stale.
- As a member with limited access (from #24), I want objects and fields hidden from me to be absent from the map, so it never shows what I can't open.

**Acceptance criteria** (this spec owns the range AC-342 to AC-371; it uses AC-342 to AC-361):

*The map*
- **AC-342**: `/w/$slug/settings/objects/map` shows the schema map to every active member (owner, admin or member). The Objects settings page header has a "List" and "Map" toggle that switches between #13's list (`/w/$slug/settings/objects`) and the map, and the settings entry in the sidebar opens whichever of the two was last chosen in this browser. The page title is "Objects" and the tab title "Objects · CRM".
- **AC-343**: Each live object the viewer may see is one node: its icon tile in its hue, its plural name, and its attribute rows. The primary attribute (the record's name) comes first, marked "Name". The other non system attributes follow, grouped by type family in this order: Relationships, Text, Numbers, Dates, Choices, People, Files, Other; within a family, by attribute position. Each row shows the type's icon from the field set registry and the attribute title; a relationship row also names the far object ("Company → Companies"). All system attributes fold into one last row, "System · N", which never expands on the map. A node shows at most 8 rows; past that a "+N more" footer opens the object's Attributes settings. Lists are not on the map.
- **AC-344**: Each two way relationship whose two objects are on the map is one line from the defining object to the other, labelled with both attribute names (defining end first) and a cardinality chip read from the defining end: `1 · 1`, `1 · N`, `N · 1` or `N · N`. A relationship from an object to itself is a loop on its node. Two relationships between the same pair are two lines with two labels. A one way reference is a dashed line with an arrow to each target object on the map, labelled with its one attribute name and its chip (`N · 1` single, `N · N` multiple). Archived objects, archived attributes and any relationship with an archived end are absent.
- **AC-345**: Only what the viewer may see reaches the browser. An object at data level `none` (spec 0009, AC-140) is absent with every line that touches it, and a relationship row on a visible object that points to it names no far object ("Relationship" only). A hidden attribute is absent; a relationship with one hidden end is drawn as a one way line from its visible end, and one with both ends hidden is absent. `schema.graph` returns nothing else: no records, no values, no counts. Proven with rules injected through the door's `rules` dependency, as spec 0009 does before #24.
- **AC-346**: Clicking a node's header, or Enter on a focused node, opens `/w/$slug/settings/objects/$object` (#13's object settings). Clicking a line, Enter on a focused line, or choosing a relationship from a node's menu opens the Relationship panel: both ends (object and attribute name, each linking to that attribute's settings), the kind ("Two way" or "One way"), and the cardinality in words from the defining end ("One company to many people"). An owner or admin also sees "Edit relationship", which opens #15's relationship dialog in edit mode.
- **AC-347**: The map works by keyboard and screen reader. Tab moves through the nodes in layout order (top to bottom, then left to right) and then the lines; each node has a menu button (also Shift+F10) listing "Open settings", "Focus" and each of its relationships. The map region has a label and a description ("Schema map: 12 objects, 18 relationships"). "View as list" shows the same graph as a `Table`: one row per relationship (From object, From attribute, Cardinality, To object, To attribute), then the objects with no relationships. Focus rings are visible and contrast meets AA in light and dark. At phone width the toolbar wraps, the map pans and pinch zooms by touch, and the list view is the default below `bp-sm`.
- **AC-348**: The map has a loading state (skeleton nodes), an error state with Retry, and "No objects to show" when the viewer may see no object. While a layout is computing after the graph has loaded, the previous picture stays and a quiet "Arranging…" status shows (announced politely).

*Layout and readability*
- **AC-349**: The layout is deterministic. The same graph laid out twice, with its objects, attributes and relationships handed over in shuffled order, gives the same positions to the pixel. ELK's layered algorithm with orthogonal lines runs in a same origin module worker. No node overlaps another node or a line's label; a test checks every bounding box of the 50 object seed's layout.
- **AC-350**: On the 50 object seed (50 custom objects plus the standard ones, 40 attributes each on average, 120 relationships including 5 self relationships, 10 parallel pairs and 10 one way references): `schema.graph` answers in 300 ms p95 on local Docker capped as spec 0011 sets it; the layout finishes in 1.5 seconds in Chromium with CPU throttled 4 times; the map is interactive within 3 seconds of navigation; panning and zooming show no long task over 50 ms in a Chromium performance trace. Numbers go in `verify.md`.
- **AC-351**: The first view fits the whole map, clamped to a minimum zoom of 0.25 and centred. Zoom in, zoom out and "Fit" are buttons (and `+`, `-`, `0` keys while the map has focus), and a minimap shows where the view is. Below zoom 0.6 every node turns compact: its rows hide and its name grows so it reads at 12 CSS pixels or more on screen down to zoom 0.25; line labels hide too, except on the focused object's lines and the hovered or focused line.
- **AC-352**: "Find" is a combobox that matches object names and attribute titles ("Deals · Amount"). Choosing a result centres its object at zoom 1 and focuses it. Focus keeps the object, the objects it relates to and the lines between them at full strength, dims everything else, and shows those lines' labels. Escape or "Clear focus" ends it. The focused object is in the address as `?focus=<apiSlug>`, so a shared link opens focused; an unknown or hidden slug opens the map unfocused.

*Live*
- **AC-353**: With the map open in two browsers, a change in one shows in the other within 1 second at p95, measured as spec 0005's AC-38 is (Playwright, 20 changes after one warm up): an attribute added, renamed or archived; a relationship created or archived; and, once #13 sends its events, an object created, renamed, archived or restored. Nodes already on the map keep their positions. New nodes are laid out among themselves and placed to the right of the current picture. If a change would make two nodes overlap (a node grew), the whole map lays out again and "Map rearranged" is announced. "Tidy layout" lays out the whole map on demand.
- **AC-354**: The map refetches `schema.graph` at most once per second, however many `definitions` events arrive (leading and trailing), and also after a full catch up (spec 0006, AC-62) and an `access` event (spec 0009, AC-146). It holds no record and makes no record request.

*Drawing a relationship*
- **AC-355**: An owner or admin (`schema.manage` in `access.mine`) sees a connection handle on each node and a "New relationship" button. Dragging from a handle onto another node, or back onto the same node for a self relationship, opens #15's relationship dialog with both objects chosen. Cancel or Escape leaves the map as it was, with no line drawn.
- **AC-356**: "New relationship" opens the same dialog with two object pickers, so the whole flow works by keyboard. Both paths call the same `onConnect`.
- **AC-357**: Creating waits for the server. On success the new line appears with both labels, without a reload, and takes focus; the dialog closes. A refusal (a name taken, the 250 attributes per object limit, `CONFIG_INVALID`) shows inside the dialog and draws nothing. Retrying a create whose answer was lost makes one relationship, not two (#15's `mutationId` replay).
- **AC-358**: A member sees no handles and no "New relationship", and the map says nothing about drawing. A member's direct call to #15's create procedure gets 403 `FORBIDDEN` (spec 0009, AC-135). An admin demoted while the map is open loses the handles when the `access` event arrives.
- **AC-359**: If the target object is archived by someone else between the drag and Create, the dialog shows "That object is archived. Restore it first." and the map refetches, so the archived node disappears.

*Delivery*
- **AC-360**: The schema map's code (React Flow, the map screen) and the ELK worker load only on the map route. The first load budget of spec 0003's AC-18 is unchanged, and the map route's own JavaScript (without the worker) stays under 150 kB gzipped.
- **AC-361**: The feature runs in production on brij-crm-phi.vercel.app, built from tokens and library components only. Playwright covers reading the map, the list view, find and focus, live changes between two browsers, and drawing by pointer and by keyboard, locally and against production.

## Decision

**Chosen option**: Option 1: one read of the whole model, laid out in the browser by the library's `SchemaMap` the same way every time, refetched live, with drawing handing off to #15's relationship dialog.

A new `schema.graph` procedure returns the viewer's visible objects, attributes and relationships through the access door; the data layer keeps it beside the definitions store and refetches it on `definitions` and `access` events; the screen turns it into `SchemaMapProps`; ELK lays it out in a worker. Nothing about the map is stored.

Decisions taken from the brief and the owner decisions, recorded here so they can be confirmed:
- **Members view, admins draw** (brief): reading needs only membership; handles, "New relationship" and "Edit relationship" need `schema.manage`, which owners and admins hold (owner decision; spec 0009).
- **No saved layout in this version** (brief): the layout is deterministic ELK. Nodes can't be dragged, so there is no position to lose and no pointer only action (WCAG 2.5.7). Positions stay pinned while the map is open; "Tidy layout" starts over.
- **One read** (brief): `schema.graph` over N calls to `attributes.list`.
- **System attributes collapsed** (brief) into one "System · N" row.
- **Hidden objects absent** (brief), and a relationship with one hidden end is drawn from its visible end only (this spec's call).
- **One way references are drawn** dashed, though #15 creates none from the UI: the map shows what exists, including references made through the engine or, later, the API (#34).
- **Clicking a line opens a panel**, not #15's dialog directly: members get a read only description, and admins one more click to "Edit relationship".

**Implementation skills**: `react-flow` (`existential-birds/beagle`, `.claude/skills/react-flow/`) · `react-aria` (`react-aria.adobe.com`, `.claude/skills/react-aria/`) · `stories` (`storybookjs/storybook`, `.claude/skills/stories/`) · `vite` (`antfu/skills`, `.claude/skills/vite/`) · `tanstack-router-best-practices` (`deckardger/tanstack-agent-skills`, `.claude/skills/tanstack-router-best-practices/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`lobehub/lobehub`, `.claude/skills/drizzle/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · `semantic-html-first` (`kemiljk/skills`, `.claude/skills/semantic-html-first/`) · `interface-affordances` (`kemiljk/skills`, `.claude/skills/interface-affordances/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · house skills `crm-design-system`, `crm-frontend-state`, `crm-api-backend`, `crm-data-model-access`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

- **#4 component library**: `SchemaMap`, `ObjectNode` and `RelationEdge` are spec 0003's milestone 5, task 24, not built yet. Milestone 1 here pulls that task forward (as spec 0005 pulled the auth modules forward) with the prop changes listed under "Library changes", and adds the `size-schema-node` token through spec 0002's flow.
- **#6 client data**: the graph store lives beside the definitions store (spec 0006, `0006-live-and-definitions.md`) and is cleared with it on sign out and workspace switch (AC-64 there). If 0006's milestone 3 hasn't landed, milestone 1 builds the graph store on its own with the same clearing, and milestone 2 hooks it to whatever live router exists (spec 0005's, or 0006's).
- **#7 realtime**: the map needs `definitions` events for every schema change (spec 0007, AC-81). Spec 0005's milestone 3 (outbox, relay, Centrifugo) is a hard dependency of milestone 2. Attribute writes already send `definitions` events naming their object; a relationship write touches two objects and must name both (one row per object, or one row with no `objectId`); #15 owns that, and milestone 2 adds a test that fails if it doesn't. Object level events (no `objectId`) come with #13.
- **#8 background jobs**: none.
- **#9 access model**: `access.mine` (role and permissions), `schema.manage`, and the policy functions `objectLevel` and `visibleAttributes`. Milestone 1 needs only the door (built in #10) and reads with the open policy if spec 0009's milestone 1 hasn't landed; milestone 3 hard depends on 0009's milestone 1 (roles and `access.mine`).
- **#10 core loop**: the door, `member` middleware, the outbox and the relay (milestone 3 there).
- **#13 objects and attributes**: the Objects settings pages (`/settings/objects`, `/settings/objects/$object` with its Attributes tab), `SettingsLayout`, the "List" view, `objects.position`, and the object level `definitions` events. If #13's settings frame hasn't landed, milestone 1 renders the map inside the `/w/$slug` frame with a TopBar titled "Objects", the toggle shows only "Map", and a node opens the object's table (`/w/$slug/objects/$object`) until the settings route exists; AC-342 and AC-346 are checked once it does.
- **#15 relations**: the relationship dialog (create and edit modes, both objects preset, name proposals, cardinality), its create and update procedures (`relationships.create`, `relationships.update` as #15 names them), refusals and replay. Milestone 3 hard depends on #15's first milestone.

### Data model sketch

No new table and no migration. The map is a read over existing definitions:

| Table | Columns read | Rule |
|---|---|---|
| `objects` | `id`, `api_slug`, `singular_name`, `plural_name`, `icon`, `hue`, `standard_key`, `primary_attribute_id`, `archived_at`, `position` (#13 adds it; until then `created_at`) | `archived_at is null` |
| `attributes` | `id`, `object_id`, `title`, `type`, `is_multi`, `is_system`, `position`, `relationship_id`, `archived_at` | `object_id is not null`, `archived_at is null`, its object live |
| `relationships` | `id`, `cardinality`, `from_attribute_id`, `to_attribute_id`, `target_object_ids` | its from attribute live; for two way, its to attribute live too |

Indexes already there: `attributes_by_object` (workspace, object, position) and the relationship primary key. Nothing about the map's layout is stored.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `schema.graph` (new) | `workspace` (slug) | `SchemaGraph` (below) | member, any role | 404 `NOT_FOUND` (unknown workspace or non member), 401 |
| `access.mine` (spec 0009) | `workspace` | role, permissions | member | 404 |
| `relationships.create` (#15) | `workspace`, `cardinality`, `from` { objectId, title }, `to` { objectId, title }, `mutationId` | the relationship and its two attributes | `schema.manage` | 403 `FORBIDDEN`, 404 `NOT_FOUND` (object missing or archived), 409 `SLUG_TAKEN`, `LIMIT_REACHED`, 422 `CONFIG_INVALID` |
| `relationships.update` (#15) | `workspace`, `relationshipId`, end titles | the relationship | `schema.manage` | 403, 404, 409 `SLUG_TAKEN` |

`SchemaGraph` (`packages/contracts/src/schema.ts`, one Zod schema per shape, each type with the schema's name):

```ts
SchemaGraph = {
  objects: { id, apiSlug, singularName, pluralName, icon: ObjectIcon, hue: Hue, standardKey?, primaryAttributeId? }[],  // live, visible, in position order
  attributes: { id, objectId, title, type: AttributeType, isMulti, isSystem, position, relationshipId? }[],             // live, visible, by object then position
  relationships: {
    id, cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many',
    from: { objectId, attributeId },        // the defining end, always visible when present
    to?: { objectId, attributeId? },        // two way: the other end; attributeId left out when that field is hidden
    targetObjectIds?: string[],             // one way: visible live targets only, at least one
  }[],
}
```

A relationship is in the answer only when its defining end is visible and at least one far object is visible and live (AC-345). When the defining end is hidden but the other end is visible, the answer swaps them: `from` becomes the visible end, `to` loses its `attributeId`, and the cardinality is mirrored (`one_to_many` ↔ `many_to_one`).

**Status codes**: 401 `UNAUTHENTICATED`, 403 `FORBIDDEN` (a drawing write without `schema.manage`), 404 `NOT_FOUND` (workspace, non member, or an object gone or archived during a draw), 409 `SLUG_TAKEN` and `LIMIT_REACHED` (from #15's create), 422 `CONFIG_INVALID`, 429 `RATE_LIMITED`, 500 `INTERNAL`. `schema.graph` itself answers only 401, 404, 429 and 500.

### Code shape

- `packages/core/src/objects/schema-graph.ts`: `getSchemaGraph(scope)` runs three reads inside one `inWorkspace` (objects, attributes, relationships), leaves out objects whose `objectLevel` is `none` and attributes `visibleAttributes` drops (the scope's access), drops or swaps relationships as above, and sorts everything into a stable order. Its access table entry is `{ data: 'read' }`.
- `packages/contracts/src/schema.ts`: `SchemaGraph` and `schemaContract.graph`.
- `apps/api`: the `schema.graph` procedure behind the `member` middleware.
- `packages/data`: `definitions(workspace).graph()` returning `{ subscribe, getSnapshot, status: 'loading' | 'ready' | 'error', retry }`, and `toSchemaMapProps(graph)` (below). `@crm/data/react` adds `useSchemaGraph(workspace)`.
- `packages/ui/src/modules/SchemaMap/`: the library component with the changes below.
- `apps/web/src/features/schema-map/` (with its three line README brief) and the route `apps/web/src/routes/w.$slug.settings.objects.map.tsx`, loaded lazily.

### Library changes (amending spec 0003's `SchemaMapProps`)

Spec 0003 left live updates and saved positions to this spec; these changes make its props fit the engine and this design:

```ts
interface SchemaMapProps {
  objects: readonly { id; name; icon; hue; primaryAttributeId?; attributes: readonly { id; name; type: AttributeType; isSystem: boolean; farObjectName?: string }[] }[];
  relations: readonly {
    id;
    from: { objectId; attributeName };
    to: { objectId; attributeName?: string };      // no attributeName: drawn one way (dashed, arrow)
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';  // read from `from`
  }[];
  positions?: Readonly<Record<string, { x: number; y: number }>>;  // pinned: the positions of the picture on screen
  onLayout?(positions: Readonly<Record<string, { x: number; y: number }>>, rearranged: boolean): void;
  layoutKey?: number;                              // a new value lays out the whole map ("Tidy layout")
  focusObjectId?: string;  onFocusChange?(objectId: string | undefined): void;
  onObjectOpen?(objectId: string, tab?: 'attributes'): void;
  onRelationOpen?(relationId: string): void;
  onConnect?(fromObjectId: string, toObjectId: string): void;
  canConnect: boolean;
  status?: 'loading' | 'ready' | 'error'; onRetry?(): void;
}
```

- `ObjectNode` owns the row rules of AC-343 (family order, the "Name" mark, the far object name, the folded "System · N" row, at most 8 rows and "+N more"), so its height is known before layout.
- Type families: Relationships (`record_reference`), Text (`text`, `long_text`, `email`, `phone`, `domain`, `url`, `location`, `personal_name`), Numbers (`number`, `currency`, `rating`), Dates (`date`, `timestamp`), Choices (`select`, `status`, `checkbox`), People (`actor_reference`), Files (`file`), Other (`interaction` and any type added later).
- Nodes are not draggable (`nodesDraggable={false}`); nodes and edges are focusable; `isValidConnection` accepts any node, including the source.
- Pinning: with `positions`, nodes that have one keep it; the others are laid out by ELK among themselves and shifted to the right of the pinned picture's bounding box by `space-8`. If any two nodes then overlap, the whole map is laid out from scratch and `onLayout` reports `rearranged: true`.
- Determinism: before ELK runs, objects are sorted by their given order and relations by `id`, and ELK gets fixed options (`elk.algorithm: layered`, `elk.edgeRouting: ORTHOGONAL`, `elk.layered.considerModelOrder.strategy: NODES_AND_EDGES`, fixed spacing from tokens read once at mount); no random seeds.
- Compact mode below zoom 0.6 and focus dimming (AC-351, AC-352) live in the component, driven by React Flow's viewport zoom through a CSS variable, so a zoom causes no React render of the nodes.
- Minimap and zoom controls are React Flow's `MiniMap` and our own `Button`s, styled with tokens.

### The screen

- Page: TopBar "Objects" with the List and Map `ToggleButtonGroup`; a toolbar with Find (`ComboBox`), "View as list" (`ToggleButton`), "Tidy layout", zoom buttons, and, for `schema.manage`, "New relationship".
- Canvas: `SchemaMap` fed by `toSchemaMapProps(graph)`, positions held in the route's component state (never stored), `focus` in the search params.
- Relationship panel: library `Panel` with the AC-346 contents; "Edit relationship" opens #15's dialog.
- List view: library `Table`, sorted by From object then From attribute, with the objects without relationships after it.
- The List and Map choice is kept in `localStorage` under `crm.objects.view` (read and written in try and catch, List when nothing is stored); the sidebar's Objects settings entry reads it, and the address always wins.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| open the map | the workspace id and viewer | `auth.workspace_directory` by slug, then the active `members` row (the door, spec 0005) |
| open the map | which objects, attributes and relationships exist | `schema.graph`: `objects`, `attributes`, `relationships` rows, live only |
| open the map | what the viewer may see | the scope's `access.data` (spec 0009): `objectLevel`, `visibleAttributes`; the open policy until #24 |
| node | icon, hue, plural name | `objects.icon`, `objects.hue`, `objects.plural_name` |
| node | node order (before layout) | `objects.position` (#13), else `created_at` then `id` |
| node | which row is "Name" | `objects.primary_attribute_id` |
| node | row order | the type family order fixed in this spec, then `attributes.position`, then `id` |
| row | type icon | the field set registry's icon for `attributes.type` (spec 0003) |
| relationship row | the far object's name | derived: the row's `relationshipId` in `schema.graph.relationships`, the other end's object, its `plural_name`; none when that object isn't in the answer |
| "System · N" | N | count of the object's attributes with `is_system` |
| "+N more" | N | the object's rows beyond 8, counted by `ObjectNode` |
| line | ends and direction | `relationships.from_attribute_id`'s object to `to_attribute_id`'s object, or to each of `target_object_ids` |
| line label | the two attribute names | `attributes.title` of the from and to attributes |
| line label | the chip | `relationships.cardinality`: `one_to_one` `1 · 1`, `one_to_many` `1 · N`, `many_to_one` `N · 1`, `many_to_many` `N · N`; mirrored when `schema.graph` swaps ends |
| line style | two way or one way | `to.attributeId` present (solid) or absent (dashed, arrow) |
| Relationship panel | cardinality in words | the chip with the objects' `singular_name` and `plural_name` lowercased ("One company to many people"), strings in the feature's `strings.ts` |
| map region | its description | counts of objects and lines in the props |
| positions | every node's x and y | ELK in the worker, from node sizes (`size-schema-node` width; height from row count and the row height token) and the spacing tokens |
| positions after a live change | pinned positions | the route's state from the last `onLayout` |
| Find | candidates | `schema.graph` objects' `plural_name` and attributes' `title` |
| focus | the focused object | `?focus=` (an `apiSlug`), resolved against `schema.graph`; ignored when unknown |
| controls for drawing | whether to show them | `access.mine().permissions` has `schema.manage` |
| draw | the two objects | `onConnect(fromObjectId, toObjectId)` from the drag, or the dialog's two pickers |
| draw | names, cardinality, `mutationId` | #15's dialog (proposals and the minted id are #15's) |
| after a draw | the new line | the create's answer, then one `schema.graph` refetch; the echo event is skipped by `mutationId` |
| live | when to refetch | `definitions` events (any `objectId`), `access` events, full catch up; at most once a second |
| List or Map | the remembered choice | `localStorage` `crm.objects.view` |

### Key invariants

- `schema.graph` never returns records, values, counts or anything from a hidden object or field, and never names a far object the viewer can't see.
- The same `SchemaGraph` always gives the same layout.
- Nothing about the map is stored on the server; positions live only in the open page.
- The map writes nothing itself. The only write it starts is #15's relationship create (and update), which checks `schema.manage` on the server whatever the client shows.
- Every procedure the map calls goes through the access door; `getSchemaGraph` has an access table entry (spec 0009, AC-139).
- React Flow and ELK are imported only inside `packages/ui` (spec 0003, AC-19); the screen imports only `@crm/ui` and `@crm/data`.

### Security model

- Reading the map needs an active member row in the workspace; a non member and an unknown workspace get the same `NOT_FOUND`.
- Visibility is decided on the server by the scope's data policy, so a member never receives an object or field hidden from them, nor the name of an object a relationship points to when that object is hidden. The client's handles and buttons are only hints.
- Drawing and editing relationships need `schema.manage` (owner and admin), enforced by #15's procedures through the engine's definition writes (spec 0009).
- Titles and names are workspace data that every member with access to them already sees elsewhere; no secret, record or value is involved.
- `security-access-reviewer` reviews milestone 1 (the new read) and milestone 3 (drawing).

### Configuration required

No new variables or credentials. The ELK worker is a same origin module file; the CSP in `apps/web/vercel.json` has no `worker-src`, so `script-src 'self'` covers it. Check this on the first preview deploy. The token `size-schema-node` (and a dimmed opacity token if none fits) is added through the design system artifact and spec 0002's flow.

### Critical test scenarios

- Happy path: a member opens the map, sees People, Companies and Deals with their rows and the standard relationships labelled, finds "Deals · Amount", focuses Deals, opens a line's panel and then an object's settings; the list view shows the same relationships, verifies **AC-342** to **AC-348**, **AC-352**.
- Layout: the same graph in shuffled order twice gives equal positions; the 50 object seed has no overlaps; timings recorded, verifies **AC-349**, **AC-350**, **AC-351**.
- Live: browser B adds an attribute, creates a relationship and archives one while browser A's map updates within a second with existing nodes still in place; a burst of 30 definitions events causes at most 2 refetches, verifies **AC-353**, **AC-354**.
- Drawing: an admin drags People onto Companies and creates a relationship; the same by keyboard through "New relationship"; a self relationship on Deals; a lost answer retried makes one; a target archived mid draw refuses with the message, verifies **AC-355** to **AC-357**, **AC-359**.
- Auth and access: a member sees no handles and gets 403 calling the create procedure; a demoted admin loses the handles live; with injected rules, a hidden object, a hidden field and a relationship with one hidden end are absent or drawn one way, and the network answer holds none of their ids or names, verifies **AC-345**, **AC-358**.
- Delivery: the first load manifest test still passes; the map chunk stays under budget; production run, verifies **AC-360**, **AC-361**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production.

**Milestone 1: a read only map in production**
1. Pull spec 0003's task 24 forward: `SchemaMap`, `ObjectNode`, `RelationEdge` and the ELK worker in `packages/ui/src/modules/SchemaMap/`, with the library changes above (four cardinalities, one way lines, families, the System row, "+N more", deterministic options, compact mode, focus, minimap and controls, states); `@xyflow/react` 12.12.0 and `elkjs` 0.12.0 pinned in the catalog; `size-schema-node` through spec 0002's flow; stories including a 50 object fixture, README, `design-system-guardian`, the artifact publish, satisfies **AC-343**, **AC-344**, **AC-347**, **AC-348**, **AC-349**, **AC-351**
2. `SchemaGraph` and `schemaContract.graph` in `packages/contracts`; `getSchemaGraph` in `packages/core` with its access table entry, visibility filtering and end swapping; the `schema.graph` procedure; unit tests with injected rules, satisfies **AC-344**, **AC-345**
3. The graph store in `packages/data` (load, status, retry, cleared on sign out and switch) and `toSchemaMapProps`, satisfies **AC-343**, **AC-344**, **AC-345**
4. The route and screen: TopBar with the List and Map toggle, the toolbar (Find, View as list, zoom, Tidy layout), the canvas, focus in the address, the Relationship panel (read only parts), node and line opening, the list view, states, satisfies **AC-342**, **AC-346**, **AC-347**, **AC-348**, **AC-352**
5. The manifest test extended to the map chunk and the worker; deploy; `security-access-reviewer`, `ux-interaction-reviewer` and `dxe quick` before it lands, satisfies **AC-345**, **AC-360**, **AC-361**

**Milestone 2: live and at scale**
6. The graph store refetches on `definitions` and `access` events and on a full catch up, at most once a second; a test that a relationship write sends `definitions` events naming both objects, satisfies **AC-353**, **AC-354**
7. Pinned positions on redraw, new nodes placed to the right, the overlap fallback with its announcement, and "Tidy layout", satisfies **AC-353**
8. The 50 object seed (a script in `packages/core/scripts`, run against local Docker) and the measurements: `schema.graph` p95, layout time, time to interactive, the pan and zoom trace; numbers in `verify.md`, satisfies **AC-349**, **AC-350**, **AC-351**
9. The two browser Playwright test locally and in production; deploy; `state-performance-reviewer` before it lands, satisfies **AC-353**, **AC-361**

**Milestone 3: draw to create**
10. Handles and `canConnect` from `access.mine`; `onConnect` opens #15's dialog with both objects preset; "New relationship" with two pickers; controls follow role changes live, satisfies **AC-355**, **AC-356**, **AC-358**
11. After a create: one refetch, the new line focused, the echo skipped; refusals in the dialog; the archived target race; replay after a lost answer, satisfies **AC-357**, **AC-359**
12. "Edit relationship" in the panel through #15's edit mode, satisfies **AC-346**
13. Playwright: drawing by pointer and by keyboard, a self relationship, a member denied; deploy; `security-access-reviewer` and `ux-interaction-reviewer` before it lands; `verify.md` complete, satisfies **AC-355** to **AC-361**

## Consequences

**Positive**:
- One read and one component give every member a true picture of the model, and the picture can't drift from the data because nothing about it is stored.
- Drawing reuses #15's dialog, so there is one way to create a relationship, with one set of rules and refusals.
- Visibility comes from the door, so #24's rules hide objects and fields on the map with no change here.

**Negative / tradeoffs**:
- No saved layout: everyone sees the same arrangement, and nobody can tidy it by hand. A workspace that wants "Deals in the middle" can't have it until a later version.
- A pinned picture can drift from the clean layout during a long session of live changes; "Tidy layout" fixes it, but it is one more control.
- `schema.graph` returns every visible attribute. At today's limits (50 custom objects, 250 attributes each) the worst answer is about 13,500 attributes, roughly 1.8 MB raw and 250 kB gzipped. Realistic workspaces are far smaller, and AC-350 measures a realistic seed, not the worst case.
- Every `definitions` event refetches the whole graph, even for a change to one attribute. Coalescing caps it at once a second.
- ELK's bundle is large (about 1.4 MB unminified); it lives in a worker loaded only on this route.
- Pulling task 24 forward and changing its props amends spec 0003.

**Neutral**:
- No migration. New pinned dependencies `@xyflow/react` and `elkjs` (already chosen by spec 0003).
- One new token (`size-schema-node`), possibly a dimmed opacity token.
- `objects.position` (#13) changes the node order once it exists; the layout stays deterministic either way.

## Follow-up

- [ ] **Spec 0003** (`/sync`): record that task 24 moved forward to #56 and that `SchemaMapProps` changed as above.
- [ ] **#15**: confirm the dialog takes both objects preset (`from`, `to`), and that a relationship write sends `definitions` events naming both objects.
- [ ] **#13**: `objects.position`, object level `definitions` events, and the List view's toggle; until then AC-342 and AC-346 are checked against the fallback.
- [ ] **#16 computed attributes**: draw lookups and rollups as thin dotted lines from the attribute to the relationship they follow, once they exist.
- [ ] **#51 lists**: decide whether lists appear on the map (as small nodes attached to their object).
- [ ] **Later version**: saved layouts (per workspace, or per member), dragging nodes with a keyboard alternative, and export as an image.
- [ ] **#12 load harness**: add `schema.graph` at the worst case limits to the read mix if a workspace near the limits appears.
- [ ] The `react-flow` skill (`existential-birds/beagle`) is installed but not yet listed; its conventions belong in `packages/ui/AGENTS.md` (area scoped), not root.
