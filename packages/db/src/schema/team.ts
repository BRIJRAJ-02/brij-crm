// The team around a workspace (spec 0031): invitations into it, and the audit
// log every membership, role, team and workspace change writes to. Both are
// tenant tables under forced row level security.
//
// An invitation's link carries a random token; only its SHA-256 (hex) is
// stored. Acceptance finds the workspace before any scope exists through
// `crm_invitation_by_token(hash)` (migration 0055), a narrow definer that
// answers ids only, as `crm_booking_by_token` does for a booking's manage link.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorCheck, actorColumns, auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, memberRole, members, workspaces } from './workspaces.ts';

/**
 * One way into the workspace: an email invitation for one address (single
 * use, 7 days from its last send), or, from slice 6, the workspace's invite
 * link. `status` moves `open` → `used` or `revoked`; a resend keeps it open
 * with a new token, expiry and send count.
 */
export const invitations = pgTable(
  'invitations',
  {
    workspaceId: workspaceId(),
    id: id(),
    kind: text('kind').notNull().default('email'),
    /** The invited address, lowercase; null for the invite link. */
    email: text('email'),
    role: memberRole('role').notNull(),
    status: text('status').notNull().default('open'),
    /** The SHA-256 of the link's token, as 64 lowercase hex digits. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at'),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    /** How many times its email went out: the mailer's idempotency key is the id plus this. */
    sendCount: integer('send_count').notNull().default(0),
    lastSentAt: timestamptz('last_sent_at'),
    /** The member it made, once used. */
    usedByMemberId: uuid('used_by_member_id'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'invitations_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'invitations_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    ...actorConstraints('invitations', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('invitations', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    foreignKey({
      name: 'invitations_used_by',
      columns: [t.workspaceId, t.usedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('invitations_kind', sql`${t.kind} in ('email', 'link')`),
    check('invitations_status', sql`${t.status} in ('open', 'used', 'revoked')`),
    check(
      'invitations_email_shape',
      sql`(${t.kind} = 'email' and ${t.email} is not null and ${t.email} = lower(${t.email}) and ${t.maxUses} = 1)
        or (${t.kind} = 'link' and ${t.email} is null and ${t.role}::text not in ('owner', 'admin'))`,
    ),
    check('invitations_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('invitations_uses', sql`${t.uses} >= 0 and (${t.maxUses} is null or ${t.maxUses} >= 1)`),
    // One open email invitation per address (a second invite resends it), and one open invite link.
    uniqueIndex('invitations_open_email')
      .on(t.workspaceId, t.email)
      .where(sql`${t.status} = 'open' and ${t.kind} = 'email'`),
    uniqueIndex('invitations_open_link')
      .on(t.workspaceId)
      .where(sql`${t.status} = 'open' and ${t.kind} = 'link'`),
    // The lookup by token, before the workspace is known: global, like bookings_manage_token.
    uniqueIndex('invitations_token').on(t.tokenHash),
    // Sign up's question (AC-807), before any workspace is known: does an open email invitation name this address?
    index('invitations_open_address')
      .on(t.email)
      .where(sql`${t.status} = 'open' and ${t.kind} = 'email'`),
    // The Invitations tab: open ones, newest first.
    index('invitations_open')
      .on(t.workspaceId, t.createdAt.desc(), t.id)
      .where(sql`${t.status} = 'open'`),
  ],
);

const auditActor = actorColumns('actor');

/**
 * The audit log (spec 0031, AC-830): one row per membership, role, invite,
 * team and workspace change, written in the change's own transaction. Append
 * only: the app may insert and select, never update or delete, and a trigger
 * refuses both for everyone else too. `before` and `after` hold only the
 * fields that changed, and never a token, code or secret.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    workspaceId: workspaceId(),
    id: id(),
    at: timestamptz('at').notNull().defaultNow(),
    actorType: auditActor.type.notNull(),
    actorId: auditActor.id,
    actorMemberId: auditActor.memberId,
    /** From the catalog in `@crm/contracts` (`AUDIT_ACTIONS`). */
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    requestId: text('request_id'),
  },
  (t) => [
    primaryKey({ name: 'audit_events_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'audit_events_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    actorCheck('audit_events_actor_shape', { type: t.actorType, id: t.actorId, memberId: t.actorMemberId }),
    foreignKey({
      name: 'audit_events_actor',
      columns: [t.workspaceId, t.actorMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('audit_events_action', sql`${t.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    index('audit_events_at').on(t.workspaceId, t.at.desc(), t.id),
    index('audit_events_target').on(t.workspaceId, t.targetType, t.targetId, t.at.desc()),
  ],
);
