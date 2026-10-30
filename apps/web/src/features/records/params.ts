// What a record page's address may name (`?task=`, `?note=`, `?thread=`):
// the routes' search checks read these in the first load, so they live apart
// from the entries modules (and their strings), which load with the screens.
// Plain, so they test in Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
