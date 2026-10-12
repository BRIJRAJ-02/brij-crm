# OptionsEditor

A select's options or a status attribute's stages, in order: each a colour, a label, and for a stage an outcome and a target in days.

## Why it exists

New (from the inventory, `0003-inventory.md`, pulled forward from spec 0003's milestone 4 by spec 0012). AttributeSettings needs the options of a new select, the starter stages of a new status (AC-230), and the options of an existing one (AC-236), and they all move, recolour, archive and restore the same way. No component held a reorderable list of editable rows with a colour per row: SortBuilder and ViewSettings reorder fixed choices, and Table rows don't take text fields. It is a React Aria `GridList` with drag and drop (the same `reorder` helper and `DragHandle` as SortBuilder), and its controls are Field, the compact HuePicker, Select, Menu, Button, Tag and Disclosure.

## Use

```tsx
<OptionsEditor
  label="Options"
  kind="select" // or "status": each stage also takes an outcome and target days
  options={options} // every option in order, archived ones included
  limit={500} // "3 of 500"; Add option stops at it
  newId={mintId}
  onAdd={(option) => …} // a new option: its label typed, the next hue, a stage open
  onChange={(id, change) => …} // { label } | { hue } | { outcome } | { targetDays: number | null }
  onMove={(id, position) => …} // its place in the whole order, archived options counted
  onArchive={(id) => …}
  onRestore={(id) => …}
  pending={new Set(['gold'])} // a spinner on rows whose change is with the server
  errors={{ gold: 'An option with that label already exists. Pick another label.' }}
/>
```

- Presentational: the options come in, each change goes out; the screen decides what a change does. Before create, AttributeSettings keeps them as a draft and passes `onRemove` instead of `onArchive` and `onRestore`; after create, the screen writes each change at once and passes `pending` and `errors`.
- **Add**: "Add option" (or "Add stage") opens a blank row with its label field focused. Enter adds it (the next hue after the last option's, `nextHue`, a stage open) and opens the next blank row, so a list can be typed in one go; Esc leaves the blank row; leaving it empty drops it. `startsWithBlank` opens with one (a new select), which waits for Tab rather than taking focus, so focus stays on the type picker that brought it. Its colour and outcome are set once it is added.
- **Labels**: a label commits on Enter or as focus leaves; Esc puts back what was typed. A label a live option already holds, ignoring case, is refused on the row before anything is sent. What was typed stays on screen while its change is with the server or refused, and gives way once the option changes.
- **Colour**: the compact HuePicker, one swatch that opens the nine.
- **Stages**: an outcome Select (Open, Won, Lost) and target days (1 to 365, empty for none; anything else is refused on the field), which a line under the group's label explains.
- `onInvalidChange(isInvalid)` says when a row's own check refuses what was typed (a label taken, days out of range), so a dialog keeps its submit back meanwhile. A refused add whose row is gone (`errors.new` with no blank row open) shows its reason beside Add option.
- **Order**: drag a row by its handle, or Enter on the handle, the arrows, Enter; or Move up and Move down in the row's menu, which says the new place to screen readers ("Gold moved to 1 of 3.").
- **Archive and restore**: Archive in the row's menu; archived options sit muted in a closed "Archived" group with Restore. At the limit, Add and Restore are off and a note says why.
- Enter in any of its fields commits that field and never submits the form it sits in.

## States

Filled, empty ("No options yet", with Add option), adding (a blank row), refused (on the row's label or days), pending (a spinner on the row), full (Add and Restore off, with the note), read only (tags, a stage's outcome and target as words, nothing to change). A row being dragged fades; the drop target takes the inset ring.

## Keyboard

Tab enters the list on a row; the up and down arrows move between rows, and Tab moves through a row's controls (the arrows stay in the field being typed in). On a handle, Enter picks the option up, the arrows choose where, Enter drops it and Esc cancels.

## Differences from the artifact

Not in the artifact.
