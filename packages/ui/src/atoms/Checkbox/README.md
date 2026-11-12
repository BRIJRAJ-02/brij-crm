# Checkbox

A real checkbox with a label, a description, and an indeterminate state, and its mark alone for displays.

## Why it exists

Ported from the artifact's Checkbox card (version 8). Forms, settings, table selection ("select all") and the checkbox attribute all use it. `Checkbox` wraps React Aria's `Checkbox`, so a real input sits under the box. `CheckboxMark` draws the same box with no input, for the checkbox attribute's display and the grid's selection column, where something else is the control.

## Use

```tsx
<Checkbox label="Send a weekly digest" description="Every Monday at 9:00." />
<Checkbox label="Select all" isLabelHidden isIndeterminate />
```

- `label` is required; `isLabelHidden` keeps it for screen readers only (table headers and rows).
- `isIndeterminate` shows a dash when some but not all are checked.
- `error` marks it invalid and says how to fix it, under the box. Drawn by the shared FieldError atom: the alert mark, then the words (5 November 2026).
- As the checkbox attribute's editor, it toggles in place and never clears: unchecked is `false`.
- `CheckboxMark` is the same look with no control. The checkbox attribute's display and the grid's selection column draw it, where the cell is the control (Space, or a click on the mark), so a scroll past hundreds of rows mounts no checkbox per row. Screen readers hear its label and state ("Is customer, checked"). Leave `label` out where the row around it already names itself and its state (an option in a `Select` with `showsMarks`). It stays inside the library: screens draw a checkbox value through `AttributeDisplay`.

- `slot="selection"` puts it in a selectable Table's selection column: the table says whether it is checked, and the header's is indeterminate while some rows are picked.
- `CheckboxRow` (its own file and stylesheet, so the hosted form never loads it) draws it as a full width row, after checklabs' add-on rows (the guest menu's dish sheet, under `RadioRowsGroup` for the sizes): a hairline round it at 16px corners, a 20px box with 6px corners and a 1.75px edge and its tick half as bold again, the label at 15px, and its `description` at the row's end in the quiet colour (an add-on's +£1.50), still read as its description. A checked row takes the accent's line and soft fill, the whole row toggles it, the row's fill says hover, focus rings the row, and a row that is off drops its chosen fill and line while its box and label fade (its price stays readable). A press eases the row down to `--scale-press-sm` on `--ease-press` (1 in the app; the guest menu sets checklabs' 0.985 and its overshoot). The caller stacks the rows (10px apart on the dish sheet) inside its own fieldset. Why a variant of Checkbox: the library has no CheckboxGroup (a group of checkboxes is a fieldset its screen draws), so the row look belongs to the one checkbox, as `RadioRowsGroup` belongs to its group.

### Leading

`leading` puts something after the box, inside the control so pressing it toggles the box too, hidden from screen readers (the label says it). With `isLabelHidden` it is the visible name: the calendars list passes a StatusDot (the calendar's colour dot and name), which shrinks and cuts a long name with an ellipsis. Why: the owner wants the plain box with the calendar's colour as a small dot before its name (22 October 2026); a dot outside the control would not toggle, and the label is a string.

## States

Unchecked, checked, indeterminate, hover (pointer only), focus, pressed (no shrink, owner 20 Oct 2026), invalid, read only, disabled. The mark has unchecked, checked, indeterminate and read only; whatever holds it draws the focus.

## Keyboard

Space toggles it. Tab moves on. The mark takes no keys or focus; its owner (a grid cell) handles Space.

## Differences from the artifact

- React Aria's props replace the input attributes: `isSelected`, `onChange(isSelected)`, `isDisabled`, `isReadOnly`.
- `error` (a sentence) replaces `invalid`. The tick is Lucide's `check` through the Icon atom.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Checkbox: an 18px box (`space-16` and `space-2`) with a 1.5px `control-border` edge on the surface; checked and indeterminate fill it with the accent. The tick draws itself in from the start over `--duration-medium`, a stagger after the fill (transitions.dev 25), by its clip, so it draws on a change and never on the first paint. Hover darkens the edge, the focus ring sits 2px out, invalid edges in red, disabled fades. Nothing scales when pressed.

**Differences from the prototype**: the prototype's `round` (a task's done circle, its label struck through) is owed to the tasks phase. `leading`, `description`, `look`, CheckboxRow and CheckboxMark (a grid's mark, which never animates, so rows scrolling in don't draw their ticks) are kept.
