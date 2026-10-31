// The team around a workspace (spec 0031): invitations into it, and the audit
// log every membership, role, team and workspace change writes to. Both are
// tenant tables under forced row level security.
//
// An invitation's link carries a random token; only its SHA-256 (hex) is
// stored. Acceptance finds the workspace before any scope exists through
// `crm_invitation_by_token(hash)` (migration 0053), a narrow definer that
// answers ids only, as `crm_booking_by_token` does for a booking's manage link.
import { sql } from 'drizzle-orm';
import {
  boolean,
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
    /** The custom role it gives (spec 0037, AC-1236), with `role` then `member`; the foreign key is in migration 0146. */
    customRoleId: uuid('custom_role_id'),
    status: text('status').notNull().default('open'),
    /** The SHA-256 of the link's token, as 64 lowercase hex digits. An email invitation's token is never stored. */
    tokenHash: text('token_hash').notNull(),
    /**
     * The invite link's own token (slice 6, AC-818), so an admin can copy the
     * link again at any time, as Linear and Slack let them; null for an email
     * invitation, whose token only its email ever holds. It always hashes to
     * `token_hash`.
     */
    linkToken: text('link_token'),
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
    check('invitations_custom_role', sql`${t.customRoleId} is null or ${t.role} = 'member'`),
    check('invitations_kind', sql`${t.kind} in ('email', 'link')`),
    check('invitations_status', sql`${t.status} in ('open', 'used', 'revoked')`),
    check(
      'invitations_email_shape',
      sql`(${t.kind} = 'email' and ${t.email} is not null and ${t.email} = lower(${t.email}) and ${t.maxUses} = 1)
        or (${t.kind} = 'link' and ${t.email} is null and ${t.role}::text not in ('owner', 'admin'))`,
    ),
    check('invitations_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'invitations_link_token',
      sql`(${t.kind} = 'email' and ${t.linkToken} is null)
        or (${t.kind} = 'link' and ${t.linkToken} is not null
          and encode(sha256(convert_to(${t.linkToken}, 'UTF8')), 'hex') = ${t.tokenHash})`,
    ),
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
    // A custom role's open invitations: moved when the role is deleted (spec 0037, AC-1238).
    index('invitations_custom_role')
      .on(t.workspaceId, t.customRoleId)
      .where(sql`${t.customRoleId} is not null`),
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

/**
 * An email domain whose people may ask to join (spec 0031, slice 6, AC-819):
 * lowercase, never a public mail domain, added only by someone whose own
 * verified email is at it. None by default. `/join` finds a person's
 * workspaces before any scope exists through `crm_workspaces_by_domain`
 * (migration 0057), a narrow definer that answers workspace ids only.
 */
export const workspaceDomains = pgTable(
  'workspace_domains',
  {
    workspaceId: workspaceId(),
    domain: text('domain').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'workspace_domains_pkey', columns: [t.workspaceId, t.domain] }),
    foreignKey({ name: 'workspace_domains_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    ...actorConstraints('workspace_domains', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('workspace_domains', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    check(
      'workspace_domains_domain',
      sql`${t.domain} = lower(${t.domain}) and ${t.domain} ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(${t.domain}) <= 253`,
    ),
    // The lookup by domain, before the workspace is known: global.
    index('workspace_domains_domain_lookup').on(t.domain),
  ],
);

const decidedBy = actorColumns('decided_by');

/**
 * A signed in person's request to join through the workspace's email domain
 * (spec 0031, slice 6, AC-819, AC-820): `open` until an owner or admin
 * approves (they join) or declines it. One open request per person per
 * workspace. Written by the system on the requester's behalf.
 */
export const joinRequests = pgTable(
  'join_requests',
  {
    workspaceId: workspaceId(),
    id: id(),
    userId: uuid('user_id').notNull(),
    /** Their verified address, lowercase, as they asked. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('open'),
    decidedByType: decidedBy.type,
    decidedById: decidedBy.id,
    decidedByMemberId: decidedBy.memberId,
    decidedAt: timestamptz('decided_at'),
    /** The member an approval made. */
    memberId: uuid('member_id'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'join_requests_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'join_requests_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    ...actorConstraints('join_requests', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('join_requests', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    actorCheck('join_requests_decided_by_actor', {
      type: t.decidedByType,
      id: t.decidedById,
      memberId: t.decidedByMemberId,
    }),
    foreignKey({
      name: 'join_requests_decided_by',
      columns: [t.workspaceId, t.decidedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'join_requests_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('join_requests_status', sql`${t.status} in ('open', 'approved', 'declined')`),
    check('join_requests_email', sql`${t.email} = lower(${t.email})`),
    check('join_requests_name', sql`char_length(${t.name}) between 1 and 80`),
    check(
      'join_requests_decided',
      sql`(${t.status} = 'open' and ${t.decidedAt} is null) or (${t.status} <> 'open' and ${t.decidedAt} is not null)`,
    ),
    // One open request per person per workspace.
    uniqueIndex('join_requests_open')
      .on(t.workspaceId, t.userId)
      .where(sql`${t.status} = 'open'`),
    // A person's requests across workspaces, read only through crm_join_requests_of (account deletion).
    index('join_requests_by_user').on(t.userId),
    // The Join requests tab: open ones, oldest first.
    index('join_requests_open_list')
      .on(t.workspaceId, t.createdAt, t.id)
      .where(sql`${t.status} = 'open'`),
    // A person's latest request in a workspace, for /join's state.
    index('join_requests_user').on(t.workspaceId, t.userId, t.createdAt.desc()),
  ],
);

/**
 * A workspace's sign in rules (spec 0033, AC-893): whether every member needs
 * two factor, how long a sign in lasts here, and when everyone was last
 * signed out of it. One row per workspace, made the first time an owner
 * changes a rule; no row means none of them. The door reads it in its one
 * query. Room for allowed sign in methods when SSO comes.
 */
export const workspaceSecurity = pgTable(
  'workspace_security',
  {
    workspaceId: workspaceId(),
    requireTwoFactor: boolean('require_two_factor').notNull().default(false),
    /** Days a sign in lasts in this workspace, counted from when the session last proved who it is; null for no limit. */
    sessionLengthDays: integer('session_length_days'),
    /** A session that last proved who it is before this must sign in again here ("Sign out everyone"). */
    sessionsValidAfter: timestamptz('sessions_valid_after'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'workspace_security_pkey', columns: [t.workspaceId] }),
    foreignKey({ name: 'workspace_security_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    ...actorConstraints('workspace_security', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('workspace_security', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    check(
      'workspace_security_session_length',
      sql`${t.sessionLengthDays} is null or ${t.sessionLengthDays} in (1, 7, 14, 30)`,
    ),
  ],
);
