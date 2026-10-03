# 0012. Objects and attributes: decision record

## Context

The engine (spec 0004) already holds objects, attributes and options as ordinary rows, with services to define, update, archive and restore them, and a limits module. The core loop (spec 0005) exposes only `objects.list`, `attributes.list` and an "Add attribute" dialog for eight types with no settings. A workspace still can't create an object, use select, status or currency, set a default, or tidy what it has. Attio's flexibility is the product's promise, so this is the first feature that makes the CRM feel like its own.

Forces:
- The owner decided schema changes are for owners and admins only, from now. The thin role and `schema.manage` are spec 0009's, which must land first.
- Every screen reads attributes to draw cells, so a definition change must reach every open screen fast, or tables show stale columns. Specs 0006 and 0007 define the definitions store and the widened `definitions` events; this feature is their first heavy user.
- Limits must stay in one module so plans (#38) can change them in one place, and so archiving can't be used to dodge them.
- API names appear in URLs and the public API (#34). Changing one later breaks integrations.
- Spec 0003 deferred the settings modules to milestone 4, after the core loop. Screens may be built only from library parts.
- The engine has a known gap: restoring an archived option skips the 500 option check.
- Type changes (#14) and relationships (#15) are separate features, but the type picker and the attribute dialog are where both will appear.

## Options considered

### Option 1: settings pages over the existing services, one shared attribute dialog (chosen)

Settings, Objects and each object's Attributes and Configuration tabs, plus the grid's "+" and column menu, all opening one AttributeSettings dialog. Thin procedures over the engine's definition services; the definitions store refetches on events.

**Pros**: one place for each type's settings; stable URLs #56 can link to; reuses the engine as is.
**Cons**: three modules pulled forward from the library's milestone 4; more screens than a table only approach.

### Option 2: everything from the table (Notion style)

Add, edit, reorder and archive attributes only through the grid's header; objects through a sidebar menu.

**Pros**: fastest to use while looking at data; no settings pages.
**Cons**: no home for archived items, usage meters, system attributes or #18's groups; column drag in a view would have to double as the schema order, mixing a personal view with the workspace's model (#20 separates them).

### Option 3: optimistic definition writes

Apply schema changes in the browser at once, like record edits.

**Pros**: feels instant.
**Cons**: definition writes are often refused (names, limits, duplicates) and reshape every table; rolling back a column that others' screens already drew is confusing. Spec 0005 already chose server confirmed schema writes.

## Rationale

Option 1 fits the forces: a stable settings URL per object is what #56 and #18 need, one dialog keeps fifteen types consistent, and server confirmed writes follow spec 0005. Option 2's speed is kept by the "+" and column menu, which open the same dialog. Pulling three modules forward is a small cost against the rule that screens use library parts only.

Per decision:
- Admins only, including creating an option from a cell: the owner's decision; an option is part of the model, so the same permission covers it (spec 0009 records the override of the brief).
- Members see settings read only: understanding the model helps everyone; hiding it gains nothing, since the API already returns it.
- No Relationship entry until #15: a disabled entry is dead UI; #15 owns the dialog and adds the entry with it.
- Archived objects and attributes count against limits: a restore never fails, and archiving can't dodge a limit. Options differ because pipelines retire stages routinely and 500 is per attribute; the restore check closes the gap.
- Client ids for every create: the same replay rule as records, and it works for options, which have no API name to look up by.
- Locked API names: URLs and the public API stay stable; a rename changes only names.
- `objects.position`: the sidebar order is the workspace's, and creation order can't be changed.
- Unique object names: two "Projects" in the sidebar can't be told apart; including archived ones means a restore never collides.
- The effectively archived rule for paired attributes: archiving an object must hide what points at it without rewriting rows, so a restore is exact.
- Unique fills stay in the request: today's objects are small; #8 moves them to a job when it lands.
- Three starter stages: a status with no stages is unusable; Not started, In progress and Done read clearly and map to open, open, won.

## References

**Project sources**:
- `AGENTS.md` (functional core, errors as `{ code, message }`, one schema one name, accessibility baseline)
- Spec 0003 (inventory: SettingsLayout, AttributeSettings, OptionsEditor, HuePicker, IconPicker, Meter), spec 0004 (definitions, options, limits, AC-4, AC-10, AC-11, AC-16), spec 0005 (procedures, the composer, server confirmed schema writes), spec 0006 (the definitions store), spec 0007 (AC-81, widened `definitions` rows), spec 0008 (the role column note), spec 0009 (roles, `schema.manage`, AC-135, AC-136, AC-144)
- `packages/core/src/engine/definitions.ts`, `options.ts`, `limits.ts`; `packages/contracts/src/values/attribute-config.ts`
- House skills `crm-data-model-access`, `crm-api-backend`, `crm-frontend-state`, `crm-design-system`

**Practices & standards**:
- Idempotent creates by client ids
- Archive over delete for definitions (reversible, no data loss)
- One limits module, refusing clearly
- Stable identifiers separate from display names

## Evidence

What the engine already does and what changes:

| Area | Today | Here |
|---|---|---|
| Object create | `defineObject`, slug checked, custom slot taken | client id, position, derived API name, unique names |
| Object update and archive | `updateObject`, `setObjectArchived` | procedures; paired attributes treated as archived |
| Attribute create | `defineAttribute` with config and default | client id, initial options, fifteen picker types |
| Attribute update | `updateAttribute` (title, description, required, unique, config, default) | procedure; description length check |
| Attribute archive and restore | single attribute | both ends of a relationship together |
| Attribute order | `position` set at create, never changed | `reorderAttribute` |
| Options | define, update (rename, recolour, reorder, archive, restore) | client id; restore checks room |
| Limits | custom objects counted on create and never given back; attributes counted with archived; options counted live only | unchanged rules, exposed through `usage.get` |
