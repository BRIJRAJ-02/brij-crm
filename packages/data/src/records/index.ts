// The record store, its windows and the view, for the AC-40 gate tool
// (tools/data-gate) until the data layer serves them itself (spec 0005,
// task 11). Screens never import this: they go through createDataLayer.
export { createPlainStore } from './plain-store.ts';
export { composeRecord, remainingLayers } from './store.ts';
export type { Layer, RecordBody, RecordStore, RecordValues, StoreListener } from './store.ts';
export { createRecordView } from './view.ts';
export type { RecordSource, RecordViewStore } from './view.ts';
export { createWindows } from './windows.ts';
export type { BlockLoader, RowRange, Windows, WindowsOptions } from './windows.ts';
