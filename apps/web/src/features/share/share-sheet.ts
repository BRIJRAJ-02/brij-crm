// The library's ShareSheet and its column as a chunk of their own: `LazyShareSheet.tsx` loads them apart from a
// screen's first paint, since the sheet is opened on a press and the column drawn on a Share tab (spec 0074, AC-7419).
export { ShareColumn, ShareSheet } from '@crm/ui';
