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

/**
 * What deleting a schedule does to the pages using it, from what the server will do (AC-967): they book by the
 * member's default, "your" default, or "their" default when an admin deletes a colleague's.
 */
export function deleteSentence(pages: readonly string[], fallback: string, isOwn = true): string {
  return pages.length === 0
    ? scheduleStrings.deleteUnused
    : scheduleStrings.deleteUsed(listOfNames(pages), fallback, isOwn);
}

/** One schedule as the page's Schedule select needs it. */
export interface ScheduleChoiceSource {
  readonly id: string | null;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * The page's Schedule choices: `default` (the page follows whichever schedule is the default) named after that
 * schedule with a Default badge, then the others. The default schedule is listed again by its id only when the page
 * is pinned to it (`chosenId`), so a pinned page still shows its choice.
 */
export function scheduleChoices(
  schedules: readonly ScheduleChoiceSource[],
  chosenId: string | null,
): readonly { readonly id: string; readonly label: string; readonly badge?: string; readonly description?: string }[] {
  const fallback = schedules.find((each) => each.isDefault);
  return [
    fallback === undefined
      ? { id: 'default', label: scheduleStrings.defaultSchedule(undefined) }
      : { id: 'default', label: fallback.name, badge: scheduleStrings.defaultBadge },
    ...schedules.flatMap((each) =>
      each.id === null || (each.isDefault && each.id !== chosenId)
        ? []
        : [
            {
              id: each.id,
              label: each.name,
              ...(each.isDefault ? { description: scheduleStrings.staysOn(each.name) } : {}),
            },
          ],
    ),
  ];
}

/**
 * Whether Availability shows its Viewing Select: once there is a colleague to pick, or while a colleague's
 * schedules are open (so the way back stays). A workspace of one has only its own, as Cal.com shows its member
 * switcher only on a team.
 */
export function showsViewing(members: readonly { readonly id: string }[], member: string | undefined): boolean {
  return members.length > 1 || member !== undefined;
}
