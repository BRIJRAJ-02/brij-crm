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
import { SECURITY_EVENT_KINDS, SOCIAL_LINK_NETWORKS } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
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
    // The operator console's users list, newest first (spec 0047), and its sign ups a day.
    index('user_created').on(t.createdAt, t.id),
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
    /** "Chrome on macOS": the user agent read once at sign in, for Account › Sign in and devices › Devices. */
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
 * A person's passkeys (spec 0033, milestone 3, Better Auth's passkey plugin).
 * Unused since 22 October 2026 (the owner took passkeys out); the table stays
 * until a later migration drops it, and rows go with their user (cascade):
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

/**
 * Every address a workspace has held, its current one included (Settings ›
 * Workspace › General): the primary key keeps an address with the first
 * workspace to claim it for as long as that workspace exists, so a link with
 * an old address still finds it and no other workspace can take it. Written
 * only by `crm_claim_workspace_address` (migration 0083), which acts on the
 * workspace the transaction is set to; removed with the directory row when a
 * workspace is purged. Never read to grant access.
 */
export const workspaceAddresses = auth.table(
  'workspace_addresses',
  {
    slug: text('slug').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'workspace_addresses_pkey', columns: [t.slug] }),
    index('workspace_addresses_workspace').on(t.workspaceId),
    check(
      'workspace_addresses_slug_shape',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 3 and 40`,
    ),
    foreignKey({
      name: 'workspace_addresses_directory',
      columns: [t.workspaceId],
      foreignColumns: [workspaceDirectory.workspaceId],
    }).onDelete('cascade'),
  ],
);

/**
 * Every public handle a person has held, their current one included (booking addresses, 22 Oct 2026): the
 * address `/<handle>` of their profile and `/<handle>/<slug>` of each booking page. Keyed by the handle alone, so
 * it is unique across every workspace, and an old handle keeps finding its person (the public page then moves to
 * the current one); none is freed while its person exists. Written only through `crm_save_public_profile`
 * (migration 0086).
 */
export const publicHandles = auth.table(
  'public_handles',
  {
    handle: text('handle').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'public_handles_pkey', columns: [t.handle] }),
    index('public_handles_user').on(t.userId),
    check(
      'public_handles_shape',
      sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.handle}) between 3 and 40`,
    ),
    foreignKey({ name: 'public_handles_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
  ],
);

/** A person's public profile (booking addresses): their current handle and a one line bio. */
export const publicProfiles = auth.table(
  'public_profiles',
  {
    userId: uuid('user_id').notNull(),
    handle: text('handle').notNull(),
    bio: text('bio').notNull().default(''),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'public_profiles_pkey', columns: [t.userId] }),
    uniqueIndex('public_profiles_handle').on(t.handle),
    check('public_profiles_bio', sql`char_length(${t.bio}) <= 160`),
    foreignKey({ name: 'public_profiles_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    foreignKey({
      name: 'public_profiles_handle_fk',
      columns: [t.handle],
      foreignColumns: [publicHandles.handle],
    }),
  ],
);

/**
 * The blocks of a person's link page at `/<handle>` (spec 0051, built as blocks): one ordered list per person, never
 * a workspace's, so leaving a workspace never takes their LinkedIn with it. The common columns are real; everything
 * else a kind holds is `data`, checked by its Zod schema (`ProfileBlock` in `@crm/contracts`) before every write and
 * again by the definer, so a new kind is a schema and a renderer, and at most one line in `profile_items_kind`. A
 * `page` block names a booking page by its workspace and id, and nothing else: whether a visitor sees it is still the
 * booking lookup's call. `position` is null while archived, so only live blocks hold places; the deferred unique
 * `(user_id, position)` (hand written in migration 0098) lets a reorder set every place in one statement. Written and
 * read only through crm_handle's definers (migration 0098); crm_app holds no grant on it.
 */
