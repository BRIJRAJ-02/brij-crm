// The business page (spec 0066 B4 lite, migration 0186_business_pages, per property since 0192): a property's public page at
// `/<company-handle>`, its gallery's pictures, and each place's slug with its history. Tenant tables under forced row
// level security with the plain workspace policy; every index leads with workspace_id. The handle itself is held in
// `auth.public_handles` (owner kind `business`) through crm_handle's definers; `handle` here mirrors the current one.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { places, properties } from './hospitality.ts';
import { members, workspaces } from './workspaces.ts';

/**
 * One per property: the current business handle, the editor's draft and the published snapshot (spec 0068's
 * draft and publish pattern, kept here until the shared `page_versions` lands). Guests see only `published`; a page
 * never published is not live.
 */
export const businessPages = pgTable(
  'business_pages',
  {
    workspaceId: workspaceId(),
    propertyId: uuid('property_id').notNull(),
    handle: text('handle'),
    /**
     * The address a business other than the first chose before its first Publish (spec 0065 H7, AC-6592): only a
     * wish, held for nobody, until Publish claims it.
     */
    pendingHandle: text('pending_handle'),
    draft: jsonb('draft')
      .notNull()
      .default(sql`'{}'::jsonb`),
    draftChangedAt: timestamptz('draft_changed_at'),
    published: jsonb('published'),
    publishedAt: timestamptz('published_at'),
    publishedByMemberId: uuid('published_by_member_id'),
    version: integer('version').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'business_pages_pkey', columns: [t.workspaceId, t.propertyId] }),
    foreignKey({
      name: 'business_pages_property',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [properties.workspaceId, properties.id],
    }),
    foreignKey({
      name: 'business_pages_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'business_pages_published_by',
      columns: [t.workspaceId, t.publishedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    index('business_pages_published_by').on(t.workspaceId, t.publishedByMemberId),
    check(
      'business_pages_handle',
      sql`${t.handle} is null or (${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.handle}) between 3 and 40)`,
    ),
    check(
      'business_pages_pending_handle',
      sql`${t.pendingHandle} is null or (${t.pendingHandle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.pendingHandle}) between 3 and 40)`,
    ),
    check('business_pages_draft', sql`jsonb_typeof(${t.draft}) = 'object' and octet_length(${t.draft}::text) <= 32768`),
    check(
      'business_pages_published',
      sql`${t.published} is null or (jsonb_typeof(${t.published}) = 'object' and octet_length(${t.published}::text) <= 32768)`,
    ),
    check('business_pages_live', sql`(${t.published} is null) = (${t.publishedAt} is null)`),
    check('business_pages_version', sql`${t.version} >= 0`),
  ],
);

/**
 * Every business handle a workspace holds or held, and the business (property) it belongs to (spec 0065 H7, AC-6592,
 * migration 0199): `auth.public_handles` says which workspace holds a handle, this says which of its businesses, so the
 * public lookup finds the right page and an old handle keeps finding it. Goes with its business.
 */
export const propertyHandles = pgTable(
  'property_handles',
  {
    workspaceId: workspaceId(),
    handle: text('handle').notNull(),
    propertyId: uuid('property_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'property_handles_pkey', columns: [t.workspaceId, t.handle] }),
    foreignKey({
      name: 'property_handles_property',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [properties.workspaceId, properties.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'property_handles_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    index('property_handles_property').on(t.workspaceId, t.propertyId, t.createdAt),
    check(
      'property_handles_shape',
      sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.handle}) between 3 and 40`,
    ),
  ],
);

/** A picture of the gallery, kept under the server's own path `business-page/<workspace>/<id>.<ext>`. */
export const businessPhotos = pgTable(
  'business_photos',
  {
    workspaceId: workspaceId(),
    id: uuid('id').notNull(),
    propertyId: uuid('property_id').notNull(),
    path: text('path').notNull(),
    type: text('type').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'business_photos_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'business_photos_property',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [properties.workspaceId, properties.id],
    }),
    index('business_photos_property').on(t.workspaceId, t.propertyId, t.createdAt),
    foreignKey({
      name: 'business_photos_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'business_photos_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    index('business_photos_created').on(t.workspaceId, t.createdAt),
    index('business_photos_created_by').on(t.workspaceId, t.createdByMemberId),
    check(
      'business_photos_path',
      sql`${t.path} = 'business-page/' || ${t.workspaceId}::text || '/' || ${t.id}::text || case ${t.type} when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end`,
    ),
    check('business_photos_type', sql`${t.type} in ('image/jpeg', 'image/png', 'image/webp')`),
    check(
      'business_photos_size',
      sql`${t.bytes} between 1 and 4194304 and ${t.width} between 1 and 4096 and ${t.height} between 1 and 4096`,
    ),
  ],
);

/** Every slug a place has held (AC-6640): an old one still finds it; unique per workspace, never a reserved word. */
export const placeSlugs = pgTable(
  'place_slugs',
  {
    workspaceId: workspaceId(),
    slug: text('slug').notNull(),
    placeId: uuid('place_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'place_slugs_pkey', columns: [t.workspaceId, t.slug] }),
    foreignKey({
      name: 'place_slugs_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    index('place_slugs_place').on(t.workspaceId, t.placeId),
    uniqueIndex('place_slugs_owner').on(t.workspaceId, t.slug, t.placeId),
    check('place_slugs_shape', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 1 and 60`),
    check(
      'place_slugs_reserved',
      sql`${t.slug} not in ('book', 'reserve', 'visit', 'menu', 'e', 'events', 'team', 'reviews', 'services')`,
    ),
  ],
);

/** A place's current slug: always one of its own held slugs. */
export const placePages = pgTable(
  'place_pages',
  {
    workspaceId: workspaceId(),
    placeId: uuid('place_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    slug: text('slug').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'place_pages_pkey', columns: [t.workspaceId, t.placeId] }),
    foreignKey({
      name: 'place_pages_place',
      columns: [t.workspaceId, t.placeId, t.propertyId],
      foreignColumns: [places.workspaceId, places.id, places.propertyId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'place_pages_slug',
      columns: [t.workspaceId, t.slug, t.placeId],
      foreignColumns: [placeSlugs.workspaceId, placeSlugs.slug, placeSlugs.placeId],
    }),
    uniqueIndex('place_pages_slug_once').on(t.workspaceId, t.slug),
    index('place_pages_property').on(t.workspaceId, t.propertyId),
  ],
);
