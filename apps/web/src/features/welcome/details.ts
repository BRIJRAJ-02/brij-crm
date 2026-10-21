// First run's About you answers (spec 0036): the choices it offers, "All of
// it" as the three areas, and answers read back from a draft. Pure, so the
// rules are tested on their own.
import type { OnboardingAnswers, OnboardingArea, OnboardingRole, OnboardingTeamSize } from '@crm/data';

/** The roles offered, in order. */
export const ROLES: readonly OnboardingRole[] = ['founder', 'sales', 'marketing', 'operations', 'other'];

/** The team sizes offered, in order. */
export const TEAM_SIZES: readonly OnboardingTeamSize[] = ['solo', '2-10', '11-50', '51+'];

/** The areas offered, in order; "All of it" is the chip after them. */
export const AREAS: readonly OnboardingArea[] = ['crm', 'booking', 'forms'];

/** The "All of it" chip's id: held when every area is, never stored. */
export const ALL_AREAS = 'all' as const;

/**
 * The areas after the area chips change from `before` to `chips`: "All of
 * it" pressed holds every area, let go clears them; an area let go while
 * all were held lets go of "All of it" too. The ids come back in the
 * offered order.
 */
export function areasFromChips(before: readonly OnboardingArea[], chips: readonly string[]): OnboardingArea[] {
  const wasAll = before.length === AREAS.length;
  const isAll = chips.includes(ALL_AREAS);
  if (isAll && !wasAll) return [...AREAS];
  if (!isAll && wasAll && AREAS.every((area) => chips.includes(area))) return [];
  return AREAS.filter((area) => chips.includes(area));
}

/** The chips held for `areas`: each area, and "All of it" when every one is. */
export function chipsFromAreas(areas: readonly OnboardingArea[]): string[] {
  return areas.length === AREAS.length ? [...areas, ALL_AREAS] : [...areas];
}

/** The answers worth sending: undefined when nothing was answered. */
export function answersToSend(answers: OnboardingAnswers): OnboardingAnswers | undefined {
  const kept: OnboardingAnswers = {
    ...(answers.role === undefined ? {} : { role: answers.role }),
    ...(answers.teamSize === undefined ? {} : { teamSize: answers.teamSize }),
    ...(answers.areas === undefined || answers.areas.length === 0 ? {} : { areas: answers.areas }),
  };
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/** Answers read back from storage, keeping only values first run offers. */
export function answersFrom(value: unknown): OnboardingAnswers | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { role, teamSize, areas } = value as Record<string, unknown>;
  const found = ROLES.find((each) => each === role);
  const size = TEAM_SIZES.find((each) => each === teamSize);
  const picked = Array.isArray(areas) ? AREAS.filter((area) => areas.includes(area)) : [];
  return answersToSend({
    ...(found === undefined ? {} : { role: found }),
    ...(size === undefined ? {} : { teamSize: size }),
    areas: picked,
  });
}
