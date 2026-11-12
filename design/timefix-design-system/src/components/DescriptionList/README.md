A record's attributes as rows: an icon well and grey label on the left, the value on the right, edited in place.

**Use it for**: the record page and record panel details, booking and form submission details, any label and value pairs. **Don't use it for** editing many fields at once (a form) or tabular data (DataGrid).

**The consumer provides**: `label` and `items`, each with `id`, `label`, a Lucide `icon`, a `type` (`text`, `email`, `phone`, `url`, `number`), `value`, an optional `placeholder`, `isReadOnly`, or `display` for a value drawn by another component (a Tag, a PersonLine, a RecordChip; those rows don't edit inline). `onChange(id, value)` saves; leave it out for a read-only list.

**States**: filled, empty ("Add location" in tertiary text), hover (grey wash on the value), focus, editing, read only, copied.

**Interaction**: a click or Enter on a value swaps in a filled field with a quick crossfade (150ms in-out), focused with the accent edge and ring. Enter or leaving the field saves, Esc drops the change, and focus returns to the value. Email, phone and website rows show a copy button on hover or focus (always on touch); its icon swaps to a green check for 1.6s (09 icon swap). Labels sit at the top of their row so a taller value never moves them.

**Replaces**: DescriptionList, AttributeList.