export const profileItems = auth.table(
  'profile_items',
  {
    id: uuid('id').notNull().primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    position: smallint('position'),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
    workspaceId: uuid('workspace_id'),
    pageId: uuid('page_id'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: 'profile_items_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    check('profile_items_kind', sql`${t.kind} in ('link', 'page', 'heading', 'contact')`),
    check('profile_items_position', sql`${t.position} between 0 and 999`),
    check('profile_items_placed', sql`(${t.archivedAt} is null) = (${t.position} is not null)`),
    check('profile_items_data', sql`jsonb_typeof(${t.data}) = 'object' and pg_column_size(${t.data}) <= 4096`),
    check('profile_items_target', sql`(${t.workspaceId} is null) = (${t.pageId} is null)`),
    check('profile_items_page', sql`${t.kind} <> 'page' or ${t.pageId} is not null`),
    check('profile_items_plain', sql`${t.kind} not in ('link', 'heading', 'contact') or ${t.pageId} is null`),
    uniqueIndex('profile_items_page_once')
      .on(t.userId, t.workspaceId, t.pageId)
      .where(sql`${t.kind} = 'page' and ${t.archivedAt} is null`),
    uniqueIndex('profile_items_contact_once')
      .on(t.userId)
      .where(sql`${t.kind} = 'contact' and ${t.archivedAt} is null`),
    uniqueIndex('profile_items_heading_once')
      .on(t.userId, sql`lower(btrim(${t.data} ->> 'title'))`)
      .where(sql`${t.kind} = 'heading' and ${t.archivedAt} is null`),
    index('profile_items_archived')
      .on(t.userId, t.archivedAt)
      .where(sql`${t.archivedAt} is not null`),
  ],
);

/**
 * A link page's views (spec 0051, AC-5124): one row per owner, UTC day and visitor (the daily HMAC spec 0047 mints,
 * never an address or a user agent), with how many times that visitor read it that day. Reached only through
 * crm_handle's definers; swept after a year by the daily cleanup.
 */
export const profileViews = auth.table(
  'profile_views',
  {
    userId: uuid('user_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    visitor: text('visitor').notNull(),
    views: integer('views').notNull().default(1),
    firstAt: timestamptz('first_at').notNull().defaultNow(),
    lastAt: timestamptz('last_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'profile_views_pkey', columns: [t.userId, t.day, t.visitor] }),
    foreignKey({ name: 'profile_views_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    // The cleanup's pick, oldest days first.
    index('profile_views_day').on(t.day),
    check('profile_views_visitor', sql`${t.visitor} ~ '^[0-9a-f]{32}$'`),
    check('profile_views_count', sql`${t.views} >= 1`),
  ],
);

/**
 * A link page block's presses (spec 0051, AC-5125): one row per block, UTC day and visitor, with how many times that
 * visitor pressed it that day. Goes with its block; swept after a year.
 */
export const profileItemPresses = auth.table(
  'profile_item_presses',
  {
    itemId: uuid('item_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    visitor: text('visitor').notNull(),
    presses: integer('presses').notNull().default(1),
    firstAt: timestamptz('first_at').notNull().defaultNow(),
    lastAt: timestamptz('last_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'profile_item_presses_pkey', columns: [t.itemId, t.day, t.visitor] }),
    foreignKey({
      name: 'profile_item_presses_item_fk',
      columns: [t.itemId],
      foreignColumns: [profileItems.id],
    }).onDelete('cascade'),
    index('profile_item_presses_day').on(t.day),
    check('profile_item_presses_visitor', sql`${t.visitor} ~ '^[0-9a-f]{32}$'`),
    check('profile_item_presses_count', sql`${t.presses} >= 1`),
  ],
);

/**
 * A link page's views by day (spec 0051, AC-5127): one row per owner and UTC day, kept beside `profile_views` by the
 * same statement (a visitor's first view of the day adds one visitor), so the editor's figures read at most 60 rows
 * however many people looked.
 */
export const profileViewDays = auth.table(
  'profile_view_days',
  {
    userId: uuid('user_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'profile_view_days_pkey', columns: [t.userId, t.day] }),
    foreignKey({ name: 'profile_view_days_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete(
      'cascade',
    ),
    index('profile_view_days_day').on(t.day),
    check('profile_view_days_count', sql`${t.views} >= 0 and ${t.visitors} >= 0`),
  ],
);

/** A link page block's presses by day (spec 0051, AC-5127), kept beside `profile_item_presses` the same way. */
export const profileItemPressDays = auth.table(
  'profile_item_press_days',
  {
    itemId: uuid('item_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    presses: integer('presses').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'profile_item_press_days_pkey', columns: [t.itemId, t.day] }),
    foreignKey({
      name: 'profile_item_press_days_item_fk',
      columns: [t.itemId],
      foreignColumns: [profileItems.id],
    }).onDelete('cascade'),
    index('profile_item_press_days_day').on(t.day),
    check('profile_item_press_days_count', sql`${t.presses} >= 0`),
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
 * only to choose where to go, never for access. And whether their account
 * picture stays off their public pages (owner ask A124, migration 0094),
 * written and read only through crm_handle's functions.
 */
export const userPrefs = auth.table(
  'user_prefs',
  {
    userId: uuid('user_id').notNull().primaryKey(),
    lastWorkspaceId: uuid('last_workspace_id'),
    /** Their booking pages and profile show initials, never their account picture. No row reads as false. */
    pictureHidden: boolean('picture_hidden').notNull().default(false),
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
 * A person's own social links (booking socials, migration 0097): one per network, at most ten, in their order,
 * shown on their booking pages and their `/<handle>` profile. The person's, like their handle and bio, so the same in
 * every workspace. Written and read only through crm_handle's functions (`crm_save_social_links`,
 * `crm_social_links_of`); the app's write path stores only the canonical link `checkSocialLink` made.
 */
export const socialLinks = auth.table(
  'social_links',
  {
    userId: uuid('user_id').notNull(),
    /** One of `SOCIAL_LINK_NETWORKS`. */
    network: text('network').notNull(),
    /** The canonical link: an http or https address of at most 2,048 characters. */
    href: text('href').notNull(),
    /** Its place in the person's order, 0 to 9. */
    position: smallint('position').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'social_links_pkey', columns: [t.userId, t.network] }),
    foreignKey({ name: 'social_links_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    check(
      'social_links_network',
      sql.raw(`network in (${SOCIAL_LINK_NETWORKS.map((network) => `'${network}'`).join(', ')})`),
    ),
    check('social_links_href', sql`char_length(${t.href}) <= 2048 and ${t.href} ~ '^https?://'`),
    check('social_links_position', sql`${t.position} between 0 and 9`),
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

/**
 * The days a person used the app (spec 0047, AC-1624): one row per person and
 * UTC day, written from the session check at most once per person every 10
 * minutes per api process. What the operator console's "last active" and
 * "active days" read. Deleted with the person, and after a year by the
 * identity sweep.
 */
export const activityDay = auth.table(
  'activity_day',
  {
    userId: uuid('user_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    firstAt: timestamptz('first_at').notNull().defaultNow(),
    lastAt: timestamptz('last_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'activity_day_pkey', columns: [t.userId, t.day] }),
    foreignKey({ name: 'activity_day_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    index('activity_day_day').on(t.day, t.userId),
  ],
);

/**
 * One page shown on the marketing site (spec 0047, AC-1627), from its own
 * beacon to our api: the path with no query, the referring site's host, the
 * `utm_source`, the country from the edge, a device class and a daily visitor
 * id (an HMAC of the day, the address and the user agent; neither is kept).
 * No foreign key: nobody is signed in. Deleted after a year by the identity
 * sweep.
 */
export const siteVisit = auth.table(
  'site_visit',
  {
    id: authId(),
    at: timestamptz('at').notNull().defaultNow(),
    /** The marketing site's host, from the hit's Origin (one on `SITE_ORIGINS`). */
    site: text('site').notNull(),
    path: text('path').notNull(),
    referrer: text('referrer'),
    source: text('source'),
    country: text('country'),
    device: text('device', { enum: ['mobile', 'tablet', 'desktop'] }).notNull(),
    visitor: text('visitor').notNull(),
  },
  (t) => [
    index('site_visit_at').on(t.at),
    check('site_visit_path', sql`char_length(${t.path}) between 1 and 200 and left(${t.path}, 1) = '/'`),
    check('site_visit_site', sql`char_length(${t.site}) between 1 and 120`),
    check('site_visit_referrer', sql`char_length(${t.referrer}) between 1 and 120`),
    check('site_visit_source', sql`char_length(${t.source}) between 1 and 60`),
    check('site_visit_country', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('site_visit_device', sql`${t.device} in ('mobile', 'tablet', 'desktop')`),
    check('site_visit_visitor', sql`${t.visitor} ~ '^[0-9a-f]{32}$'`),
  ],
);

/**
 * The operator console's own log (spec 0047, AC-1620): one row per read, written
 * before the read runs. No foreign key to the operator: the log outlives the
 * account. Deleted after two years by the identity sweep.
 */
export const operatorEvent = auth.table(
  'operator_event',
  {
    id: authId(),
    at: timestamptz('at').notNull().defaultNow(),
    userId: uuid('user_id').notNull(),
    /** The procedure, such as `operator.user`. */
    action: text('action').notNull(),
    /** The person or page read, by id, when the read names one. */
    target: uuid('target'),
    /** The period the read asked for: `7d`, `30d` or `90d`. */
    period: text('period'),
    /** The users list's search as typed, when there was one: who looked whom up is what this log answers. */
    q: text('q'),
    requestId: text('request_id').notNull(),
  },
  (t) => [
    index('operator_event_at').on(t.at),
    check('operator_event_action', sql`${t.action} ~ '^operator\\.[a-zA-Z]{1,40}$'`),
    check('operator_event_period', sql`${t.period} in ('7d', '30d', '90d')`),
    check('operator_event_request', sql`char_length(${t.requestId}) between 1 and 100`),
    check('operator_event_q', sql`char_length(${t.q}) between 1 and 100`),
  ],
);
