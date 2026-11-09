The view toolbar: filter chips, sorts and view settings for a table or board, plus the line that says how many records the filters hide.

**Use it for**: the bar above every table and board view. **Don't use it for** a global search (that is the command palette) or for one-off forms.

**The consumer provides**: `fields` (id, name, type, icon, options), controlled `filters`/`onFiltersChange`, `sorts`/`onSortsChange`, `columns`/`onColumnsChange`, `density`/`onDensityChange`, `hiddenCount`, `totalCount` and the plural `noun`. The screen counts; the bar only shows.

**States**: no filters, chips, a part's popover open (the part stays pressed), clearing, cleared ("Showing all 32 companies"), sorts, view settings open, a locked column ("Always shown").

**Interaction**: a chip reads "Stage · is · Qualified ×" and each part is its own button: field and operator each open the shared Menu (the tick draws, then it closes 120ms later), value opens a Menu of choices that stays open while you toggle them, or a small Popover with a TextField for text and amounts; × removes. "Filter" walks field, then operator, then values in one popover that eases to each step's height (01 card resize). Choice values toggle and stay open; text applies on Enter. A sort pill flips direction on press, the arrow swapping (09 icon swap). Clear dissolves the chips (13 input clear: down 12px, 2px blur, a soft streak, 1000ms) while the new line falls in. Everything opens in the shared Popover and Menu (05 dropdown). Everything is reachable with Tab, arrows, Enter and Esc.

**Replaces**: FilterChip, FilterBuilder, ConditionRow, SortBuilder, ViewSettings.
