// A member's removal, feature by feature (spec 0031, AC-814; spec 0037,
// AC-1440): each feature that holds rows naming a member owns one effect
// beside its tables, and the removal runs them in order inside its own
// transaction. Every foreign key to `members` is either looked after by an
// effect or kept on purpose, with its reason here; the guard test
// (`removal.test.ts`) fails on one that is neither, so a new table can't be
// forgotten.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { bookingPagesRemoval } from '../booking/pages.ts';
import { calendarsRemoval } from '../calendar/connections.ts';
import type { WriteContext } from '../engine/write.ts';
import { navRemoval } from '../navigation/navigation.ts';
import { notificationsRemoval } from '../notifications/inbox.ts';
import { recentsRemoval } from '../search/recents.ts';
import { viewsRemoval } from '../views/manage.ts';
import type { RemovalCounts, RemovalEffect } from './removal-effect.ts';

/**
 * Open tasks assigned to them: they stay assigned (a removed assignee shows
 * as such) unless the remover hands them on (the reassignment job).
 */
const tasksRemoval: RemovalEffect = {
  feature: 'tasks',
  constraints: ['tasks_assignee'],
  count: async (tx, workspaceId, memberId) => {
    const found = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from tasks
      where workspace_id = ${workspaceId}::uuid and assignee_member_id = ${memberId}::uuid
        and deleted_at is null and not is_done
    `);
    return { openTasks: found.rows[0]?.n ?? 0 };
  },
};

/**
 * Live records whose member typed values (an Owner) name them: they keep
 * naming them unless the remover hands them on (the reassignment job). Values
 * carry no foreign key to `members`, so this effect only counts. The count
 * is across the workspace, whatever the asker may read: a number, never which
 * records, for someone who holds `members.manage` or asks about themself.
 */
const recordsRemoval: RemovalEffect = {
  feature: 'records',
  constraints: [],
  count: async (tx, workspaceId, memberId) => {
    const found = await tx.execute<{ n: number }>(sql`
      select count(distinct v.owner_id)::int as n
      from "values" v
      join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
      join records r on r.workspace_id = v.workspace_id and r.id = v.owner_id
      where v.workspace_id = ${workspaceId}::uuid and v.active_until is null and not v.is_cleared
        -- actor_id (equal to actor_member_id for a member, by the check) lets values_actor serve it.
        and v.actor_type = 'member' and v.actor_id = ${memberId}::uuid
        and a.type = 'actor_reference' and not a.is_system and a.archived_at is null and a.object_id is not null
        and r.deleted_at is null
    `);
    return { records: found.rows[0]?.n ?? 0 };
  },
};

/** Every feature's part of a removal, in the order they run. */
export const REMOVAL_EFFECTS: readonly RemovalEffect[] = [
  viewsRemoval,
  calendarsRemoval,
  bookingPagesRemoval,
  tasksRemoval,
  recordsRemoval,
  recentsRemoval,
  navRemoval,
  notificationsRemoval,
];

/**
 * The foreign keys to `members` a removal keeps on purpose, each with why:
 * history (who did what, kept naming them), or rows that stay meaningful.
 * Actor columns (`*_created_by`, `*_updated_by`, `*_removed_by`, an audit
 * row's actor) are history by their names and need no entry.
 */
export const KEPT_ON_REMOVAL: Readonly<Record<string, string>> = {
  records_deleted_by: 'history: who moved a record to the trash',
  values_set_by: 'history: who set a value',
  list_entries_deleted_by: 'history: who removed an entry',
  record_links_set_by: 'history: who linked two records',
  record_links_ended_by: 'history: who unlinked them',
  workspace_membership_member: 'the directory row: dropped by the API once the removal commits (AC-812)',
  jobs_cancel_requested_by: 'history: who asked to cancel a job',
  validation_rules_counted_by: 'history: who counted a rule',
  views_locked_by: 'history: who locked a shared view',
  views_query_saved_by: 'history: who last saved a shared view',
  tasks_deleted_by: 'history: who deleted a task',
  tasks_done_by: 'history: who completed a task',
  meeting_attendees_member: 'history: they attended; the meeting stays, flagged when they organised it',
  form_versions_published_by: 'history: who published a form version',
  forms_owner:
    'the form keeps working; its submissions get no owner while this one has left (owner_removed, spec 0023)',
  bookings_host: 'their bookings stay for admins to hand on (AC-815)',
  booking_member_hours_member:
    'their weekly hours: no page offers them once their pages pause and they leave every pool',
  booking_time_blocks_member: 'their holds: no page offers their time once they leave every pool',
  notes_deleted_by: 'history: who deleted a note',
  invitations_used_by: 'history: who an invitation made',
  join_requests_decided_by: 'history: who answered a request to join',
  join_requests_member: 'history: who an approved request made',
  exports_member: 'history: who started an export; its file expires on its own',
  availability_schedules_member:
    'their schedules: no page books by them once their pages pause and they leave every pool',
  email_preferences_member: 'their email choices: nothing is sent to someone who has left',
  emails_to_member: 'history: an email sent to them',
  emails_reply_to_member: 'history: whose replies an email asked for',
  member_preferences_member: 'their own preferences: nobody reads them once they have left',
  comment_reactions_member: 'history: who reacted to a comment',
  comments_resolved_by: 'history: who resolved a thread',
  comments_deleted_by: 'history: who deleted a comment',
  notifications_actor: 'history: who a notification is about',
  member_onboarding_member: 'their first run answers (spec 0036): nobody reads them, in the app or after',
};

/** Runs every feature's part of a removal of `memberId`, in order, inside the removal's write. */
export async function runRemovalEffects(context: WriteContext, memberId: string): Promise<void> {
  for (const effect of REMOVAL_EFFECTS) await effect.run?.(context, memberId);
}

/** What removing `memberId` will do, every feature counted, read with no lock (AC-816). */
export async function countRemoval(tx: WorkspaceTx, workspaceId: string, memberId: string): Promise<RemovalCounts> {
  const counted: RemovalCounts = { pausedPages: 0, calendars: 0, openTasks: 0, records: 0 };
  let total = counted;
  for (const effect of REMOVAL_EFFECTS) {
    if (effect.count === undefined) continue;
    total = { ...total, ...(await effect.count(tx, workspaceId, memberId)) };
  }
  return total;
}
