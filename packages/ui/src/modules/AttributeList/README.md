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
- Leave out `onCommit` for a list nobody can edit. A value that is read only on its own (computed, set by the system) shows a `LockReason`: a lock whose tooltip says why, on hover and on keyboard focus.
- An empty value that can change reads "Set Stage…".
- `isLoading` shows skeleton rows after the loading delay.
- Below 320px wide the name sits above the value (a container query), so it fits a narrow panel.

## States

Default, empty values, editing, read only (with a lock and its reason), an error under a value, loading. Hover on a value (pointer only), focus on its pencil button.

## Keyboard

Tab moves through each value's links and its pencil button. Enter or Space on the pencil opens the editor, focused. Enter commits a typed value, Esc cancels, and both bring focus back to the pencil. Space toggles a checkbox.

## Differences from the artifact

The artifact's record page shows details as a static list; this edits in place.
