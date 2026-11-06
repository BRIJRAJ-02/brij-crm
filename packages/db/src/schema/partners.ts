// Partner connections (spec 0070, slice 2, AC-7011 to AC-7013): a partner (the global `auth.partners` row) linked to
// one workspace by someone who owns it, and the one time codes of the OAuth connect that makes the link. Both are
// tenant tables under forced row level security with the plain policy: the door reads a connection, and the token
// exchange a code, under the workspace their tokens' public half names, so nothing looks across workspaces. A
// connection's token and a code are stored only as SHA-256 hashes. Slice 3 adds `managed_members`, slice 4
// `partner_launches` and the embedded session's scope.
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamptz, workspaceId } from './common.ts';
import { members, workspaces } from './workspaces.ts';

/** Raw bytes (Postgres `bytea`) as a Node Buffer. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** The module catalog as the database checks it (`PARTNER_MODULES` in `@crm/contracts`). */
const MODULES = sql`array['link_pages']::text[]`;

/**
 * One partner's link to this workspace (AC-7011): the modules it may use, who approved it, the SHA-256 of its access
 * token, and its last call. At most one live connection per partner and workspace: connecting again replaces the
 * token on the same row. A disconnected one stays, refused, for History.
 */
export const partnerConnections = pgTable(
  'partner_connections',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** `auth.partners.id`. No foreign key across schemas: the registry is global and never deletes a partner. */
    partnerId: uuid('partner_id').notNull(),
    /** From `PARTNER_MODULES`, at least one. */
    modules: text('modules').array().notNull(),
    /** The owner who approved it, most recently. */
    approvedByMemberId: uuid('approved_by_member_id').notNull(),
    /** SHA-256 of the access token's secret half. Never the token. */
    tokenHash: bytea('token_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** The partner's last call with this connection's token, written at most once a minute. */
    lastCallAt: timestamptz('last_call_at'),
    disconnectedAt: timestamptz('disconnected_at'),
    /** Who disconnected it; none when it was ended for the partner (a code used twice, AC-7011). */
    disconnectedByMemberId: uuid('disconnected_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'partner_connections_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'partner_connections_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'partner_connections_approved_by',
      columns: [t.workspaceId, t.approvedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'partner_connections_disconnected_by',
      columns: [t.workspaceId, t.disconnectedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check(
      'partner_connections_modules',
      sql`cardinality(${t.modules}) between 1 and 20 and ${t.modules} <@ ${MODULES}`,
    ),
    check('partner_connections_token_hash', sql`octet_length(${t.tokenHash}) = 32`),
    check(
      'partner_connections_disconnected',
      sql`${t.disconnectedByMemberId} is null or ${t.disconnectedAt} is not null`,
    ),
    // One live connection per partner in a workspace.
    uniqueIndex('partner_connections_live')
      .on(t.workspaceId, t.partnerId)
      .where(sql`${t.disconnectedAt} is null`),
    // Settings › Connected apps, newest first.
    index('partner_connections_list').on(t.workspaceId, t.createdAt.desc()),
  ],
);

/**
 * One connect approval's one time code (AC-7011): bound to the partner, the redirect address and the PKCE challenge
 * it was asked with, good once within 60 seconds. `used_at` and `connection_id` are set by the exchange; a code used
 * a second time ends the connection it made. Codes older than a day are deleted by the next approval in the
 * workspace.
 */
export const partnerCodes = pgTable(
  'partner_codes',
  {
    workspaceId: workspaceId(),
    id: id(),
    partnerId: uuid('partner_id').notNull(),
    /** SHA-256 of the code's secret half. */
    codeHash: bytea('code_hash').notNull(),
    /** The S256 challenge: base64url SHA-256 of the partner's verifier, 43 characters. */
    codeChallenge: text('code_challenge').notNull(),
    /** Exactly the redirect address the connect named; the exchange must name it again. */
    redirectUri: text('redirect_uri').notNull(),
    modules: text('modules').array().notNull(),
    approvedByMemberId: uuid('approved_by_member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    /** The connection the exchange made or renewed with it. */
    connectionId: uuid('connection_id'),
  },
  (t) => [
    primaryKey({ name: 'partner_codes_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'partner_codes_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'partner_codes_approved_by',
      columns: [t.workspaceId, t.approvedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'partner_codes_connection',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [partnerConnections.workspaceId, partnerConnections.id],
    }),
    check('partner_codes_code_hash', sql`octet_length(${t.codeHash}) = 32`),
    check('partner_codes_challenge', sql`${t.codeChallenge} ~ '^[A-Za-z0-9_-]{43}$'`),
    check('partner_codes_redirect', sql`char_length(${t.redirectUri}) between 1 and 500`),
    check('partner_codes_modules', sql`cardinality(${t.modules}) between 1 and 20 and ${t.modules} <@ ${MODULES}`),
    check('partner_codes_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
    check('partner_codes_used', sql`(${t.usedAt} is null) = (${t.connectionId} is null)`),
    // The next approval's sweep of old codes.
    index('partner_codes_expires').on(t.workspaceId, t.expiresAt),
    // Every foreign key into a connection is indexed (the guard test).
    index('partner_codes_connection_ix').on(t.workspaceId, t.connectionId),
  ],
);

/**
 * A person a partner added to this workspace (spec 0070, AC-7020 to AC-7022): keyed by the partner and its own id for
 * them, never by email (AC-7021), with the member row and the identity (`auth.managed_users`) it made. The connection
 * that last wrote it is kept, so a partner that connects again finds the same people. `removed_at` is the partner's
 * DELETE; the same id again brings the same identity back as a new member row (their handle returns, AC-5603).
 */
export const managedMembers = pgTable(
  'managed_members',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** `auth.partners.id` (no foreign key across schemas). */
    partnerId: uuid('partner_id').notNull(),
    /** The partner's own id for the person: 1 to 128 URL safe characters. */
    externalId: text('external_id').notNull(),
    /** The connection that last added or changed them. */
    connectionId: uuid('connection_id').notNull(),
    /** Their member row now (a new one each time they come back). */
    memberId: uuid('member_id').notNull(),
    /** Their managed identity, `auth.user.id`. */
    userId: uuid('user_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** When the partner removed them; none while they are in. */
    removedAt: timestamptz('removed_at'),
  },
  (t) => [
    primaryKey({ name: 'managed_members_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'managed_members_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'managed_members_connection',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [partnerConnections.workspaceId, partnerConnections.id],
    }),
    foreignKey({
      name: 'managed_members_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('managed_members_external_id', sql`${t.externalId} ~ '^[A-Za-z0-9._~:@+=|-]{1,128}$'`),
    uniqueIndex('managed_members_external').on(t.workspaceId, t.partnerId, t.externalId),
    uniqueIndex('managed_members_member_ix').on(t.workspaceId, t.memberId),
    index('managed_members_connection_ix').on(t.workspaceId, t.connectionId),
  ],
);
