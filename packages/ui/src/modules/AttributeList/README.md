# AttributeList

A record's details: a row per attribute, its name beside its value, each value shown and edited in place.

## Why it exists

New. The record page and the record panel (#18) list a record's attributes. `DescriptionList` shows fixed label and text pairs and edits nothing; this draws each value through `AttributeDisplay` and edits it through `AttributeEditor`, on the `panel` surface, so a value looks and edits the same as in a grid cell. Titled sections fold through `Disclosure`.

## Use

```tsx
<AttributeList
  label="Details"
  sections={[
    { id: 'details', items: [{ attribute: stage, value: leadStatusId }] }, // a status value is its option's uuid
    { id: 'more', title: 'More', items: moreItems },
  ]}
  onCommit={(attributeId, value) => update(record, attributeId, value)}
  editorProps={(attribute) => ({ onSearch: searchFor(attribute) })}
/>
```

- Each item is an attribute, its value, the `display` shapes references need (names and pictures from the data layer), and an optional `error`, a refusal shown under the value.
- A click on a value (not on a link inside it) opens its editor in place; so does its pencil button, which shows on hover and on focus. Typed values commit on Enter or on leaving; a single choice (a status, a date) commits on the pick; a list of several stays open until you leave it or press Esc.
- A checkbox toggles where it is.
- `actions` (a node, usually a ⋯ MenuTrigger) sits at the end of the list's foot, after Show N empty values: a record page's Add attribute and Manage attributes for schema managers (flow pass, 30 October 2026). Why a slot: the list has no header, and a ⋯ at its foot keeps the values first.
- `emptyValues="fold"` puts rows with nothing in them behind "Show N empty values" at the list's foot (it becomes "Hide empty values", with `aria-expanded`), so the filled values read first, as Attio's Show all values and HubSpot's View all properties do. Required rows, toggles and rows with an error always show, a row that has shown a value stays while the list lives (give the list a `key` per record), and a record with three filled rows or fewer (a new deal: its name, stage and owner) opens with every row shown, since filling it in is the task. The button names the list it opens (`aria-controls`). A shown empty row keeps its "Set Name…" (or a read only row's "Not set") blank until the row is under a pointer or holds focus (touch screens keep it shown), and its pencil button is still in the tab order. Why a variant: the record page listed "Set Phone numbers…", "Set LinkedIn…" and ten more on every new record (the owner, 22 October 2026); `show`, the default, keeps every other list as it was.
- Leave out `onCommit` for a list nobody can edit. A value that is read only on its own (computed, set by the system) has a small `LockReason` (`size="sm"`) after its name: a lock whose tooltip says why, on hover and on keyboard focus. It sat after the value before, where beside an empty value it read as a loose dash and lock (the owner's call, 20 October 2026).
- An empty value that can change reads "Set Stage…"; an empty value that can't reads "Not set", quietly, never a lone dash.
- Each name sits at the top of its row, level with the first line of its value, so a value or an editor that grows taller (a textarea, a hint under a field, chips that wrap) never moves its name.
- `isLoading` shows skeleton rows after the loading delay.
- Below 320px wide the name sits above the value (a container query), so it fits a narrow panel.
- A long name ("Associated company") wraps to a second line instead of ending in an ellipsis that hid the rest; two label lines fit the row (QA, 22 October 2026).

Each name sits after its type's icon on a small gray tile (`Icon` with `tile`, 13 Oct reference batch 4), so a long list reads by its shapes at a glance.

- An empty read only row says its type's `emptyWord` where it has one (an interaction's "No contact"), else "Not set". A long text clamps to six lines with Show more here. Email, phone, domain, URL and text values show Copy after them on hover or focus (`ValueActions`). A screen gives Create inline through `FieldActionsContext` around the list.

## States

Default, empty values ("Set Stage…", or "Not set" when read only), editing, read only (a small lock after the name, with its reason), an error under a value, loading. Hover on a value (pointer only), focus on its pencil button.

## Keyboard

Tab moves through each value's links and its pencil button; a read only value's lock, after its name, is a stop before the value. Enter or Space on the pencil opens the editor, focused. Enter commits a typed value, Esc cancels, and both bring focus back to the pencil. Space toggles a checkbox.

## Differences from the artifact

The artifact's record page shows details as a static list; this edits in place.

## Timefix prototype (spec 0072)

Takes its look from the prototype's DescriptionList (spec 0072), which replaces it: the fixed name column (136 at full size, `4 * size-control - space-8`), the type's icon on its grey tile and the name in `text-body-sm` and `text-secondary`, each row a control tall with the name level with the value's first line, the value washing `surface-hover` (`radius-md`, `space-8` in) under the pointer, the pencil fading in on the row's hover or focus. Errors read `text-body-sm`.

**States**: filled, empty ("Set Name…" in `text-tertiary`, quiet until hovered in a folded list), hover, editing (the field set's editor in place), read only (a lock with its reason, "Not set" when empty), loading, folded (Show N empty values).

**Differences from the prototype**: a click on the value or the pencil opens the attribute type's own editor (the field set), not the prototype's crossfading text field; the copy button on email, phone and website rows is the value display's own. Kept: folding empty values, the list's actions, the lock and its reason, the narrow layout (name over value under 320px).

**Repeats from its replacer** (AC-4): the row's grid, the name's type and colour and the value's hover wash, as DescriptionList's rows draw them; it can't render DescriptionList, which is read only. They leave with this export.
