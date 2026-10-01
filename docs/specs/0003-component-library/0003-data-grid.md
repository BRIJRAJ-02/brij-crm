# 0003 · The data grid

## Summary

`DataGrid` is the record table, the hardest module in the library. TanStack Virtual draws only the rows and columns on screen, and the grid keeps its own small column state (order, widths, pinning, visibility). Rows come from outside through a small interface, so the grid works the same over 50 rows or a million. Every cell renders and edits through the field set, and the keyboard model is a spreadsheet's, built by us on React Aria's focus tools.

## Versions and what's not used (checked 2026-10-01)

- `@tanstack/react-virtual` 3.14.13, pinned in the catalog.
- **TanStack Table is dropped**, which amends spec 0001. Its row models expect the full data array, which fights a sparse window over a million rows (AC-9). It would also duplicate selection state. Only its column state would be left to use, and that's about 100 lines of our own.
- **React Aria's `Table` isn't used** for records, because its collection holds every item in memory. It is used for the small settings `Table`.

## Props

```ts
interface DataGridProps<Row> {
  label: string;                                         // the grid's accessible name
  columns: readonly GridColumn[];                        // { id, attribute: FieldAttribute, width, isHidden? }
  pinnedCount: number;                                   // columns pinned from the start; at least 1 (the row header)
  rows: RowSource<Row>;
  getValue(row: Row, columnId: string): AttributeValue | null;
  getDisplay?(row: Row, columnId: string): DisplayFor<AttributeValue> | undefined;
  rowHeader: string;                                     // the column id that names a row (always first)
  selection?: GridSelection;  onSelectionChange?(s: GridSelection): void;
  onColumnsChange?(columns: readonly GridColumn[], pinnedCount: number): void; // on release or key press, never mid drag
  onCellChange?(change: CellChange): void;               // one edit or clear
  onCellsChange?(changes: readonly CellChange[]): void;  // a paste or a range clear
  cellErrors?: ReadonlyMap<string, string>;              // `${rowId}:${columnId}` to a refusal sentence
  footer?: Readonly<Record<string, ReactNode>>;          // calculations, computed by the screen
  status?: 'ready' | 'loading' | 'error' | 'no-access';  onRetry?(): void;
  emptyState?: ReactNode;
  onRowOpen?(rowId: string): void;
}

interface RowSource<Row> extends ListSource<Row> {       // count, getItem, getKey, onRangeChange
  resolveKeys?(start: number, end: number): Promise<readonly string[]>; // ids for a range not loaded yet
}

type GridSelection =
  | { kind: 'some'; ids: ReadonlySet<string> }
  | { kind: 'all-matching'; except: ReadonlySet<string> };
```

