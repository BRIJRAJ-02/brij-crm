// Schedules' words (spec 0035): plain functions, no React, so dialogs, rows and tests share them.
import { scheduleStrings } from './schedule-strings.ts';

/** At most this many schedules per member (AC-961; the server's `SCHEDULES_MAX`, which refuses past it). */
export const SCHEDULES_MAX = 20;

/**
 * Names as one phrase, the first three by name and the rest counted: "Intro call", "Intro call and Demo",
 * "Intro call, Demo and Sales", "Intro call, Demo, Sales and 2 more".
 */
export function listOfNames(names: readonly string[], shown = 3): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length > shown) {
    return `${names.slice(0, shown).join(', ')} ${scheduleStrings.and} ${scheduleStrings.andMore(names.length - shown)}`;
  }
  return `${names.slice(0, -1).join(', ')} ${scheduleStrings.and} ${names.at(-1) ?? ''}`;
}

/** What deleting a schedule does to the pages using it, from what the server will do (AC-967). */
export function deleteSentence(pages: readonly string[], fallback: string): string {
  return pages.length === 0
    ? scheduleStrings.deleteUnused
    : scheduleStrings.deleteUsed(listOfNames(pages), pages.length, fallback);
}
