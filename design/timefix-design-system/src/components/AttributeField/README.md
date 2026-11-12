The field system: one display and one editor for each attribute type, identical in tables, record pages, forms and filters.

**Use it for**: every value a record holds. `AttributeDisplay` draws a value, `AttributeEditor` edits one, and `AttributeField` puts them together as a value that edits in place (record panels, the gallery). **Don't** draw a value with a raw Tag, chip or link, or build a second editor for a type; fix the type here instead.

**The consumer provides**: an `attribute` (`name`, `type`, plus `options` for select, multi-select and status, `currency`, `candidates` for record and person, `isAI`, `readOnlyReason`), the `value`, and `onChange` (or `onCommit`/`onCancel` for the bare editor). Selects hold option ids, dates ISO days, percents fractions.

**States**: empty ("Add industry…" in text-tertiary in place, blank elsewhere), value, several values (+n), AI filled (violet sparkle), read only (lock on hover, timestamps), invalid (red edge, hint, shake), editing (filled input, white with an accent edge on focus).

**Interaction**: press or Enter to edit. Typed fields commit on Enter or leaving and Esc puts the value back; an invalid email, link, domain or phone shakes (6px, 280ms) and says how to fix it. Lists open under the value in the shared Popover and Menu rows (menu dropdown, 250ms in, 150ms out), people and records with a search box; a pick draws its tick and closes 120ms later. Dates open the shared Calendar. Dates read "13 Nov" (`formatDate`), timestamps "13 Nov, 2:05 PM" (`formatClock`). Checkboxes, ratings and files change in place; stars preview the hovered rating. A saved value washes `accent-soft` once.

Record values draw with the shared `RecordChip`.

**Replaces**: AttributeDisplay, AttributeEditor, every fields/* type folder, Rating, ListEditor.
