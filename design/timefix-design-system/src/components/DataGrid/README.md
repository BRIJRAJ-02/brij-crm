The record table: a spreadsheet-grade grid of one object's records, with a pinned name column, checkbox selection and values edited in place.

**Use it for**: every object's table view, lists, and small read-only tables such as an import preview (mark the columns `isReadOnly`). **Don't use it for** settings with a few fixed rows (use a bordered section card) or for anything that is not records.

**The consumer provides**: `label`, `columns` (id, name, type, Lucide `icon`, `width`, `options` for select and status), `rows` already sorted and filtered, `sortDescriptor`/`onSortChange`, `selectedKeys`/`onSelectionChange`, `onCellChange`, `onRowAction`, `onAddRow` (returns the new id), `isLoading`, `emptyState`, `summary`, and `onColumnAction` for the header menu (Sort ascending, Sort descending, Filter by this, Hide column, Edit field; narrow it with `columnActions`). The first column can't be hidden; an unsortable column's sorts are greyed out.

**States**: rows, hover wash, selected (`accent-soft`), focused cell (accent focus box), editing, just changed (one `accent-soft` wash), loading (five skeleton rows), revealing, empty line, resizing.

**Interaction**: each header shows a caret on hover or focus that opens its column menu (it floats over the header's end, so names keep their width); arrows move between rows and cells; Space toggles a row; Enter or a double-click opens the cell's editor over the cell (text commits on Enter or a click outside, Esc drops it; select and status commit on the pick, the tick draws, the editor closes 120ms later). Header press sorts and the arrow swaps (09 icon swap). Drag a header edge to resize. Skeleton rows cross-blur into content (14 skeleton reveal, 400ms). Editors open in the shared Popover (05 dropdown motion); select and status edit in the shared menu rows. An empty cell is blank; dates read "13 Nov" through `formatDate`.

**Production note**: the demo draws every row. Real views render through RAC's `Virtualizer` with a `TableLayout` (row height 44, header 36) and page rows from the data layer.

**Replaces**: DataGrid, Table, SampleTable.
