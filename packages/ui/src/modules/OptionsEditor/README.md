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

- Presentational: the options come in, each change goes out; the screen decides what a change does. Before create, AttributeSettings keeps them as a draft and passes `onRemove` instead of `onArchive` and `onRestore`; after create, the screen writes each change at once and passes `pending` and `errors`. `recordCounts` (live records per option, by id, from one grouped read) puts "N records" on each row that has any; with `canMoveRecords` (a single select or a status), such a row's menu asks where they go as it archives, in the same menu rather than a dialog: "Archive, move records to <option>" for each other live option (`onArchive(id, moveTo)`), then "Archive, leave N records on it" (flow pass, 30 October 2026).
- **Add**: "Add option" (or "Add stage", "Add choice") opens a blank row with its label field focused. Enter adds it, the same row staying focused and empty for the next (the next hue after the last option's, `nextHue`, a stage open) and opens the next blank row, so a list can be typed in one go; Esc leaves the blank row; leaving it empty drops it. `startsWithBlank` opens with one (a new select), which waits for Tab rather than taking focus, so focus stays on the type picker that brought it. Its colour and outcome are set once it is added.
- **Labels**: a label commits on Enter or as focus leaves; Esc puts back what was typed. A label a live option already holds, ignoring case, is refused on the row before anything is sent. What was typed stays on screen while its change is with the server or refused, and gives way once the option changes.
- **Colour**: the compact HuePicker, one swatch that opens the nine.
- **Choices** (`kind="choice"`): plain words, a form question's Dropdown or Choice list (F27, 20 October 2026). No colour (each option's `hue` is ignored), a quiet remove button on each row in place of the menu (pass `onRemove`), no pending spinner (choices are saved with their form), and the words as text when read only. Its blank row says "Type a choice" (an option's says "Type an option" and a stage's "Type a stage", so a blank row never reads as an empty box beside a disabled Add option). With no menu, a choice moves by its handle alone (Enter on the handle, the arrows, Enter). `labelMaxLength` sets the longest label (a form's choices take 80, as their contract does; 100 when left out). Why a variant: the form builder drew its own list, a stack of fields touching each other under one "Choice 1" label; this list already reorders, adds by typing and refuses a repeat.
- **Scores** (`scores`, choices only): a small number box beside each choice, between its words and its remove, its unit `pts`: a form question's points (spec 0063, AC-6316), so each number sits by the choice it scores rather than in a row of boxes under the list that wrapped away from them on a narrow card (critique 8, 5 November 2026). `of` reads a row's number by its id, `onChange` writes one (undefined when emptied), `label` names each box. Why a variant: it is the same list, with one more control per row, as a stage's target days are. Story: `ChoicesWithScores`.
- **Stages**: an outcome Select (Open, Won, Lost) and target days (1 to 365, empty for none; anything else is refused on the field), which a line under the group's label explains.
- `onInvalidChange(isInvalid)` says when a row's own check refuses what was typed (a label taken, days out of range), so a dialog keeps its submit back meanwhile. A refused add whose row is gone (`errors.new` with no blank row open) shows its reason beside Add option.
- **Order**: drag a row by its handle, or Space or Enter on the handle, the arrows, Space or Enter (the library's drag wrapper); or Move up and Move down in the row's menu, which says the new place to screen readers ("Gold moved to 1 of 3.").
- **Archive and restore**: Archive in the row's menu; archived options sit muted in a closed "Archived" group with Restore. At the limit, Add and Restore are off and a note says why.
- Enter in any of its fields commits that field and never submits the form it sits in.

## States

Filled, empty ("No options yet", with Add option), adding (a blank row), refused (on the row's label or days), pending (a spinner on the row), full (Add and Restore off, with the note), read only (tags, a stage's outcome and target as words, a choice as its words, nothing to change). A row being dragged fades; the drop target takes the inset ring.

## Keyboard

Tab enters the list on a row; the up and down arrows move between rows, and Tab moves through a row's controls (the arrows stay in the field being typed in). On a handle, Space or Enter lifts the option, the arrows move it while the others slide out of its way, Space or Enter drops it and Esc puts it back, each step announced.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's options editor: the group's label in `text-body-sm-strong` and `text`, "N of 500" beside it in quiet `text-label` with tabular figures, then the rows on one `surface-subtle` tray (`space-6` in, `radius-md`), `space-2` apart, each a white `surface` strip `size-control` tall and `space-2`/`space-4` in from its ends, as the prototype's rows are. A row's label is the library's Field, whose filled box shows on the strip at rest, deepens under the pointer and turns white with its `accent-text` edge and `accent-border` ring when typed in. The keyboard's row takes the outline ring just inside it (the rows sit `space-2` apart, where a ring outside one would cover the next); a row being dragged lifts (`surface-raised`, `shadow-md`). The notes and errors under the list are `text-caption`. In forced colours the ring is Highlight and a lifted row is outlined.

**Use it for** a select's or multi select's options and a status's stages (in AttributeSettings, or on their own), and a form question's choices (`kind="choice"`). **Don't use it for** reordering fixed choices (SortBuilder, ViewSettings).

**The consumer provides** `label`, `kind` (`select`, `status` or `choice`), `options` (`{ id, label, hue, isArchived, outcome?, targetDays? }`), `limit`, `newId`, `onAdd`, `onChange`, `onMove`, `onArchive` and `onRestore` (or `onRemove` for drafts and choices), and as needed `pending`, `errors`, `recordCounts` with `canMoveRecords`, `startsWithBlank`, `hint`, `labelMaxLength`, `scores`, `isReadOnly` and `onInvalidChange`.

**States**: rows at rest, a row focused (the ring), a name typed in, a repeated name refused on its row, dragging (lifted), a new row (typed in, Enter adds the next), archived (in the Archived fold with Restore), empty, full, pending, read only. Stories: Default, Stages, AddByTyping, LabelTaken, Rename, RowFocus, ReorderByKeyboard, MenuMoveAndArchive, Draft, Full, PendingAndRefused, Empty, ReadOnly, Choices and the rest above.

**Interaction**: Add option opens a blank row with its field focused; Enter adds it and opens the next; Esc puts a name back or leaves the blank row. The colour opens HuePicker's nine hues. Drag by the grip, or Space or Enter on it, the arrows, Space or Enter to drop, Esc to put it back, each step announced.

**Differences from the prototype**
- The label Field keeps its filled box on the white strip, where the prototype's name input is transparent at rest and fills only under the pointer. That needs a Field `inline` look (transparent at rest, `surface-subtle` under the pointer), owed to Field; until then the strip holds a box (the design system review of tier 3b chose the strip, since without it the label's box vanished into the tray at 1:1).
- A status's stages are one list with an outcome (Open, Won, Lost) and target days per stage, not the prototype's three groups (Not started, In progress, Done) with a stage dragged between them, so there are no group heads, counts or "Drop a stage here" boxes.
- The archive is in each row's menu (with Move up, Move down and moving its records), not a hover-revealed button, and an archived option goes to a closed Archived fold with Restore rather than "Gold archived · Undo" in place; so no collapse after 5 seconds.
- Rows do not drop in with the prototype's height and rise animation: the GridList's rows are drawn by React Aria's collection, and the motion would need a wrapper per row. Owed to the settings screen phase.
- The swatch is HuePicker's compact trigger (a phase 2 part), not the prototype's own round button.
- Kept beyond the prototype: `limit` and "N of 500", choices with scores, `pending` spinners, `errors` from the server, record counts and moving records on archive, read only tags, `onInvalidChange`.
