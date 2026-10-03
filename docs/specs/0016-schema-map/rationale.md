# 0016. Schema map: decision record

## Context

A workspace's data model grows by hand: People, Companies and Deals come from the template, then admins add custom objects, attributes and relationships through #13 and #15. Settings shows these one object at a time, so nobody can see the whole shape. People building views, imports or (later) automations need to know where a field lives and how objects connect; admins need a quick way to spot a missing or doubled relationship.

The engine already holds everything the picture needs. Objects, attributes and relationships are rows (spec 0004); a relationship has a defining end, an optional other end, and one of four cardinalities read from the defining end (`one_to_one`, `one_to_many`, `many_to_one`, `many_to_many`). A one way reference has no other end and names up to 20 target objects instead. Archived definitions stay in the tables. Limits cap a workspace at 50 custom objects and 250 attributes per object.

Forces:
- **Access**: from #24, objects and fields can be hidden per role, and hidden must mean absent everywhere (spec 0009). A picture of the model must not reveal an object's existence through a line or a row.
- **Live**: every other screen updates within a second (spec 0005, AC-38); a settings picture that needs a reload would feel broken next to the tables.
- **Readability at 50 objects**: the scope's "Done when" asks for it. Fifty cards with hundreds of lines don't fit a screen at a readable size.
- **Accessibility**: every screen meets WCAG AA. A canvas of shapes and lines is a poor fit for screen readers and keyboards by default, and dragging a node or a line is a pointer only gesture unless an alternative exists.
- **Bundle**: spec 0003 already chose React Flow 12 and ELK in a worker for this, and keeps heavy modules out of the first load.
- **Parallel build**: #13 (settings pages) and #15 (the relationship dialog) are designed at the same time, so this feature must lean on their pieces without waiting on all of them.

## Options considered

### Option 1: one read, a deterministic layout, nothing stored (chosen)

A `schema.graph` procedure returns the visible model in one answer; the browser lays it out with ELK the same way every time; positions live only in the open page; drawing opens #15's dialog.

**Pros**: no new table, migration or write path; the picture can't drift from the data; access filtering happens once on the server; small surface to build and test.
**Cons**: nobody can arrange the map by hand; every schema change refetches the whole graph.

### Option 2: saved layouts with draggable nodes

The same read plus a `schema_map_layouts` table (per workspace, or per member) storing node positions, saved as nodes are dragged.

**Pros**: a team can curate one arrangement ("Deals in the middle"); familiar from diagram tools.
**Cons**: a new table, write procedure, `definitions` event kind and conflict rule for two admins dragging at once; positions go stale as objects are added; a keyboard way to move nodes is needed for WCAG 2.5.7; per workspace layouts need a permission decision, per member ones multiply storage. All of this before anyone has asked to arrange the map.

### Option 3: build the picture from the definitions store

No new procedure: the map asks the definitions store (spec 0006) for every object's attributes, one `attributes.list` call per object, and reads relationships from the attribute definitions.

**Pros**: no new server code; attributes loaded for the map are reused by tables later.
**Cons**: 53 calls to open the map at 50 objects; `attributes.list` doesn't carry relationship ends or one way targets, so it would need widening anyway; each per object refetch on an event shifts the picture piece by piece.

### Option 4: a server drawn static diagram

The server writes a diagram description (or an SVG) of the model, and the page shows it.

**Pros**: tiny client; easy to export.
**Cons**: no focus, find or keyboard model; no drawing to create; clicking parts of an image needs a second, hand built hit map; it ignores the library component spec 0003 already chose and designed.

## Rationale

Option 1 meets every force with the least new machinery. Access is decided once, in `getSchemaGraph`, through the same policy functions the rest of the engine uses, so #24's rules reach the map for free. Live updates are a coalesced refetch of one small answer, which is simpler and always correct compared with patching a graph event by event. Readability at 50 objects comes from find, focus, compact zoom and a minimap rather than from hand arrangement. Option 2 is the natural next version; nothing in option 1 blocks it, since the library already accepts `positions`. Option 3 was the runner up for its reuse, but its call count and its missing relationship data make it slower and no simpler. Option 4 can't meet the clicking and drawing parts of the scope.

