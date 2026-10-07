# 0018. Attribute groups and layouts: decision record

## Context

An object can hold 250 attributes (spec 0012), and the standard ones already hold 15 to 25. The record page (#17) lists them in one long column in attribute order, which is also the default column order of every table. The scope's "Done when" for #18 asks that an admin group and order attributes into sections per object, that the record page, create form and settings follow the grouping, and that attributes hidden from the page stay in tables and filters.

The engine stores each attribute with a `position` (the default column order, changed only in settings, spec 0012) and an optional `list_id` for list attributes. Nothing groups them, nothing marks an attribute as off the page, and there is no notion of the few attributes that matter most for a record.

Forces: schema changes are admins only (owner decision; spec 0009 lists groups and layouts under `schema.manage`); one layout must read the same everywhere (the house rule of one design per type extends naturally to one order per object); every definition change must reach open screens within a second through the existing `definitions` events; hidden is absent (a section can't reveal hidden attributes); existing workspaces already have standard objects that need sensible sections without anyone doing it by hand; and per person preferences must not become server state nobody asked for.

## Options considered

### Option 1: a sections table plus attribute columns, one contiguous order (chosen)

`attribute_groups` per object or list; `attributes.group_id`, `shown_on_record_page`, `highlight_position`; positions renumbered so ordering by `position` is the layout order.

**Pros**: every existing reader that orders by `position` (tables, the create dialog, settings) follows sections with no change; one refetch of `attributes.list` carries everything; sections are real rows with ids, so events, access filtering and replays work like every other definition.
**Cons**: every move renumbers the object's attributes; the default column order is now tied to sections.

### Option 2: one layout document per object

A jsonb `layout` on `objects`: an ordered tree of sections and attribute ids, plus hidden ids and highlights.

**Pros**: one row to read and write; any shape (nested sections, columns) fits later.
**Cons**: attribute ids inside a document dangle when attributes are archived or created, so every attribute write must also edit the document; no foreign keys; concurrent edits overwrite each other's moves; tables still order by `position`, so two orders exist and drift.

### Option 3: layouts per record page and per form (separate layouts)

Separate layouts for the record page, the create form and the panel, as some CRMs allow.

**Pros**: maximum control for admins.
**Cons**: three orders to keep in step for every attribute change, against the scope's "follow the grouping"; more settings screens; the house rule of one way to see a thing is lost.

## Rationale

Option 1 matches the scope's requirement that every screen follow one grouping, and it does so by making the existing order mean the grouping, so no reader changes. Option 2's document can't keep referential integrity with attributes that are created and archived constantly, and it would leave tables on a second order. Option 3 multiplies what the admin must maintain for no requirement in the scope.

Per decision:
- **Contiguous positions**: the cheapest way to make "section, then position" equal "position" for every reader; 250 rows renumbered under the object lock is microseconds.
- **Hard delete for sections**: a section holds no data, only a heading; archiving it would add a state with nothing to restore.
- **Untitled section leads**: the primary attribute and quick additions read first without a heading, as Attio does.
- **"More" for custom attributes in the backfill**: keeps existing tables' column order for attributes someone added on purpose.
- **Highlights on the attribute row**: they change with the same events and refetch as everything else; an array on `objects` would need the object list refetched on every change.
- **No many sides in highlights**: a many side changes only by deltas (spec 0014), so a whole value tile editor would be wrong.
- **Personal folding in `localStorage`**: it is a view preference, not shared data; storing it on the server would add a table and a write on every click for little gain.
- **"Hidden fields" on the page**: without it, a member can edit a hidden attribute only from a table, which surprises people; a closed section keeps the page short and the data reachable.

## References

**Project sources**:
- `packages/db/src/schema/definitions.ts`: `attributes` has `object_id` or `list_id`, `position`, `archived_at`, `is_system`; `attributes_by_object` and `attributes_by_list` indexes on position; `objects.template_version`.
- `packages/core/src/engine/definitions.ts`: `SYSTEM_ATTRIBUTES` (Record ID, Created at, Created by, Updated at, Updated by) at positions 0 to 4; `checkName` (1 to 100 characters); `definitionGuard` maps unique indexes to refusals.
- `packages/core/src/engine/limits.ts`: `LIMITS` and the row lock pattern for counts.
- `packages/core/src/templates/standard-v1.ts`: the standard objects, their attributes and relationships by API name, `STANDARD_TEMPLATE_VERSION = 1`.
- `packages/ui/src/modules/AttributeList/AttributeList.tsx`: sections with `Disclosure`, `defaultExpanded` only (uncontrolled); `ViewSettings` (show, hide and reorder one list).
- Specs 0012 (the Attributes tab, `attributes.reorder`, definition writes server confirmed), 0007 AC-81 (`definitions` rows for attribute groups), 0009 AC-135 (`schema.manage` for groups and layouts), 0017 (`RecordDetails`, Overview).
- `.notes/briefs.md`, the #18 brief (3 October 2026).
