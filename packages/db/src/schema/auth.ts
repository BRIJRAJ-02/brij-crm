// Global identity (spec 0005, sign in and access): Better Auth's tables and the
// workspace directory, in their own `auth` schema. Nothing here is tenant data
// and nothing here has row level security; the app role reads and writes these
// tables directly. Only `src/identity/` imports this file (a lint rule in this
// package's eslint.config.js), so no other code can reach them, and it is not
// re-exported from `schema/index.ts`.
//
// Better Auth's Drizzle adapter addresses a column by its property name, so the
// properties carry Better Auth's own field names (`emailVerified`) while the
// columns are snake case (`email_verified`).
import { SECURITY_EVENT_KINDS } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from './common.ts';
import { members, workspaces } from './workspaces.ts';

/** The `auth` schema: global identity, outside row level security. */
export const auth = pgSchema('auth');

/** An id: Better Auth generates uuids (`advanced.database.generateId: 'uuid'`), the default covers anything else. */
const authId = () =>
  uuid('id')
    .notNull()
    .default(sql`uuidv7()`)
    .primaryKey();
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();

/** A person who can sign in. `name` starts empty for an email code sign up. */
export const user = auth.table(
  'user',
  {
    id: authId(),
    name: text('name').notNull().default(''),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /** Two factor sign in is on (spec 0033, Better Auth's `twoFactorEnabled`): set only once a first app code checks out. */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_email').on(t.email),
    // Better Auth lowercases every email it writes; this keeps any other writer from making a second identity.
    check('user_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

/** A signed in device. The token is what the cookie carries. */
export const session = auth.table(
  'session',
  {
    id: authId(),
    expiresAt: timestamptz('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id').notNull(),
    /** Two letter country code from the edge's geo header at sign in (spec 0033, AC-890); absent locally. */
    country: text('country'),
    /** City from the edge's geo header at sign in, as the edge spelled it. */
    city: text('city'),
    /** "Chrome on macOS": the user agent read once at sign in, for Account › Security › Devices. */
    deviceLabel: text('device_label'),
    /** When this session last proved who it is: at sign in, and on each step up (AC-896). */
    verifiedAt: timestamptz('verified_at'),
    /**
     * How `verified_at` was proven: `second_factor` (an app code, a backup
     * code, later a passkey) or `email` (an email code or Google alone).
     * Turning two factor off takes a second factor (AC-885).
     */
    verifiedWith: text('verified_with', { enum: ['email', 'second_factor'] }),
  },
  (t) => [
    uniqueIndex('session_token').on(t.token),
    check('session_verified_with', sql`${t.verifiedWith} in ('email', 'second_factor')`),
    index('session_user').on(t.userId),
    foreignKey({ name: 'session_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
  ],
);

/**
 * A person's security history (spec 0033, AC-898): sign ins, sign outs,
 * sessions ended, and (later milestones) factor changes and alerts. Kept a
 * year, then deleted by the daily cleanup. `detail` names a method or a
 * count, never a code, secret or token. `session_id` names the session the
 * event was about, which may since be gone, so it is no foreign key.
 */
export const securityEvent = auth.table(
  'security_event',
  {
    id: authId(),
    userId: uuid('user_id').notNull(),
    at: timestamptz('at').notNull().defaultNow(),
    kind: text('kind', { enum: SECURITY_EVENT_KINDS }).notNull(),
    sessionId: uuid('session_id'),
    ip: inet('ip'),
    country: text('country'),
    deviceLabel: text('device_label'),
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('security_event_user_at').on(t.userId, t.at.desc()),
    // The identity sweep deletes a year old events, oldest first (AC-898).
    index('security_event_at').on(t.at),
    foreignKey({ name: 'security_event_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    check('security_event_kind', sql.raw(`kind in (${SECURITY_EVENT_KINDS.map((kind) => `'${kind}'`).join(', ')})`)),
  ],
);

/**
 * A person's authenticator app and backup codes (spec 0033, Better Auth's
 * `twoFactor` plugin): the secret and the codes are encrypted with
 * `BETTER_AUTH_SECRET` and never leave the server after setup (AC-886).
 * `verified` stays false until the first code from the app checks out. The
 * plugin counts failed codes and locks the account's second step a while.
 */
export const twoFactor = auth.table(
  'two_factor',
  {
    id: authId(),
    userId: uuid('user_id').notNull(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
  },
  (t) => [
    uniqueIndex('two_factor_user').on(t.userId),
    foreignKey({ name: 'two_factor_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
  ],
);

/**
 * A person's passkeys (spec 0033, milestone 3, Better Auth's passkey plugin):
 * the public key only, never a secret. `credential_id` is unique across every
 * account, so one credential can't sign in two people. `name` is the person's
 * label (60 characters at most); `last_used_at` is ours, set on each passkey
 * sign in and step up (AC-887).
 */
export const passkey = auth.table(
  'passkey',
  {
    id: authId(),
    userId: uuid('user_id').notNull(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    credentialID: text('credential_id').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (t) => [
    uniqueIndex('passkey_credential').on(t.credentialID),
    index('passkey_user').on(t.userId, t.createdAt),
    check('passkey_name', sql`${t.name} is null or char_length(${t.name}) between 1 and 60`),
    foreignKey({ name: 'passkey_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
  ],
);

/** A way to sign in as a user: a social provider's account (Google). No passwords are stored. */
export const account = auth.table(
  'account',
  {
    id: authId(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('account_provider').on(t.providerId, t.accountId),
    index('account_user').on(t.userId),
    foreignKey({ name: 'account_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
  ],
);

/** Short lived secrets: the hashed sign in codes, keyed by `identifier`. */
export const verification = auth.table(
  'verification',
  {
    id: authId(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier').on(t.identifier)],
);

/** Better Auth's rate limiter (`storage: 'database'`), so limits hold across instances. */
export const rateLimit = auth.table(
  'rate_limit',
  {
    id: authId(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('rate_limit_key').on(t.key)],
);

/**
 * Finds a workspace from its address before any workspace is set. The slug
 * index is unconditional, so a slug once used is never reused. Never read to
 * grant access: the access door reads the tenant `members` row.
 */
export const workspaceDirectory = auth.table(
  'workspace_directory',
  {
    workspaceId: uuid('workspace_id').notNull().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Set while the workspace is deleted (spec 0031, AC-823), so "my workspaces" leaves it out. Grants nothing. */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workspace_directory_slug').on(t.slug),
    // The address rule (spec 0005, value sourcing): lowercase letters and digits in single dash runs, 3 to 40.
    check(
      'workspace_directory_slug_shape',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 3 and 40`,
    ),
    foreignKey({ name: 'workspace_directory_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
  ],
);

/** Which workspaces a user is in, for "my workspaces". Written with the workspace, never read for access. */
export const workspaceMembership = auth.table(
  'workspace_membership',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'workspace_membership_pkey', columns: [t.userId, t.workspaceId] }),
    index('workspace_membership_workspace').on(t.workspaceId),
    foreignKey({ name: 'workspace_membership_user', columns: [t.userId], foreignColumns: [user.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'workspace_membership_directory',
      columns: [t.workspaceId],
      foreignColumns: [workspaceDirectory.workspaceId],
    }),
    foreignKey({
      name: 'workspace_membership_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
  ],
);

/**
 * A person's own preferences that follow them to every device (spec 0031):
 * the workspace they last opened, where `/` and sign in take them. Written
 * only for the caller, and only for a workspace the door let them into; read
 * only to choose where to go, never for access.
 */
export const userPrefs = auth.table(
  'user_prefs',
  {
    userId: uuid('user_id').notNull().primaryKey(),
    lastWorkspaceId: uuid('last_workspace_id'),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: 'user_prefs_user', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    foreignKey({
      name: 'user_prefs_last_workspace',
      columns: [t.lastWorkspaceId],
      foreignColumns: [workspaceDirectory.workspaceId],
    }),
  ],
);

/**
 * The devices an account has signed in from (spec 0033, AC-897): a device is
 * the SHA-256 of its browser family, system and country, never the user agent
 * or address itself. A sign in from a device absent here, or not seen for 90
 * days, emails the account. Rows not seen for a year are deleted by the
 * identity sweep.
 */
export const knownDevice = auth.table(
  'known_device',
  {
    userId: uuid('user_id').notNull(),
    /** 64 lowercase hex digits. */
    deviceKey: text('device_key').notNull(),
    firstSeen: timestamptz('first_seen').notNull().defaultNow(),
    lastSeen: timestamptz('last_seen').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'known_device_pkey', columns: [t.userId, t.deviceKey] }),
    foreignKey({ name: 'known_device_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    check('known_device_key', sql`${t.deviceKey} ~ '^[0-9a-f]{64}$'`),
    index('known_device_last_seen').on(t.lastSeen),
  ],
);
