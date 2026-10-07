# 0020. The view config, effective columns and queries, and the draft

## Summary

A view stores one small JSON config: its columns, how many are pinned, its filter, its sorts and (for a board) its board settings. The browser never runs that config as stored. Two pure functions in `@crm/contracts` work out what actually runs today, leaving out attributes that were archived or deleted, and adding attributes created since the view was saved. A draft is the same filter and sorts written into the address bar. A layout saved by someone who can't see every column is merged so nothing they can't see is lost.

## The shape (`packages/contracts/src/views.ts`)

```ts
export const ViewColumn = z.strictObject({
  attributeId: z.uuid(),
  width: z.number().int().min(1).max(2000).optional(),  // pixels; the grid clamps to its size tokens
  isHidden: z.boolean().optional(),
});

export const BoardConfig = z.strictObject({                 // filled by #21 (spec 0021)
  groupByAttributeId: z.uuid(),
  cardFields: z.array(z.uuid()).max(6),
  showEmptyColumns: z.boolean(),
});

export const ViewConfig = z.strictObject({
  columns: z.array(ViewColumn).max(250),                    // each attribute at most once (refine)
  showNewAttributes: z.boolean(),
  pinnedCount: z.number().int().min(1).max(5),
  filter: FilterGroup.optional(),
  sorts: SortRules,
  board: BoardConfig.optional(),
});
export type ViewConfig = z.infer<typeof ViewConfig>;

export const ViewLayout = z.strictObject({
  kind: z.enum(['table', 'board']).optional(),
  columns: z.array(ViewColumn).max(250),
  pinnedCount: z.number().int().min(1).max(5),
  board: BoardConfig.optional(),
});
```

- The whole config, serialised, is at most 64 kB (`CONFIG_INVALID` "This view has too many settings to save." past it).
- Server checks on every write: every attribute id in `columns`, `sorts`, `board` and the filter (at every depth; the first hop of a through path) belongs to the view's object; a through path's later hops belong to the object the hop before leads to; each sort's attribute passes `isSortable(attribute)` (`@crm/contracts`, true exactly for the types and system columns `compileSorts` has a key for; `compileSorts`, SortBuilder's attribute list and `ViewConfig`'s refine all call it, so they can't disagree). A failure answers `CONFIG_INVALID` "That attribute isn't on <plural>." or `FILTER_INVALID` as the compiler words it.
- `showNewAttributes` is not editable in the UI in v1: `true` on seeded default views, `false` on views created by members (a duplicate copies it).

## Effective columns (`effectiveColumns(config, attributes)`)

Input: the stored config and the object's attributes from the definitions store (archived ones flagged, hidden ones already absent). Output: the grid's `columns` and `pinnedCount`.

1. Start from `config.columns` in order. Drop entries whose attribute is archived (directly or by its far object, spec 0012), deleted, or absent (hidden).
2. Append every live attribute not in `config.columns`, in attribute `position` order: shown when `showNewAttributes` is true and the attribute is non system or is Created at; hidden otherwise.
3. Move the primary attribute's column to the front, shown, whatever the config says.
4. `pinnedCount` = the stored value, clamped to the number of shown columns, never below 1.
5. Width: the stored `width`, else `columnWidthOf(attribute)` from the field set.

An empty `columns` with `showNewAttributes` (the seeded default) therefore follows the attribute order of the settings page exactly.

## Effective query (`effectiveQuery(query, attributes)`)

Input: `{ filter?, sorts }` (saved or draft) and the object's attributes, plus a resolver for the attributes of related objects. Output: `{ status: 'ready', filter?, sorts, skipped: attributeId[] }`, or `{ status: 'pending' }` while a through path's far attributes are loading.