Per decision:
- **Members view, admins draw**: reading the model is harmless and helps everyone; changing it is `schema.manage` (owner decision, spec 0009).
- **No saved layout, nodes not draggable**: a drag that is never saved surprises people when it vanishes, and draggable nodes would need a keyboard alternative. Pinning while the page is open keeps live changes calm.
- **Deterministic ELK** (fixed options, sorted input, model order kept): the same model always gives the same picture, so people learn where things are and screenshot tests are stable.
- **Overlap triggers a full layout**: pinning plus a growing node can collide; a full, announced relayout is better than overlapping cards.
- **One `schema.graph` read**: one round trip, one consistent snapshot (one transaction), and a natural place to filter by access.
- **The whole graph refetched per event, at most once a second**: schema changes are rare and the answer is small for real workspaces; per event patching would duplicate the server's visibility and swapping rules in the client.
- **System attributes folded into one row**: they are the same on every object (id, created, updated) and only add noise.
- **Type families, not one group per type**: twenty types would make twenty tiny groups; eight families keep a node scannable and give ELK a fixed node height.
- **At most 8 rows per node**: keeps nodes a known size before layout and the map readable; the full list is one click away in settings.
- **Compact mode below zoom 0.6**: at the zoom where 50 nodes fit, rows are unreadable anyway; a large name is what helps there.
- **One hidden end drawn one way, from the visible end**: the visible attribute already tells its viewer that it points somewhere, so drawing that is honest; naming the hidden side would leak it.
- **One way references drawn dashed**: #15 creates none from the UI, but the engine supports them and the API (#34) may make them; the map shows what exists.
- **A line opens a panel, not the dialog**: members need a read only explanation of a relationship; admins get "Edit relationship" one click further.
- **The list view as the text alternative**: like the charts' "View as table" (spec 0003), it gives screen reader and phone users the same facts in a table.
- **Focus in the address**: a link to "the map focused on Deals" is useful in a conversation and costs nothing.

## Evidence

**Engine shape** (`packages/db/src/schema/definitions.ts`, `packages/core/src/engine/relationships.ts`):
- `relationships` has `cardinality` (four values), `from_attribute_id`, `to_attribute_id` (null for one way), `target_object_ids` (one way only, 1 to 20).
- `singleEnds` reads cardinality from the defining end: `one_to_many` means one defining record links to many on the other end.
- Creating a relationship refuses a missing object (`NOT_FOUND`, "That object does not exist.") and an archived one (`NOT_FOUND`, "That object is archived. Restore it first.").
- Limits (`packages/core/src/engine/limits.ts`): 50 custom objects, 250 attributes per object.

**Gaps in spec 0003's `SchemaMapProps`** this spec closes:
- `cardinality` had three values; the engine has four (`many_to_one` added, or ends swapped).
- `to.attributeName` was required; one way references and relationships with one hidden end have none.
- No way to mark system attributes, the primary attribute or a row's far object; no focus, layout key or layout callback.

**Answer size**: a slim attribute entry is about 130 bytes of JSON. A typical workspace (53 objects, 40 attributes each) is about 280 kB raw and 40 kB gzipped; the worst case at today's limits (53 objects, 255 attributes each including system ones) is about 1.8 MB raw and 250 kB gzipped.

**CSP**: `apps/web/vercel.json` sets `script-src 'self'` and no `worker-src`, so a same origin module worker is allowed, as spec 0003 required (never a `blob:` worker).

## References

**Project sources**:
- `AGENTS.md`: Tracer Bullet, WCAG AA baseline, functional first rules.
- Spec 0003 (`0003-charts-board-and-schema-map.md`): React Flow 12, ELK in a worker, the node and edge design.
- Spec 0004: objects, attributes and relationships as rows; limits.
- Spec 0005: the door, the outbox and relay, the AC-38 measurement.
- Spec 0006: the definitions store, coalescing, full catch up.
- Spec 0007: `definitions` events for every schema change (AC-81).
- Spec 0009: `schema.manage`, data levels, `access` events.
- Spec 0011: the local capped Docker profile for measurements.
- The brief for #56 and the owner decisions of 3 October 2026.

**Practices and standards**:
- WCAG 2.2 AA, including 2.5.7 (dragging movements) and 1.1.1 (a text alternative for the picture).
- Deterministic layout for stable mental maps and screenshot tests.
- Server side filtering for hidden data, never client side hiding.