- The data layer (#6) implements `RowSource`. It fetches windows as `onRangeChange` reports them (the visible rows plus 8 rows of overscan each way), and it applies live patches. The grid never holds all rows, and the `crm-frontend-state` rules apply on the data side.
- Values leave already valid. `onCellChange` receives a `CellChange` whose value passed the field set's schema. The data layer writes it optimistically, and passes a refusal back through `cellErrors`. The cell then shows the Field error state with the sentence, and the data layer's toast offers Retry.

## Column state (ours)

- **Order**: `columns` array order. The first `pinnedCount` columns are pinned as one run from the start, and the row header is always first and pinned. Pinning another column moves it to the end of the run, never to a separate island.
- **Widths**: from each column's `width`, clamped to new tokens `size-column-min` and `size-column-max`. These are added to the artifact in milestone 3 through spec 0002's flow, and read as numbers from `@crm/tokens/tokens.json`. Defaults per type come from the field set (text wider, checkbox narrow).
- **Hiding**: `isHidden` columns aren't drawn. Show and hide happen in `ViewSettings`.
- **Saving**: changes leave through `onColumnsChange` when a drag ends or on each key press of a keyboard resize. The view (#20) saves them.

## Layout and drawing

- **Sizes**: the header row is `size-table-header` and each row `size-row`, one height for every row, with the numbers read from `tokens.json` for the virtualiser. Rows virtualise vertically. Columns virtualise horizontally once more than 12 are visible.
- **Positioning**: rows sit in a container sized to `count × size-row`. Each row's offset is an inline custom property (`--row-offset`), read by `transform: translateY(var(--row-offset))`, as the lint rule requires. The same pattern sets column widths (`--col-width`).
- **Order of columns on screen**: the checkbox column, then the pinned run, then the rest.
- **Semantics**: the ARIA grid pattern: `role="grid"`, `aria-rowcount` = `count + 1` (the header row), `aria-colcount`, and `aria-rowindex` and `aria-colindex` on every rendered row and cell. Screen readers then announce real positions, not DOM positions.
- **Footer**: it draws whatever `footer` holds, in tabular figures. The grid never computes over loaded rows.

## Keyboard model

The ⌘ key is used on Mac and Ctrl elsewhere; this page writes it as Mod. Keys are handled only while focus is inside the grid, with `preventDefault` so browser shortcuts never fire there.

- **Focus**: one cell holds focus (roving `tabIndex`), and Tab enters and leaves the grid when no editor is open.
- **Moving between cells**: arrows move one cell. Home and End go to the row's first or last cell, Mod+Home and Mod+End to the grid's first or last cell, and Page Up and Page Down move one screen. Focus moving off screen scrolls the virtualiser first, then focuses the cell once it renders.
- **Editing**:
  - Enter or F2 opens the editor. Typing a printable key, including Space, opens it and replaces the value.
  - Enter commits and moves down, Tab commits and moves right, and Shift reverses either. Esc cancels and restores the value.
  - Cells whose type `editIn` is `cell` edit inline, and `popover` types open their editor anchored to the cell.
  - Read only cells say why in a tooltip, and never open.
- **The two special columns**:
  - In the checkbox column, Space toggles the row.
  - On the row header, Space opens the record (`onRowOpen`), and so does a click on the name. Typing still edits the name there.
- **Clearing**: Delete or Backspace clears the focused cell or the selected range, emitting `null`.
  - A required attribute refuses, with the Field error.
  - A checkbox becomes `false`.
  - Read only cells are skipped.
  - Refusals from a range clear are reported in one toast, as for paste.
- **Selecting**:
  - Shift with an arrow extends a cell range, and Shift with a click extends a row range.
  - Mod+A selects all rows on screen, meaning the rendered viewport rows without overscan. The bulk bar then offers "Select all N matching" (`kind: 'all-matching'`).
  - A shift row range that spans rows not loaded yet uses `resolveKeys` when the source has it. Otherwise it selects only the loaded rows and says how many it left out.
- **Copy**: Mod+C copies the cell range through each type's `toText`, as tab separated text with Excel quoting. It uses the native `copy` event and `clipboardData`, so no permission prompt appears in any engine. A range that crosses rows not loaded yet is refused with a message ("Scroll to load these rows first").
- **Paste**: Mod+V uses the native `paste` event and starts at the focused cell.
  - A single copied value fills the whole selected range.
  - A block pastes its own shape. Cells past the last column, or past the loaded rows, are clipped and counted.
  - Each cell goes through its column's `fromText`. Empty text becomes `null`, so it's refused when required, and gives `false` for a checkbox.
  - The checkbox column and read only columns are skipped.
  - Valid cells go out in one `onCellsChange`. Refused, clipped and skipped cells are listed in one toast ("2 cells weren't pasted: No option called 'Hot'").
- **Columns by keyboard**: the header menu (Alt+Down on a header) is the main keyboard route. Its items are Move left, Move right, Pin, Unpin, Hide, Sort and Filter, plus Resize, which enters a resize mode where Left and Right change the width by one `space-8` step and Enter or Esc leaves.
- **Columns by pointer**: drag a header to reorder (React Aria drag and drop), and drag a header's edge to resize. There are no Alt+Arrow shortcuts, because they are Back and Forward on Windows and Linux.

## Performance test (AC-7)

A browser test in the `stories` project, Chromium only, in a 1280 by 800 viewport, with overscan 8:
1. Render the grid with a `RowSource` of 100,000 synthetic rows and 20 columns. The columns mix text, number, currency, select, status, date, record reference and checkbox, which are the heavier displays.
2. Measure time to first paint: `performance.mark` at mount, and the end two `requestAnimationFrame`s after the first cell exists. It must be under 500 ms, as the median of 3 runs.
3. Start a `PerformanceObserver` for `longtask`.
4. Scroll from top to bottom in 60 steps over about 3 seconds (`scrollTop` per animation frame).
5. Assert:
   - at most one long task, and none over 120 ms;
   - the DOM never holds 100 or more rows;
   - the last row renders with `aria-rowindex` 100,001.
6. The test retries once on failure, and logs its numbers each run, so the budget can be tuned against real data. A change to the thresholds is a spec change.

A manual check in `/check verify` covers the feel: smooth scrolling on a laptop, with no skeleton flashes at moderate speed.

## Risks

The keyboard model, virtual focus and column state are the riskiest code in the library. The mitigations:
- the keyboard `play` scripts cover every key above in all three engines;
- `ux-interaction-reviewer` reviews the grid on its own before milestone 3 closes.
