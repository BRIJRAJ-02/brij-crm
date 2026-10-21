// Settings › Account › Preferences: each member's own preferences in one
// workspace. `preferences.get` reads the caller's; `preferences.update`
// changes only the fields it names, for the caller alone. No row reads as the
// defaults: the browser's time zone, the language's date format and week
// start, and Home.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { TimeZoneName } from './booking/settings.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** How a date is written: the language's own (`auto`), `8 Oct 2026` (`dmy`), `Oct 8, 2026` (`mdy`) or `2026-10-08` (`ymd`). */
export const DateFormat = z.enum(['auto', 'dmy', 'mdy', 'ymd']);
/** How a date is written. */
export type DateFormat = z.infer<typeof DateFormat>;

/** The day a week starts on: the language's own (`auto`), Monday, Sunday or Saturday. */
export const WeekStart = z.enum(['auto', 'monday', 'sunday', 'saturday']);
/** The day a week starts on. */
export type WeekStart = z.infer<typeof WeekStart>;

/** The page a workspace opens on: Home, Tasks, or one object's records (by id, so a rename keeps it). */
export const LandingPage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home') }),
  z.object({ kind: z.literal('tasks') }),
  z.object({ kind: z.literal('object'), objectId: Uuid }),
]);
/** The page a workspace opens on. */
export type LandingPage = z.infer<typeof LandingPage>;

/** One member's preferences in one workspace. `timeZone` is absent while they follow the browser's. */
export const MemberPreferences = z.object({
  timeZone: TimeZoneName.optional(),
  dateFormat: DateFormat,
  weekStart: WeekStart,
  landing: LandingPage,
});
/** One member's preferences in one workspace. */
export type MemberPreferences = z.infer<typeof MemberPreferences>;

/** What a member who never changed anything has. */
export const DEFAULT_PREFERENCES: MemberPreferences = {
  dateFormat: 'auto',
  weekStart: 'auto',
  landing: { kind: 'home' },
};

/**
 * A change to the caller's own preferences: only the fields it names change.
 * `timeZone` null goes back to the browser's. `mutationId` is the write's uuid.
 */
export const UpdatePreferencesInput = WorkspaceScoped.extend({
  timeZone: TimeZoneName.nullable().optional(),
  dateFormat: DateFormat.optional(),
  weekStart: WeekStart.optional(),
  landing: LandingPage.optional(),
  mutationId: Uuid,
});
/** A change to the caller's own preferences. */
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInput>;

/** The preferences procedures. Each serves the caller's own row only, behind the member door. */
export const preferencesContract = {
  get: oc.input(WorkspaceScoped).output(MemberPreferences),
  update: oc.input(UpdatePreferencesInput).output(MemberPreferences),
};
