// The Menu app (spec 0065, H1, migration 0175_hospitality_menu): menus and the places they show at, sections one
// level deep, items placed in sections (an item is one thing however many sections hold it), sizes, option groups
// shared between items, photos, the published snapshot per place and the draft's state. Tenant tables under forced
// row level security with the plain workspace policy; every index leads with workspace_id.
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
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamptz, workspaceId } from './common.ts';
import { places } from './hospitality.ts';
import { workspaces } from './workspaces.ts';

/** A menu (AC-6520): Dinner, Drinks, Brunch. Up to 30 a workspace. */
export const menus = pgTable(
  'menus',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    note: text('note'),
    /** `{ weekly }` per day windows, checked by `MenuServing` in contracts; null serves whenever the place shows it. */
    serving: jsonb('serving'),
    /** The tax inside the prices and the service added, in basis points (1250 is 12.5%), ported from checklabs. */
    taxRate: integer('tax_rate').notNull().default(0),
    serviceRate: integer('service_rate').notNull().default(0),
    position: smallint('position').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'menus_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'menus_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    index('menus_order').on(t.workspaceId, t.position),
    check('menus_name', sql`char_length(${t.name}) between 1 and 60`),
    check('menus_note', sql`char_length(${t.note}) <= 300`),
    check('menus_serving', sql`${t.serving} is null or jsonb_typeof(${t.serving}) = 'object'`),
    check('menus_tax_rate', sql`${t.taxRate} between 0 and 10000`),
    check('menus_service_rate', sql`${t.serviceRate} between 0 and 10000`),
  ],
);

