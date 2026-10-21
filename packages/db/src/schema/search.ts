// The command menu's recent items (spec 0039): the records and views each
// member opened last, newest first. A member's own bookmark, like
// `member_view_state`: no outbox row, at most 20 rows per member (each visit
// prunes past them), and read back only through the access door, so an item
// the member can no longer see simply isn't shown.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { members } from './workspaces.ts';

/** One recent item: a record or a view a member opened, and when they last did. */
export const memberRecents = pgTable(
  'member_recents',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    /** `record` or `view`. */
    kind: text('kind').notNull(),
    /** The record's or the view's id. No foreign key: it points at two tables, and reads skip what doesn't resolve. */
    targetId: uuid('target_id').notNull(),
    visitedAt: timestamptz('visited_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'member_recents_pkey', columns: [t.workspaceId, t.memberId, t.kind, t.targetId] }),
    foreignKey({
      name: 'member_recents_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // The read (newest first) and the prune past the 20th.
    index('member_recents_by_time').on(t.workspaceId, t.memberId, t.visitedAt.desc()),
    // A view's delete finds its rows through this, not a scan.
    index('member_recents_by_target').on(t.workspaceId, t.targetId),
    check('member_recents_kind', sql`${t.kind} in ('record', 'view')`),
  ],
);
