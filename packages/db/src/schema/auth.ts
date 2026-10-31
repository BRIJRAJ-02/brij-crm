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
  customType,
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

/** Raw bytes, for the one picture this schema keeps: a link page's own share image (spec 0055, AC-5511). */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

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
 * the current one); none is freed while its person exists, nor for 90 days after their account is deleted
 * (migration 0126: the person cleared, `releasedAt` stamped, then `crm_sweep_released_handles` frees it). At 20, a
 * person's oldest handle no page uses goes into that same hold to make room for a new one (migration 0124). Written
 * only through `crm_save_public_profile` (migration 0086) and `crm_ensure_public_profile`, which makes a new
 * membership's first one (migration 0115).
 */
export const publicHandles = auth.table(
  'public_handles',
  {
    handle: text('handle').notNull(),
    /** Null once its person's account is deleted, or it made room at the cap: held, naming nobody, until swept. */
    userId: uuid('user_id'),
    /** The one workspace this handle, and the link page behind it, belong to (spec 0056, AC-5601). */
    workspaceId: uuid('workspace_id').notNull(),
    createdAt: createdAt(),
    /** When it was let go (its person's account deleted, or room made at the cap): set with a null `userId` only. */
    releasedAt: timestamptz('released_at'),
  },
  (t) => [
    primaryKey({ name: 'public_handles_pkey', columns: [t.handle] }),
    check('public_handles_released', sql`(${t.userId} is null) = (${t.releasedAt} is not null)`),
    index('public_handles_released')
      .on(t.releasedAt)
      .where(sql`${t.releasedAt} is not null`),
    index('public_handles_user_workspace').on(t.userId, t.workspaceId),
    uniqueIndex('public_handles_membership').on(t.handle, t.userId, t.workspaceId),
    check(
      'public_handles_shape',
      sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.handle}) between 3 and 40`,
    ),
    foreignKey({ name: 'public_handles_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('set null'),
  ],
);

/** A person's public profile in ONE workspace (spec 0056): their current handle there and a one line bio. */
export const publicProfiles = auth.table(
  'public_profiles',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    handle: text('handle').notNull(),
    bio: text('bio').notNull().default(''),
    /** The link page's look (spec 0054, spec 0060): ten names from closed sets, never a colour or a size. */
    theme: jsonb('theme')
      .notNull()
      .default(
        sql`'{"ground":"plain","hue":"blue","mode":"light","shape":"soft","fill":"plain","font":"sans","gradient":"dawn","pattern":"dots","header":"centred","avatar":"circle"}'::jsonb`,
      ),
    /** Whether search engines may show the link page (spec 0055, AC-5506): on until its owner says otherwise. */
    indexable: boolean('indexable').notNull().default(true),
    /**
     * The picture a pasted link shows instead of the drawn card (spec 0055, AC-5511), with its type and a short
     * version for the path that serves it. The three are set together or all null. The app never reads or writes
     * these columns itself: `crm_save_profile_share_image` writes them and `crm_profile_share_image` reads them.
     */
    shareImage: bytea('share_image'),
    shareImageType: text('share_image_type'),
    shareImageVersion: text('share_image_version'),
    /**
     * Since when the link page is public, or null while it is private (27 Oct 2026; spec 0058, AC-23). A page made
     * with a membership starts private, and goes live when its owner claims it or opens it
     * (`crm_show_public_profile`); the owner's Live or Private switch sets it (`crm_set_public_profile_live`).
     */
    shownAt: timestamptz('shown_at'),
    /**
     * When the page became its owner's own choice: claimed, opened or switched (spec 0058, AC-23). Null for a page
     * made for them they haven't touched; once set, nothing but the switch changes whether the page is public.
     */
    claimedAt: timestamptz('claimed_at'),
    /**
     * The link page's own accent pair (spec 0060, AC-14): checked hexes, null to follow the workspace's brand (and,
     * for the dark one, to lift the light one). Its personal booking pages wear it too. Written only by
     * `crm_save_profile_accent`.
     */
    accent: text('accent'),
    accentDark: text('accent_dark'),
    /**
     * The cover photo and the photo ground (spec 0060, AC-10, AC-13): a store path the server made, its type and a
     * short version for the path that serves it, all three or none. Written only by `crm_save_profile_image`.
     */
    coverPath: text('cover_path'),
    coverType: text('cover_type'),
    coverVersion: text('cover_version'),
    groundPath: text('ground_path'),
    groundType: text('ground_type'),
    groundVersion: text('ground_version'),
    /**
     * The share QR's style (spec 0061, AC-6124): a module colour, a centre picture and a frame label, at most 1,024
     * bytes, null for the plain code. Written only by `crm_save_profile_qr_style`.
     */
    qrStyle: jsonb('qr_style'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'public_profiles_pkey', columns: [t.userId, t.workspaceId] }),
    uniqueIndex('public_profiles_handle').on(t.handle),
    check('public_profiles_bio', sql`char_length(${t.bio}) <= 160`),
    check(
      'public_profiles_theme',
      // Postgres refuses a subquery in a check constraint, so "no key but these ten" is the ten taken away leaving
      // an empty object. A check whose expression is NULL passes, so "all ten present" needs `coalesce`.
      sql`${t.theme} is null or (
        jsonb_typeof(${t.theme}) = 'object'
        and ${t.theme} - 'ground' - 'hue' - 'mode' - 'shape' - 'fill' - 'font' - 'gradient' - 'pattern' - 'header' - 'avatar' = '{}'::jsonb
        and coalesce(${t.theme} ->> 'ground', '') in ('plain', 'paper', 'tint', 'ink', 'gradient', 'pattern', 'image')
        and coalesce(${t.theme} ->> 'hue', '') in ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple')
        and coalesce(${t.theme} ->> 'mode', '') in ('light', 'dark', 'system')
        and coalesce(${t.theme} ->> 'shape', '') in ('soft', 'pill', 'square')
        and coalesce(${t.theme} ->> 'fill', '') in ('plain', 'soft', 'outline', 'solid')
        and coalesce(${t.theme} ->> 'font', '') in ('sans', 'mono', 'grotesk', 'editorial', 'classic', 'friendly', 'geometric', 'display')
        and coalesce(${t.theme} ->> 'gradient', '') in ('dawn', 'dusk', 'mint', 'ocean', 'peach', 'grape', 'sand', 'graphite')
        and coalesce(${t.theme} ->> 'pattern', '') in ('dots', 'grid', 'lines', 'waves')
        and coalesce(${t.theme} ->> 'header', '') in ('centred', 'cover', 'left')
        and coalesce(${t.theme} ->> 'avatar', '') in ('circle', 'rounded', 'none')
      )`,
    ),
    check(
      'public_profiles_accent',
      sql`(${t.accent} is null or ${t.accent} ~ '^#[0-9a-f]{6}$')
        and (${t.accentDark} is null or (${t.accentDark} ~ '^#[0-9a-f]{6}$' and ${t.accent} is not null))`,
    ),
    check(
      'public_profiles_cover',
      sql`(${t.coverPath} is null and ${t.coverType} is null and ${t.coverVersion} is null)
        or (${t.coverPath} ~ ('^profile-images/' || ${t.userId}::text || '/' || ${t.workspaceId}::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
          and ${t.coverType} in ('image/png', 'image/jpeg', 'image/webp')
          and ${t.coverVersion} ~ '^[0-9a-f]{12}$')`,
    ),
    check(
      'public_profiles_ground',
      sql`(${t.groundPath} is null and ${t.groundType} is null and ${t.groundVersion} is null)
        or (${t.groundPath} ~ ('^profile-images/' || ${t.userId}::text || '/' || ${t.workspaceId}::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
          and ${t.groundType} in ('image/png', 'image/jpeg', 'image/webp')
          and ${t.groundVersion} ~ '^[0-9a-f]{12}$')`,
    ),
    check(
      'public_profiles_qr_style',
      sql`${t.qrStyle} is null or (jsonb_typeof(${t.qrStyle}) = 'object' and pg_column_size(${t.qrStyle}) <= 1024)`,
    ),
    foreignKey({ name: 'public_profiles_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    // The handle is one this same membership holds (migration 0113).
    foreignKey({
      name: 'public_profiles_membership_fk',
      columns: [t.handle, t.userId, t.workspaceId],
      foreignColumns: [publicHandles.handle, publicHandles.userId, publicHandles.workspaceId],
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
    /** The workspace whose link page this block is on (spec 0056, AC-5604): every kind carries one. */
    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id'),
    /** Set only for `kind = 'form'`, always beside `workspaceId` (spec 0052, AC-5213). */
    formId: uuid('form_id'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: 'profile_items_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    check(
      'profile_items_kind',
      sql`${t.kind} in ('link', 'page', 'heading', 'contact', 'text', 'faq', 'form', 'testimonial', 'socials', 'media', 'image', 'gallery', 'times', 'banner')`,
    ),
    check('profile_items_position', sql`${t.position} between 0 and 999`),
    check('profile_items_placed', sql`(${t.archivedAt} is null) = (${t.position} is not null)`),
    check('profile_items_data', sql`jsonb_typeof(${t.data}) = 'object' and pg_column_size(${t.data}) <= 16384`),
    // A next times block names a booking page as a page block does (spec 0061, migration 0144).
    check('profile_items_target', sql`(${t.kind} in ('page', 'times')) = (${t.pageId} is not null)`),
    check('profile_items_form', sql`(${t.kind} = 'form') = (${t.formId} is not null)`),
    check('profile_items_page', sql`${t.kind} not in ('page', 'times') or ${t.pageId} is not null`),
    check(
      'profile_items_plain',
      sql`${t.kind} not in ('link', 'heading', 'contact', 'text', 'faq', 'testimonial', 'socials', 'media', 'image', 'gallery', 'banner') or (${t.pageId} is null and ${t.formId} is null)`,
    ),
    uniqueIndex('profile_items_page_once')
      .on(t.userId, t.workspaceId, t.pageId)
      .where(sql`${t.kind} = 'page' and ${t.archivedAt} is null`),
    uniqueIndex('profile_items_form_once')
      .on(t.userId, t.workspaceId, t.formId)
      .where(sql`${t.kind} = 'form' and ${t.archivedAt} is null`),
    // Up to three contact cards since spec 0061 (AC-6114): the cap is crm_save_profile_item's, as every kind's is.
    uniqueIndex('profile_items_heading_once')
      .on(t.userId, t.workspaceId, sql`lower(btrim(${t.data} ->> 'title'))`)
      .where(sql`${t.kind} = 'heading' and ${t.archivedAt} is null`),
    index('profile_items_archived')
      .on(t.userId, t.workspaceId, t.archivedAt)
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
    workspaceId: uuid('workspace_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    visitor: text('visitor').notNull(),
    views: integer('views').notNull().default(1),
    firstAt: timestamptz('first_at').notNull().defaultNow(),
    lastAt: timestamptz('last_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'profile_views_pkey', columns: [t.userId, t.workspaceId, t.day, t.visitor] }),
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
 * One link in bio page brought across (spec 0055, AC-5524 to AC-5528). The blocks it made are ordinary hidden
 * blocks in `profile_items`; this row is what makes an import idempotent on its own id, countable (five an hour),
 * and reviewable: `itemIds` holds the rows it made in the order the page had them, and `skipped` the rows it
 * could not map, each with whatever it had and why, so nothing is dropped without being shown.
 *
 * Reached only through `crm_import_profile_links` (migration 0109), owned by `crm_handle`: the app role has no
 * privilege on this table at all.
 */
export const linkImports = auth.table(
  'link_imports',
  {
    id: uuid('id').notNull().primaryKey(),
    userId: uuid('user_id').notNull(),
    /** The address the rows came from, as the person gave it. Never fetched again from here. */
    source: text('source').notNull(),
    itemIds: uuid('item_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    skipped: jsonb('skipped')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'link_imports_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    index('link_imports_recent').on(t.userId, t.createdAt.desc()),
    check('link_imports_source', sql`char_length(${t.source}) <= 400`),
    check('link_imports_items', sql`array_length(${t.itemIds}, 1) is null or array_length(${t.itemIds}, 1) <= 40`),
    // Bounded where it lands as well as where it is made: a page of bare anchors has thousands of rows we can't
    // make, and this row is kept and sent back (the security review, 25 October 2026).
    check(
      'link_imports_skipped',
      sql`jsonb_typeof(${t.skipped}) = 'array' and jsonb_array_length(${t.skipped}) <= 100 and pg_column_size(${t.skipped}) <= 65536`,
    ),
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
    workspaceId: uuid('workspace_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'profile_view_days_pkey', columns: [t.userId, t.workspaceId, t.day] }),
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

/**
 * The pictures of a person's link page in one workspace (spec 0061, AC-6101, AC-6108, AC-6128): an upload, a link's
 * thumbnail, or a media block's poster, each a private object in the file store under `link-page/` with its metadata
 * removed. A block names one by `id` in its `data`; the bytes are served only while a live block on that page uses
 * it (`crm_profile_image_public`), and one no block uses is swept after a day. Goes with its page
 * (`public_profiles`, so a purged workspace's go too) and with its person.
 *
 * Forced row level security with one policy, for crm_handle, whose definers are the only way in (migration 0144);
 * crm_app holds no grant, and the identity login's default grant reads nothing through the policy.
 */
export const profileImages = auth.table(
  'profile_images',
  {
    id: uuid('id').notNull().primaryKey(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    /** `upload`, `thumb` or `poster`: what made it, never who may see it. */
    kind: text('kind').notNull(),
    /** Its store path, made by the server: `link-page/<user>/<workspace>/<id>.<jpg|png|webp>`. */
    path: text('path').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('profile_images_path').on(t.path),
    index('profile_images_page').on(t.userId, t.workspaceId),
    index('profile_images_created').on(t.createdAt),
    check('profile_images_kind', sql`${t.kind} in ('upload', 'thumb', 'poster')`),
    check(
      'profile_images_shape',
      sql`${t.path} ~ ('^link-page/' || ${t.userId}::text || '/' || ${t.workspaceId}::text || '/' || ${t.id}::text || '[.](png|jpg|webp)$')
        and ${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')
        and ${t.bytes} between 1 and 1572864
        and ${t.width} between 1 and 4096 and ${t.height} between 1 and 4096`,
    ),
    foreignKey({ name: 'profile_images_user_fk', columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),
    foreignKey({
      name: 'profile_images_page_fk',
      columns: [t.userId, t.workspaceId],
      foreignColumns: [publicProfiles.userId, publicProfiles.workspaceId],
    }).onDelete('cascade'),
  ],
);

/**
 * A link page's views by day and by fact (spec 0061, AC-6116, AC-6117): the referring host, the `utm_source`, the
 * country and the device class, each a value, rolled up per day in the statement that counts the view. A visitor
 * counts once per day per value, their first view of the day deciding. Past the day's top 50 values of a fact the
 * rest fold into `Other`. No address, no user agent and no visitor id is in it. Swept after a year with the views.
 * Forced row level security for crm_handle alone, as `profile_images`.
 */
export const profileViewSourceDays = auth.table(
  'profile_view_source_days',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    fact: text('fact').notNull(),
    value: text('value').notNull(),
    views: integer('views').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'profile_view_source_days_pkey', columns: [t.userId, t.workspaceId, t.day, t.fact, t.value] }),
    index('profile_view_source_days_day').on(t.day),
    check('profile_view_source_days_fact', sql`${t.fact} in ('referrer', 'source', 'country', 'device')`),
    check(
      'profile_view_source_days_value',
      sql`char_length(${t.value}) between 1 and 120 and ${t.value} !~ '[[:cntrl:][:space:]]'`,
    ),
    check('profile_view_source_days_count', sql`${t.views} >= 0 and ${t.visitors} >= 0`),
    foreignKey({
      name: 'profile_view_source_days_page_fk',
      columns: [t.userId, t.workspaceId],
      foreignColumns: [publicProfiles.userId, publicProfiles.workspaceId],
    }).onDelete('cascade'),
  ],
);

/**
 * Bookings made from a link page, by day (spec 0061, AC-6119): one more when a booking request carries
 * `via: { handle }` and that page is a live block on that handle's page. Nothing about it is stored on the booking.
 * Swept after a year with the views. Forced row level security for crm_handle alone, as `profile_images`.
 */
export const profileBookingDays = auth.table(
  'profile_booking_days',
  {
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    bookings: integer('bookings').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'profile_booking_days_pkey', columns: [t.userId, t.workspaceId, t.day] }),
    index('profile_booking_days_day').on(t.day),
    check('profile_booking_days_count', sql`${t.bookings} >= 0`),
    foreignKey({
      name: 'profile_booking_days_page_fk',
      columns: [t.userId, t.workspaceId],
      foreignColumns: [publicProfiles.userId, publicProfiles.workspaceId],
    }).onDelete('cascade'),
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
