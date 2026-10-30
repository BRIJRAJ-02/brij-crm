// What a record page's address may name: its tab, its id, and `?task=`,
// `?note=` and `?thread=`. The routes' checks read these in the first load,
// so they live apart from the entries and details modules (and the strings
// that come with them), which load with the screens. Plain, so they test in
// Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The record page's tabs, by their address (`tasks` joined with #19 milestone 1, `notes` joins with its milestone 3). */
export const RECORD_TABS = ['overview', 'activity', 'notes', 'tasks', 'comments'] as const;
/** One of the record page's tabs. */
export type RecordTab = (typeof RECORD_TABS)[number];

/** Whether an address segment names one of the record page's tabs. */
export const isRecordTab = (tab: string): tab is RecordTab => (RECORD_TABS as readonly string[]).includes(tab);

/** Whether an address segment can be a record's id: anything else names no record. */
export const isRecordId = (value: string): boolean => UUID.test(value);

/** Whether a `task` search param names a task (a uuid) or a new one. */
export function isTaskParam(value: unknown): value is string {
  return typeof value === 'string' && (value === 'new' || UUID.test(value));
}

/** Whether a `note` search param names a note (a uuid) or a new one. */
export function isNoteParam(value: unknown): value is string {
  return typeof value === 'string' && (value === 'new' || UUID.test(value));
}

/** Whether `?thread=` names a thread: a uuid, anything else is dropped. */
export function isThreadParam(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
