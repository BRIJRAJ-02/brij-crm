// Where a piece of data stands, for modules that load their own slice of a
// screen (the timeline, task lists, the board, charts).

/** `ready` (the default), still `loading`, failed (`error`, with Try again when there's a retry), or `no-access` for someone who may not see it. */
export type LoadStatus = 'ready' | 'loading' | 'error' | 'no-access';
