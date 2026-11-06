// The business apps' shared base (spec 0065, H0, migration 0181_hospitality_apps), Hospitality first: which apps a workspace installed,
// its properties (migration 0192; spec 0065 H7), its places with opening hours, and each place's areas and tables. Tenant tables under forced
// row level security with the plain workspace policy; every index leads with workspace_id, but the places' two public
// keys, which a guest page finds before the workspace is known (H1, H3), so they are unique everywhere.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamptz, workspaceId } from './common.ts';
import { members, workspaces } from './workspaces.ts';

/**
 * One app a workspace installed (AC-6503): removal sets `removed_at` and keeps every row of the app; installing again
 * clears it. `plan` stays null until per app billing (#38, #42).
 */
export const workspaceApps = pgTable(
  'workspace_apps',
  {
    workspaceId: workspaceId(),
    app: text('app').notNull(),
    installedAt: timestamptz('installed_at').notNull().defaultNow(),
    installedByMemberId: uuid('installed_by_member_id'),
    removedAt: timestamptz('removed_at'),
    plan: text('plan'),
  },
  (t) => [
    primaryKey({ name: 'workspace_apps_pkey', columns: [t.workspaceId, t.app] }),
    foreignKey({
      name: 'workspace_apps_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workspace_apps_installed_by',
      columns: [t.workspaceId, t.installedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    index('workspace_apps_installed_by').on(t.workspaceId, t.installedByMemberId),
    check('workspace_apps_app', sql`${t.app} in ('menu', 'menu_qr', 'table_seating', 'appointments', 'events')`),
    check('workspace_apps_plan', sql`${t.plan} is null or char_length(${t.plan}) between 1 and 40`),
  ],
);

/**
 * A property (AC-6512, AC-6513): one brand of the workspace, with its own places, menus, services, look and currency.
 * Every workspace has one at position 0, from a trigger on `workspaces`. Its `name` and `kind` stay null until someone
 * sets it up, which is what "no business yet" reads as. No logo of its own falls back to the workspace's brand kit.
 */
export const properties = pgTable(
  'properties',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name'),
    kind: text('kind'),
    description: text('description'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    /** The person socials model's link list, at business level: `[{ network, href }]`. */
    links: jsonb('links')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The guest look (AC-6570 as amended): one checked `MenuLook` document; null is the default, Warm. */
    look: jsonb('look'),
    /** What every price of this property is in (ISO 4217); none reads as US dollars. */
    currency: text('currency'),
    country: text('country'),
    logoPath: text('logo_path'),
    logoType: text('logo_type'),
    logoVersion: text('logo_version'),
    position: smallint('position').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'properties_pkey', columns: [t.workspaceId, t.id] }),
    uniqueIndex('properties_first')
      .on(t.workspaceId)
      .where(sql`${t.position} = 0`),
    index('properties_order').on(t.workspaceId, t.position),
    check('properties_set_up', sql`(${t.name} is null) = (${t.kind} is null)`),
    check('properties_position', sql`${t.position} between 0 and 19`),
    check('properties_currency', sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check('properties_country', sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
    check(
      'properties_logo',
      sql`(${t.logoPath} is null and ${t.logoType} is null and ${t.logoVersion} is null)
        or (${t.logoPath} ~ ('^logos/' || ${t.workspaceId}::text || '/[0-9a-f-]{36}[.](png|jpg|webp)$')
          and ${t.logoType} in ('image/png', 'image/jpeg', 'image/webp')
          and ${t.logoVersion} ~ '^[0-9a-f]{12}$')`,
    ),
    check(
      'properties_look',
      sql`${t.look} is null or (jsonb_typeof(${t.look}) = 'object' and octet_length(${t.look}::text) <= 2000)`,
    ),
    foreignKey({
      name: 'properties_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    check('properties_name', sql`char_length(${t.name}) between 1 and 80`),
    check(
      'properties_kind',
      sql`${t.kind} in ('restaurant', 'cafe', 'bar', 'bakery', 'salon', 'spa', 'barber', 'clinic', 'fitness', 'other')`,
    ),
    check('properties_description', sql`char_length(${t.description}) <= 160`),
    check('properties_phone', sql`char_length(${t.phone}) <= 40`),
    check('properties_email', sql`char_length(${t.email}) <= 254`),
    check('properties_website', sql`char_length(${t.website}) <= 2048`),
    check('properties_links', sql`jsonb_typeof(${t.links}) = 'array' and jsonb_array_length(${t.links}) <= 10`),
  ],
);

/** A place (location) of a property (AC-6508, AC-6514), with its opening hours as one checked `PlaceHours` document. */
export const places = pgTable(
  'places',
  {
    workspaceId: workspaceId(),
    id: id(),
    propertyId: uuid('property_id').notNull(),
    name: text('name').notNull(),
    addressLine: text('address_line'),
    city: text('city'),
    postcode: text('postcode'),
    country: text('country').notNull(),
    timeZone: text('time_zone').notNull(),
    locale: text('locale').notNull(),
    phone: text('phone'),
    hours: jsonb('hours')
      .notNull()
      .default(sql`'{"weekly":{},"exceptions":[]}'::jsonb`),
    /** The reservation page's key (H3) and the guest menu's (H1): 16 URL safe characters each. */
    publicKey: text('public_key').notNull(),
    menuKey: text('menu_key').notNull(),
    position: smallint('position').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'places_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'places_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'places_property',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [properties.workspaceId, properties.id],
    }),
    uniqueIndex('places_in_property').on(t.workspaceId, t.id, t.propertyId),
    index('places_property').on(t.workspaceId, t.propertyId, t.position),
    uniqueIndex('places_public_key').on(t.publicKey),
    uniqueIndex('places_menu_key').on(t.menuKey),
    index('places_order').on(t.workspaceId, t.position),
    check('places_name', sql`char_length(${t.name}) between 1 and 80`),
    check(
      'places_address',
      sql`char_length(${t.addressLine}) <= 200 and char_length(${t.city}) <= 100
      and char_length(${t.postcode}) <= 20`,
    ),
    check('places_country', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('places_time_zone', sql`char_length(${t.timeZone}) between 1 and 64`),
    check('places_locale', sql`${t.locale} ~ '^[a-z]{2,3}(-[A-Z]{2})?$'`),
    check('places_phone', sql`char_length(${t.phone}) <= 40`),
    check(
      'places_hours',
      sql`jsonb_typeof(${t.hours}) = 'object' and ${t.hours} ? 'weekly' and ${t.hours} ? 'exceptions'`,
    ),
    check('places_public_key', sql`${t.publicKey} ~ '^[A-Za-z0-9_-]{16}$'`),
    check('places_menu_key', sql`${t.menuKey} ~ '^[A-Za-z0-9_-]{16}$'`),
    check('places_position', sql`${t.position} between 0 and 19`),
  ],
);

/** An area of a place (Inside, Terrace, Bar; up to 12, AC-6509). */
export const areas = pgTable(
  'areas',
  {
    workspaceId: workspaceId(),
    id: id(),
    placeId: uuid('place_id').notNull(),
    name: text('name').notNull(),
    position: smallint('position').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'areas_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'areas_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    uniqueIndex('areas_name').on(t.workspaceId, t.placeId, sql`lower(${t.name})`),
    check('areas_name_length', sql`char_length(${t.name}) between 1 and 40`),
  ],
);

/**
 * What a place books or seats (AC-6509, generalised 4 Nov 2026 so every business app shares it): a table, a room, a
 * chair, a bed, a court, a station, equipment (`kind`, a closed list). Its label is unique among the place's live
 * resources, ignoring case; capacity is how many people it takes (1 to 100). An archived one leaves online fitting and
 * keeps its holds (Rules settled: Tables with future reservations). `joins` are others of the same place, at most 10.
 */
export const resources = pgTable(
  'resources',
  {
    workspaceId: workspaceId(),
    id: id(),
    placeId: uuid('place_id').notNull(),
    areaId: uuid('area_id'),
    /** `table`, `room`, `chair`, `bed`, `court`, `station`, `equipment` or `other` (`RESOURCE_KINDS`). */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    minCapacity: smallint('min_capacity').notNull(),
    maxCapacity: smallint('max_capacity').notNull(),
    online: boolean('online').notNull().default(true),
    position: integer('position').notNull(),
    joins: uuid('joins')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    archivedAt: timestamptz('archived_at'),
    /**
     * The code a table's printed QR carries (`/m/<menu key>?t=<code>`, spec 0065 H2): 22 base64url characters from a
     * v4 uuid, 122 random bits, never derived from the label. Regenerated by writing a fresh default.
     */
    tableCode: text('table_code')
      .notNull()
      .default(sql`rtrim(translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '=')`),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'resources_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'resources_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    uniqueIndex('resources_label')
      .on(t.workspaceId, t.placeId, sql`lower(${t.label})`)
      .where(sql`${t.archivedAt} is null`),
    index('resources_order').on(t.workspaceId, t.placeId, t.position),
    uniqueIndex('resources_table_code').on(t.workspaceId, t.tableCode),
    check('resources_table_code_shape', sql`${t.tableCode} ~ '^[A-Za-z0-9_-]{22}$'`),
    index('resources_area').on(t.workspaceId, t.areaId),
    check(
      'resources_kind',
      sql`${t.kind} in ('table', 'room', 'chair', 'bed', 'court', 'station', 'equipment', 'other')`,
    ),
    check('resources_label_length', sql`char_length(${t.label}) between 1 and 12`),
    check(
      'resources_capacity',
      sql`${t.minCapacity} between 1 and 100 and ${t.maxCapacity} between 1 and 100 and ${t.minCapacity} <= ${t.maxCapacity}`,
    ),
    check('resources_joins', sql`cardinality(${t.joins}) <= 10 and not (${t.id} = any(${t.joins}))`),
  ],
);
