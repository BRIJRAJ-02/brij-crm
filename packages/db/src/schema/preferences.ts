// Each member's own preferences in one workspace (Settings › Account ›
// Preferences): the time zone dates show in, how a date is written, the day a
// week starts on, and the page the workspace opens on. One row per member,
// made on their first change; no row reads as every default. A member's own
// setting like `member_view_state`: no outbox row (nobody else holds it), and
// read and written only through the access door, for the caller alone.
import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { members } from './workspaces.ts';

/** One member's preferences in one workspace. */
export const memberPreferences = pgTable(
  'member_preferences',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    /** An IANA zone (`Europe/London`), or null for the browser's own. */
    timeZone: text('time_zone'),
    /** `auto` (the language's own), `dmy` (8 Oct 2026), `mdy` (Oct 8, 2026) or `ymd` (2026-10-08). */
    dateFormat: text('date_format').notNull().default('auto'),
    /** `auto` (the language's own), `monday`, `sunday` or `saturday`. */
    weekStart: text('week_start').notNull().default('auto'),
    /** `home`, `tasks` or `object` (then `landing_id` is the object's id). */
    landing: text('landing').notNull().default('home'),
    /** The object the workspace opens on, when `landing` is `object`. No foreign key: an archived object falls back to Home. */
    landingId: uuid('landing_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'member_preferences_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'member_preferences_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('member_preferences_time_zone', sql`char_length(${t.timeZone}) between 1 and 64`),
    check('member_preferences_date_format', sql`${t.dateFormat} in ('auto', 'dmy', 'mdy', 'ymd')`),
    check('member_preferences_week_start', sql`${t.weekStart} in ('auto', 'monday', 'sunday', 'saturday')`),
    check(
      'member_preferences_landing',
      sql`(${t.landing} in ('home', 'tasks') and ${t.landingId} is null) or (${t.landing} = 'object' and ${t.landingId} is not null)`,
    ),
  ],
);
