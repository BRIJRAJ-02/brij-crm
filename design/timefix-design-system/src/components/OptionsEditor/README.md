A select's options or a status's stages, in order: each a colour, an editable name and a grip.

**Use it for**: the options of select, multi-select and status attributes, inside AttributeSettings' drawer or on its own. **Don't use it for**: a form question's plain choices without colour, or reordering fixed choices (sort, view columns).

**The consumer provides**: `kind` (`select`, or `status` for Not started, In progress and Done groups), `options` (`EditableOption`: id, label, hue, shape, group, archived), `onChange` with the whole new list, and an optional `label`.

**States**: rows at rest and hovered (grip and archive appear), name focused, duplicate name (red edge and a line under the list), dragging, a new row, archived in place ("Gold archived · Undo"), archived shelf ("2 archived" menu to restore), empty status group ("Drop a stage here").

**Interaction**: Add option drops a row in (0fr to 1fr, 12px rise, 250ms) and focuses it; Enter in a name adds the next, Esc puts the name back, leaving a blank row drops it. The swatch opens the nine hues in a Popover (menu dropdown 05), stays pressed while open and closes 120ms after a pick. Drag by the grip, or Enter on the grip, arrows, Enter; a stage dragged to another group takes that group's shape, and the drop settles over 250ms. Archive collapses to Undo for 5 seconds, then the row folds away (accordion 21).

**Replaces**: OptionsEditor.

**Stage rules**: an option can also carry `outcome` (`won` or `lost`) and `targetDays` (its target time in stage). The editor keeps them as they are; Settings › Objects sets them beside the stages.
