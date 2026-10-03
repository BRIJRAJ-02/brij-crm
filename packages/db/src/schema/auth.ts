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
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
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
  },
  (t) => [
    uniqueIndex('session_token').on(t.token),
    index('session_user').on(t.userId),
    foreignKey({ name: 'session_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
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