- A condition is removed when its attribute (or any attribute along its through path) is archived, deleted or absent. A group left with no conditions is removed; a top level group left empty means no filter.
- A sort on such an attribute is removed.
- Empty sorts (stored empty, or emptied by the removals above) run as `[{ attributeId: <Created at>, direction: 'descending' }]`, so every view lists newest first (spec 0006 AC-57). The stored sorts stay empty, and the SortChip shows the dashed "Sort" button.
- Attributes along a through path come from `definitions.attributes(farObjectId)`, which loads an object's attributes on first ask (spec 0006). Until every object a condition passes through has loaded, `effectiveQuery` answers `pending` and the screen shows its loading state without opening a window; it never treats a not yet loaded attribute as deleted.
- `skipped` lists the removed attribute ids that are archived and still visible; it drives the Callout of AC-480 (with the attribute's title). Absent ones are never named.
- The browser runs only the effective query; `records.query` would refuse the rest anyway.

## Draft in the URL

- Search param `draft` on `/w/$slug/objects/$object/views/$viewId`. Value: `encodeDraft({ filter, sorts })` = canonical JSON (object keys sorted, no whitespace), UTF-8, base64url without padding.
- The route's `validateSearch` decodes it with `decodeDraft`, which parses with `FilterGroup` and `SortRules`; any failure drops the param (AC-467's toast).
- The draft exists while `canonical(draft) !== canonical(saved query)`. Setting it back equal removes the param.
- Changing filter or sorts replaces the URL entry (`replace: true`) for edits inside a Popover, and pushes one history entry when the Popover closes, so back steps through filter changes, not keystrokes.
- An edit to a condition's operand (typing a value) reaches the draft, and so the window key, 300 ms after the last keystroke (`FILTER_EDIT_MS`); choosing an attribute, an operator or an option applies at once. When the key changes, the superseded window's requests in flight (blocks and count) are aborted, so typing never fills the workspace's 6 query slots.
- Over 6,000 encoded characters: the draft stays in the route's memory state for this visit, the param is removed, and "Copy link" is disabled with its reason.
- `baseQueryVersion`: the `queryVersion` of the saved view when the draft began, kept beside the draft in the route state (not in the URL). A draft opened from a link takes the `queryVersion` of the view as loaded.

## Merging a layout from someone who can't see everything (`mergeLayout`)

`mergeLayout(stored, incoming, visibleIds)` in `packages/core/src/views/layout.ts`, pure:

1. `hidden` = stored columns whose attribute is not in `visibleIds`, each remembered with the visible column that preceded it in the stored order (or "start").
2. Result = `incoming.columns`, then each hidden entry inserted right after its remembered predecessor (or at the start), in their stored order. A predecessor the writer removed is replaced by the nearest earlier visible one.
3. `cardFields` follow the same rule. A hidden `groupByAttributeId` can't occur (the view is absent for that member).
4. `pinnedCount` is the incoming value plus the number of hidden entries inserted before the pinned boundary.

## Visible to this member (`viewVisible(access, view, attributes)`)

`packages/core/src/views/visible.ts`, pure. A view is visible when:
- it is shared, or its `creator_member_id` is the caller;
- its object is at `read` or `write` for the caller;
- every attribute in its filter (every depth, every hop), its sorts and `board.groupByAttributeId` is visible (`fieldLevel` is not `hidden`);
- every record id in its filter operands (`is`, `is_any_of` and the like on record references) is visible to the caller (`recordVisible`, one batched read per `views.list`).

Archived attributes don't make a view invisible; they make it run with a hole (AC-480).

On the live path, spec 0009's `filterEvent` decides per audience with the facts `viewFacts(viewIds)` reads (creator and visibility per view); until #24 adds rules that hide attributes or records, those two facts are all it needs (Follow-up for #24).

## Tests

- Unit: `effectiveColumns` (new attributes with the flag on and off, archived, hidden, primary first, pin clamp), `effectiveQuery` (nested groups, through paths, empty groups removed, empty sorts run newest first, `pending` while far attributes load, `skipped` names only visible archived ones), `isSortable` against `compileSorts` for every type, `encodeDraft` and `decodeDraft` round trips and refusals, `mergeLayout` (hidden entries keep their place, predecessor removed, pin count), `viewVisible` across the grid of rules.
- Real Postgres: config checks refuse another object's attribute and an unsortable sort; the 64 kB cap.

## Rationale (short)

Keeping the stored config untouched by archives and access rules, and working out what runs at read time, means an admin restoring an attribute or #24 changing a rule never needs a migration of views, and two members with different access can share one view without either breaking it for the other.
