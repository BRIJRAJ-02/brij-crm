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
- `emptyValues="fold"` puts rows with nothing in them behind "Show N empty values" at the list's foot (it becomes "Hide empty values", with `aria-expanded`), so the filled values read first, as Attio's Show all values and HubSpot's View all properties do. Required rows, toggles and rows with an error always show, a row that has shown a value stays while the list lives (give the list a `key` per record), and a record with three filled rows or fewer (a new deal: its name, stage and owner) opens with every row shown, since filling it in is the task. The button names the list it opens (`aria-controls`). A shown empty row keeps its "Set Name…" (or a read only row's "Not set") blank until the row is under a pointer or holds focus (touch screens keep it shown), and its pencil button is still in the tab order. Why a variant: the record page listed "Set Phone numbers…", "Set LinkedIn…" and ten more on every new record (the owner, 22 October 2026); `show`, the default, keeps every other list as it was.
- Leave out `onCommit` for a list nobody can edit. A value that is read only on its own (computed, set by the system) has a small `LockReason` (`size="sm"`) after its name: a lock whose tooltip says why, on hover and on keyboard focus. It sat after the value before, where beside an empty value it read as a loose dash and lock (the owner's call, 20 October 2026).
- An empty value that can change reads "Set Stage…"; an empty value that can't reads "Not set", quietly, never a lone dash.
- Each name sits at the top of its row, level with the first line of its value, so a value or an editor that grows taller (a textarea, a hint under a field, chips that wrap) never moves its name.
- `isLoading` shows skeleton rows after the loading delay.
- Below 320px wide the name sits above the value (a container query), so it fits a narrow panel.

Each name sits after its type's icon on a small gray tile (`Icon` with `tile`, 13 Oct reference batch 4), so a long list reads by its shapes at a glance.

## States

Default, empty values ("Set Stage…", or "Not set" when read only), editing, read only (a small lock after the name, with its reason), an error under a value, loading. Hover on a value (pointer only), focus on its pencil button.

## Keyboard

Tab moves through each value's links and its pencil button; a read only value's lock, after its name, is a stop before the value. Enter or Space on the pencil opens the editor, focused. Enter commits a typed value, Esc cancels, and both bring focus back to the pencil. Space toggles a checkbox.

## Differences from the artifact

The artifact's record page shows details as a static list; this edits in place.
