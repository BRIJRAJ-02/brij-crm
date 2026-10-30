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

/**
 * The record panel's tabs (the peek beside a table or board, spec 0017 AC-384): Details first, then the page's own
 * tabs but Overview, which the full page keeps.
 */
export const PEEK_TABS = ['details', 'activity', 'notes', 'tasks', 'comments'] as const;
/** One of the record panel's tabs. */
export type PeekTab = (typeof PEEK_TABS)[number];

/** Whether `?panelTab=` names one of the panel's tabs. */
export const isPeekTab = (tab: unknown): tab is PeekTab =>
  typeof tab === 'string' && (PEEK_TABS as readonly string[]).includes(tab);

/** Whether `?record=` names a record: a uuid, anything else is dropped. */
export function isRecordParam(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The record panel over a view, as its address holds it (`?record=`, `?panelTab=`), and how to change it. */
export interface PeekControl {
  /** The record shown; undefined while the panel is closed. */
  readonly recordId: string | undefined;
  readonly tab: PeekTab;
  /** Shows a record: a row's name or a card picked, or a step. */
  readonly open: (recordId: string) => void;
  readonly setTab: (tab: PeekTab) => void;
  readonly close: () => void;
}

/** The record before and after one in a list, by id: either is absent at that end, or where it isn't loaded yet. */
export interface PeekSteps {
  readonly previous?: string;
  readonly next?: string;
}

/**
 * The records either side of `index` in a list of `count` (the peek's ↑ and ↓): `idAt` answers a loaded row's id.
 * No index (the record isn't among the rows the list holds) has no steps, so the panel hides both buttons.
 */
export function stepsAround(
  index: number | undefined,
  count: number,
  idAt: (index: number) => string | undefined,
): PeekSteps | undefined {
  if (index === undefined || index < 0 || index >= count) return undefined;
  const previous = index > 0 ? idAt(index - 1) : undefined;
  const next = index < count - 1 ? idAt(index + 1) : undefined;
  return { ...(previous === undefined ? {} : { previous }), ...(next === undefined ? {} : { next }) };
}
