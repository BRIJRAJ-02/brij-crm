// The record store, its windows and the view, for the AC-40 gate tool
// (tools/data-gate), which measures them on their own. Screens never import
// this: they read records through createDataLayer's `records` and `useView`.
export { createPlainStore, sameData } from './plain-store.ts';
export { composeRecord, newerBase, remainingLayers } from './store.ts';
export type { Layer, RecordBody, RecordStore, RecordValues, StoreListener } from './store.ts';
export { createRecordView, nextFrame } from './view.ts';
export type { Pin, RecordSource, RecordViewStore, RowNote, Scheduler } from './view.ts';
export { createWindows } from './windows.ts';
export type {
  BlockReader,
  BlockRead,
  ReadFrom,
  RowRange,
  WindowCount,
  WindowMode,
  Windows,
  WindowsOptions,
} from './windows.ts';