/** Which places a menu shows at. */
export const menuPlaces = pgTable(
  'menu_places',
  {
    workspaceId: workspaceId(),
    menuId: uuid('menu_id').notNull(),
    placeId: uuid('place_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'menu_places_pkey', columns: [t.workspaceId, t.menuId, t.placeId] }),
    foreignKey({
      name: 'menu_places_menu',
      columns: [t.workspaceId, t.menuId],
      foreignColumns: [menus.workspaceId, menus.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'menu_places_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    index('menu_places_place').on(t.workspaceId, t.placeId),
  ],
);

/** A section (AC-6521): top level, or one level under a top level one. Up to 100 a menu. */
export const menuSections = pgTable(
  'menu_sections',
  {
    workspaceId: workspaceId(),
    id: id(),
    menuId: uuid('menu_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    layout: text('layout').notNull().default('list'),
    serving: jsonb('serving'),
    position: smallint('position').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'menu_sections_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'menu_sections_menu',
      columns: [t.workspaceId, t.menuId],
      foreignColumns: [menus.workspaceId, menus.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'menu_sections_parent',
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('cascade'),
    index('menu_sections_order').on(t.workspaceId, t.menuId, t.position),
    index('menu_sections_parent').on(t.workspaceId, t.parentId),
    check('menu_sections_name', sql`char_length(${t.name}) between 1 and 60`),
    check('menu_sections_description', sql`char_length(${t.description}) <= 140`),
    check('menu_sections_layout', sql`${t.layout} in ('list', 'grid')`),
    check('menu_sections_serving', sql`${t.serving} is null or jsonb_typeof(${t.serving}) = 'object'`),
    check('menu_sections_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

/** A menu photo (AC-6527): kept at two widths in the private store, versioned by its bytes. Up to 1,000. */
export const menuPhotos = pgTable(
  'menu_photos',
  {
    workspaceId: workspaceId(),
    id: id(),
    largePath: text('large_path').notNull(),
    smallPath: text('small_path').notNull(),
    type: text('type').notNull(),
    version: text('version').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'menu_photos_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'menu_photos_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    check('menu_photos_type', sql`${t.type} in ('image/webp', 'image/jpeg', 'image/png')`),
    check('menu_photos_version', sql`${t.version} ~ '^[0-9a-f]{12}$'`),
    check('menu_photos_paths', sql`char_length(${t.largePath}) <= 300 and char_length(${t.smallPath}) <= 300`),
  ],
);

/** An item (AC-6522): one thing, placed in any number of sections. Up to 2,000 a workspace. */
export const menuItems = pgTable(
  'menu_items',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    /** Minor units of the workspace currency; null with sizes, or with a price note ("Market price"). */
    priceMinor: integer('price_minor'),
    priceNote: text('price_note'),
    photoId: uuid('photo_id'),
    diet: text('diet')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `[{ code, level }]` from the EU 14 list, checked by `ItemAllergen` in contracts. */
    allergens: jsonb('allergens')
      .notNull()
      .default(sql`'[]'::jsonb`),
    kcal: integer('kcal'),
    featured: boolean('featured').notNull().default(false),
    /** Live, never drafted (AC-6526): the guest page reads it over the snapshot. */
    soldOut: boolean('sold_out').notNull().default(false),
    soldOutAt: timestamptz('sold_out_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'menu_items_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'menu_items_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'menu_items_photo',
      columns: [t.workspaceId, t.photoId],
      foreignColumns: [menuPhotos.workspaceId, menuPhotos.id],
    }).onDelete('set null'),
    index('menu_items_sold_out')
      .on(t.workspaceId)
      .where(sql`${t.soldOut}`),
    index('menu_items_photo').on(t.workspaceId, t.photoId),
    check('menu_items_name', sql`char_length(${t.name}) between 1 and 80`),
    check('menu_items_description', sql`char_length(${t.description}) <= 400`),
    check('menu_items_price', sql`${t.priceMinor} between 0 and 99999999`),
    check('menu_items_price_note', sql`char_length(${t.priceNote}) <= 24`),
    check(
      'menu_items_diet',
      sql`cardinality(${t.diet}) <= 9 and ${t.diet} <@ array['vegan','vegetarian','gluten_free','dairy_free','contains_nuts','halal','spicy_1','spicy_2','spicy_3']::text[]`,
    ),
    check(
      'menu_items_allergens',
      sql`jsonb_typeof(${t.allergens}) = 'array' and jsonb_array_length(${t.allergens}) <= 14`,
    ),
    check('menu_items_kcal', sql`${t.kcal} between 0 and 10000`),
  ],
);

/** An item's place in a section (AC-6524), in order. */
export const menuPlacements = pgTable(
  'menu_placements',
  {
    workspaceId: workspaceId(),
    sectionId: uuid('section_id').notNull(),
    itemId: uuid('item_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'menu_placements_pkey', columns: [t.workspaceId, t.sectionId, t.itemId] }),
    foreignKey({
      name: 'menu_placements_section',
      columns: [t.workspaceId, t.sectionId],
      foreignColumns: [menuSections.workspaceId, menuSections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'menu_placements_item',
      columns: [t.workspaceId, t.itemId],
      foreignColumns: [menuItems.workspaceId, menuItems.id],
    }).onDelete('cascade'),
    index('menu_placements_item').on(t.workspaceId, t.itemId),
  ],
);

/** One size of an item (AC-6523): Glass 175ml, Bottle. Up to 8. */
export const menuItemSizes = pgTable(
  'menu_item_sizes',
  {
    workspaceId: workspaceId(),
    id: id(),
    itemId: uuid('item_id').notNull(),
    name: text('name').notNull(),
    priceMinor: integer('price_minor').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'menu_item_sizes_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'menu_item_sizes_item',
      columns: [t.workspaceId, t.itemId],
      foreignColumns: [menuItems.workspaceId, menuItems.id],
    }).onDelete('cascade'),
    index('menu_item_sizes_item').on(t.workspaceId, t.itemId, t.position),
    check('menu_item_sizes_name', sql`char_length(${t.name}) between 1 and 40`),
    check('menu_item_sizes_price', sql`${t.priceMinor} between 0 and 99999999`),
  ],
);

/** An option group (AC-6523), shared between items: Milk, Sides. Up to 200. */
export const menuOptionGroups = pgTable(
  'menu_option_groups',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    rule: text('rule').notNull(),
    /** The fewest a guest must pick; 1 or more makes the group required. */
    min: smallint('min').notNull().default(0),
    max: smallint('max'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'menu_option_groups_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'menu_option_groups_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    check('menu_option_groups_name', sql`char_length(${t.name}) between 1 and 40`),
    check('menu_option_groups_min', sql`${t.min} between 0 and 20`),
    check(
      'menu_option_groups_rule',
      sql`(${t.rule} in ('one', 'any') and ${t.max} is null) or (${t.rule} = 'up_to' and ${t.max} between 1 and 20)`,
    ),
  ],
);

/** One option of a group: a name and a price difference. Up to 20 a group. */
export const menuOptions = pgTable(
  'menu_options',
  {
    workspaceId: workspaceId(),
    id: id(),
    groupId: uuid('group_id').notNull(),
    name: text('name').notNull(),
    priceDeltaMinor: integer('price_delta_minor').notNull().default(0),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'menu_options_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'menu_options_group',
      columns: [t.workspaceId, t.groupId],
      foreignColumns: [menuOptionGroups.workspaceId, menuOptionGroups.id],
    }).onDelete('cascade'),
    index('menu_options_group').on(t.workspaceId, t.groupId, t.position),
    check('menu_options_name', sql`char_length(${t.name}) between 1 and 40`),
    check('menu_options_price', sql`${t.priceDeltaMinor} between -99999999 and 99999999`),
  ],
);

/** Which option groups an item offers, in order. Up to 6 an item. */
export const menuItemOptionGroups = pgTable(
  'menu_item_option_groups',
  {
    workspaceId: workspaceId(),
    itemId: uuid('item_id').notNull(),
    groupId: uuid('group_id').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'menu_item_option_groups_pkey', columns: [t.workspaceId, t.itemId, t.groupId] }),
    foreignKey({
      name: 'menu_item_option_groups_item',
      columns: [t.workspaceId, t.itemId],
      foreignColumns: [menuItems.workspaceId, menuItems.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'menu_item_option_groups_group',
      columns: [t.workspaceId, t.groupId],
      foreignColumns: [menuOptionGroups.workspaceId, menuOptionGroups.id],
    }).onDelete('cascade'),
    index('menu_item_option_groups_group').on(t.workspaceId, t.groupId),
  ],
);

/**
 * One published snapshot of a place's menus (AC-6525): what guests see, never the draft. The latest version is the
 * live one; the last ten are kept.
 */
export const menuVersions = pgTable(
  'menu_versions',
  {
    workspaceId: workspaceId(),
    placeId: uuid('place_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    publishedByMemberId: uuid('published_by_member_id'),
    publishedAt: timestamptz('published_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'menu_versions_pkey', columns: [t.workspaceId, t.placeId, t.version] }),
    foreignKey({
      name: 'menu_versions_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    check('menu_versions_version', sql`${t.version} >= 1`),
    check(
      'menu_versions_snapshot',
      sql`jsonb_typeof(${t.snapshot}) = 'object' and octet_length(${t.snapshot}::text) <= 4000000`,
    ),
  ],
);

/**
 * The draft's state, one row a workspace (AC-6525): how many changes wait for Publish, when it last published, and
 * the rows as published (`published`), which Discard puts back, and whether guests see it (`hidden`).
 */
export const menuDrafts = pgTable(
  'menu_drafts',
  {
    workspaceId: workspaceId(),
    changes: integer('changes').notNull().default(0),
    published: jsonb('published'),
    publishedAt: timestamptz('published_at'),
    publishedByMemberId: uuid('published_by_member_id'),
    /** Live or Hidden (spec 0065, H1): hidden, every guest menu answers "not available right now" until shown again. */
    hidden: boolean('hidden').notNull().default(false),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'menu_drafts_pkey', columns: [t.workspaceId] }),
    foreignKey({ name: 'menu_drafts_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    check('menu_drafts_changes', sql`${t.changes} >= 0`),
    check(
      'menu_drafts_published',
      sql`${t.published} is null or (jsonb_typeof(${t.published}) = 'object' and octet_length(${t.published}::text) <= 8000000)`,
    ),
  ],
);
