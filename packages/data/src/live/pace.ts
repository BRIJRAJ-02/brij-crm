// How fast a background job's changes reach open screens (spec 0022, AC-532),
// shared by the live client, which paces the job's coarse events, and the
// records layer, which paces what it reads again for them (a table's ticked
// rows). Its own module, so the records layer doesn't carry the live client.

/**
 * How often a background job's coarse records events refetch an object's
 * open views (spec 0022, AC-532): at most once every 5 seconds per object,
 * plus once 5 to 7 seconds after the last, so a long job never multiplies the
 * read load.
 */
export const COARSE_JOB_MS = 5000;
