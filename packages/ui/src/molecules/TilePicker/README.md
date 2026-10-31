# TilePicker

One of a set of kinds, all in sight as tiles under their headings: a new attribute's type.

## Why it exists

New (the owner, 31 October 2026, item 92: "less friction, more UI, more understandable"). A new attribute's Type was a Select opening on Text, so nobody saw what kinds of field there are until they opened it. The picker shows every type at once, grouped (Basic, Contact, Choice, Relation, Computed), each with its icon and three or four words, and picking one is the first step of the form under it.

Why not the closest components:
- **Select** hides its choices in a popover; the point here is that they are all seen. A variant that drew Select's list in place would be a second component inside Select's file.
- **Radio `variant="cards"`** is a radio group: no headings between runs of choices, two cards a row with room for a sentence each, and twenty of them would be a page tall.
- **IconPicker** is a grid ListBox of bare icons with a search, for one object's icon.

It wraps React Aria's `ListBox` with `layout="grid"`, its sections and headers, as IconPicker does.

## Use

```tsx
<TilePicker
  label="Type"
  value={type}
  onChange={setType}
  items={[
    { id: 'text', label: 'Text', icon: 'type', hint: 'A line of words', group: 'Basic' },
    { id: 'email', label: 'Email', icon: 'at-sign', hint: 'An email address', group: 'Contact' },
  ]}
/>
```

- A tile is a row tall: its icon and its name. Each reads as an option by its `label` alone ("Text"), with its `hint` as the description, so a test or a screen reader finds it by the same name a Select option had. The chosen tile's name and hint show as one quiet line under the tiles: twenty tiles each carrying their words made the dialog taller than the screen and pushed Name out of sight (browser check, 31 October 2026).
- Items are gathered by `group`, each section where its first item stood and its items in their order. Items without a `group` come under no heading.
- Four tiles a row, two in a slot under 480px (a container query).
- `error` says under the tiles why the choice can't stand.

## States

Rest, hover (pointer only, surface-hover), focus (the inset ring; an outline in forced colours), selected (the accent's soft fill and the accent line's edge, as Radio's cards, its icon in the accent, and its words under the tiles), disabled (every tile faded; its label stays readable, since it names a list rather than a disabled control), and an error line.

Not here, on purpose: read only, since an attribute's type that can't change shows as a read only Select (AttributeSettings when editing), one line rather than twenty tiles of which one counts; loading and a failed load, since the items are props the caller already holds; and empty, since a picker with nothing to pick isn't drawn (a caller with no items leaves it out).

## Keyboard

Tab reaches the chosen tile; the arrow keys move through the grid, across headings; Enter or Space picks the focused tile. Typing a name's first letters moves to it.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
