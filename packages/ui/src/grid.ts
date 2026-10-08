// `@crm/ui/grid`: the record table, a heavy entry of its own (spec 0003), so
// routes load it lazily and it never sits in the first load.
export {
  DataGrid,
  type DataGridProps,
  type GridStatus,
  type RowNote,
  type RowSource,
} from './modules/DataGrid/DataGrid.tsx';
export type { GridEditorProps } from './modules/DataGrid/GridCell.tsx';
export type { GridColumn } from './modules/DataGrid/grid-columns.ts';
export { columnWidthFor } from './fields/registry.ts';
export {
  allMatching,
  isRowSelected,
  noRows,
  selectedCount,
  toggleRow,
  withRows,
  type GridSelection,
} from './modules/DataGrid/grid-selection.ts';
