// The milestones a workspace reaches once (spec 0010, AC-177): the source of
// truth for the product counts PostHog charts, so they can be rebuilt from our
// own database. A row is written in the same transaction as the write that
// reached it, with `insert … on conflict do nothing returning`, so it comes
// back only the first time, and its event is sent only then, after commit.
// Never changed and never removed but with its workspace. Row level security
// and the grants (the app may only read and insert) are hand written in the
// migration.
import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { workspaces } from './workspaces.ts';

/** The milestones a workspace can reach, in the order it usually reaches them. */
export const WORKSPACE_MILESTONES = ['workspace_created', 'first_record_created'] as const;

/** One milestone one workspace reached, and when. */
export const workspaceMilestones = pgTable(
  'workspace_milestones',
  {
    workspaceId: workspaceId(),
    milestone: text('milestone', { enum: WORKSPACE_MILESTONES }).notNull(),
    /** The time of the transaction that reached it. */
    reachedAt: timestamptz('reached_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'workspace_milestones_pkey', columns: [t.workspaceId, t.milestone] }),
    // A workspace's milestones go with it.
    foreignKey({
      name: 'workspace_milestones_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    check('workspace_milestones_milestone', sql`${t.milestone} in ('workspace_created', 'first_record_created')`),
  ],
);
