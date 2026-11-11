The view toolbar: filter chips, sorts and view settings for a table or board, plus the line that says how many records the filters hide.

**Use it for**: the bar above every table and board view. **Don't use it for** a global search (that is the command palette) or for one-off forms.

**The consumer provides**: `fields` (id, name, type (select, status, person, text, number, date), icon, options, and `section` for a related record's field, which reads "Company › Industry"), controlled `filters`/`onFiltersChange`, `sorts`/`onSortsChange`, `columns`/`onColumnsChange`, `density`/`onDensityChange`, `hiddenCount`, `totalCount` and the plural `noun`. The screen counts; the bar only shows. With `match` and `onMatchChange`, the word between chips becomes a switch: and (every filter) or or (any one); without them it reads "and".

With `groups` and `onGroupsChange`, "Filter" also offers "Add a filter group": bracketed chips with their own and/or, a + to add to the group and × to drop it. `viewOptions` puts the screen's own settings (group by, board totals, card fields) at the top of the View popover. Operators: is, is not, is empty, is not empty for choices; contains, does not contain, is for text; greater, less, between, is for numbers; before, after, between, in the last N days, in the next N days for dates.

**States**: no filters, chips, a part's popover open (the part stays pressed), clearing, cleared ("Showing all 32 companies"), sorts, view settings open, a locked column ("Always first"); columns reorder by dragging their grip (SortableList on lib/drag.ts; or Space on the grip, arrows, Space).

**Interaction**: a chip reads "Stage · is · Qualified ×" and each part is its own button: field and operator each open the shared Menu (the tick draws, then it closes 120ms later), value opens a Menu of choices that stays open while you toggle them, or a small Popover with a TextField for text and amounts; × removes. "Filter" walks field, then operator, then values in one popover that eases to each step's height (01 card resize). Choice values toggle and stay open; text applies on Enter. A sort pill flips direction on press, the arrow swapping (09 icon swap). Clear dissolves the chips (13 input clear: down 12px, a soft streak, 1000ms) while the new line falls in. Everything opens in the shared Popover and Menu (05 dropdown). Everything is reachable with Tab, arrows, Enter and Esc.

**Replaces**: FilterChip, FilterBuilder, ConditionRow, SortBuilder, ViewSettings.
