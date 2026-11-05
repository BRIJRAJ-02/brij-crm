// The visit engine (spec 0066, B0, migration 0176_visits_engine): services and their variants, staff and their shifts
// at each place, and visits (appointments) with their items and holds. A hold is one staff member's or one
// resource's time for one item; two exclusion constraints (hand written in the migration) refuse two live holds of
// one staff member, or of one resource, that overlap. Tenant tables under forced row level security with the plain
// workspace policy; every index leads with workspace_id.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
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
import { places, resources } from './hospitality.ts';
import { members, workspaces } from './workspaces.ts';
import { records } from './records.ts';

/** A `tstzrange`, read and written as Postgres' text form. */
const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

/** A group of services on the menu of services (Hair, Colour, Nails): up to 50 a workspace. */
export const serviceCategories = pgTable(
  'service_categories',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'service_categories_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'service_categories_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    index('service_categories_order').on(t.workspaceId, t.position),
    check('service_categories_name', sql`char_length(${t.name}) between 1 and 60`),
  ],
);

/**
 * A service (AC-6610): what a visit books. `capacity_mode` `party` fits a party to a resource's capacity (a table);
 * `staff_rule` says who can do it (`none` for a table or a court). `hold_by_size` lengthens a party's hold by its size
 * (`[{ size, minutes }]`, the largest size at or under the party's). Archived, never deleted, while visits name it.
 */
export const services = pgTable(
  'services',
  {
    workspaceId: workspaceId(),
    id: id(),
    categoryId: uuid('category_id'),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug').notNull(),
    bufferAfterMin: smallint('buffer_after_min').notNull().default(0),
    online: boolean('online').notNull().default(true),
    capacityMode: text('capacity_mode').notNull().default('one'),
    staffRule: text('staff_rule').notNull().default('all'),
    holdBySize: jsonb('hold_by_size')
      .notNull()
      .default(sql`'[]'::jsonb`),
    intakeFormId: uuid('intake_form_id'),
    sensitive: boolean('sensitive').notNull().default(false),
    cancelNote: text('cancel_note'),
    /** How often a start is offered, the least notice, and how far ahead (minutes, minutes, days). */
    stepMin: smallint('step_min').notNull().default(15),
    noticeMin: integer('notice_min').notNull().default(0),
    windowDays: smallint('window_days').notNull().default(60),
    /** Pacing (checklabs' covers per slot): the most guests whose visits overlap, or none. */
    coversCap: smallint('covers_cap'),
    /** The party sizes taken (online and at the desk; a larger party asks). */
    partyMin: smallint('party_min').notNull().default(1),
    partyMax: smallint('party_max').notNull().default(8),
    /** How long before the start a guest may still change, or cancel, in minutes. */
    changeCutoffMin: integer('change_cutoff_min').notNull().default(120),
    cancelCutoffMin: integer('cancel_cutoff_min').notNull().default(120),
    position: integer('position').notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'services_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'services_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'services_category',
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [serviceCategories.workspaceId, serviceCategories.id],
    }).onDelete('set null'),
    index('services_category').on(t.workspaceId, t.categoryId, t.position),
    uniqueIndex('services_slug')
      .on(t.workspaceId, t.slug)
      .where(sql`${t.archivedAt} is null`),
    check('services_name', sql`char_length(${t.name}) between 1 and 80`),
    check('services_description', sql`char_length(${t.description}) <= 600`),
    check('services_slug_shape', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 80`),
    check('services_buffer_after', sql`${t.bufferAfterMin} between 0 and 120`),
    check('services_capacity_mode', sql`${t.capacityMode} in ('one', 'party')`),
    check('services_staff_rule', sql`${t.staffRule} in ('all', 'chosen', 'none')`),
    check(
      'services_hold_by_size',
      sql`jsonb_typeof(${t.holdBySize}) = 'array' and jsonb_array_length(${t.holdBySize}) <= 8`,
    ),
    check('services_cancel_note', sql`char_length(${t.cancelNote}) <= 200`),
    check(
      'services_booking_rules',
      sql`${t.stepMin} between 5 and 240 and ${t.noticeMin} between 0 and 43200
      and ${t.windowDays} between 1 and 730 and (${t.coversCap} is null or ${t.coversCap} between 1 and 1000)`,
    ),
    check('services_party', sql`${t.partyMin} between 1 and 100 and ${t.partyMax} between ${t.partyMin} and 100`),
    check(
      'services_cutoffs',
      sql`${t.changeCutoffMin} between 0 and 10080 and ${t.cancelCutoffMin} between 0 and 10080`,
    ),
  ],
);

/**
 * A variant of a service (AC-6610; week one needs): its length, price, buffer before and an optional processing
 * window (`processing_after_min` into the variant, `processing_min` long) when the staff member is free while the
 * resource stays held, such as colour developing.
 */
export const serviceVariants = pgTable(
  'service_variants',
  {
    workspaceId: workspaceId(),
    id: id(),
    serviceId: uuid('service_id').notNull(),
    name: text('name').notNull(),
    minutes: smallint('minutes').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
    priceType: text('price_type').notNull().default('fixed'),
    bufferBeforeMin: smallint('buffer_before_min').notNull().default(0),
    processingAfterMin: smallint('processing_after_min'),
    processingMin: smallint('processing_min'),
    position: smallint('position').notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'service_variants_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'service_variants_service',
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }).onDelete('cascade'),
    index('service_variants_order').on(t.workspaceId, t.serviceId, t.position),
    check('service_variants_name', sql`char_length(${t.name}) between 1 and 60`),
    check('service_variants_minutes', sql`${t.minutes} between 5 and 600`),
    check('service_variants_price', sql`${t.priceMinor} >= 0`),
    check('service_variants_price_type', sql`${t.priceType} in ('fixed', 'from', 'free', 'on_request')`),
    check('service_variants_buffer_before', sql`${t.bufferBeforeMin} between 0 and 120`),
    check(
      'service_variants_processing',
      sql`(${t.processingAfterMin} is null) = (${t.processingMin} is null) and (${t.processingMin} is null
        or (${t.processingAfterMin} >= 0 and ${t.processingMin} > 0 and ${t.processingAfterMin} + ${t.processingMin} < ${t.minutes}))`,
    ),
    check('service_variants_position', sql`${t.position} between 0 and 7`),
  ],
);

/**
 * A staff profile (AC-6611). `member_id` links it to a member, who then is that person in both engines: their
 * meetings, calendar busy, time off and blocks block appointments, and their appointment holds block meeting slots.
 */
export const staff = pgTable(
  'staff',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    title: text('title'),
    photoPath: text('photo_path'),
    bio: text('bio'),
    /** One of the nine hues (migration 0181), or null until chosen. */
    color: text('color'),
    memberId: uuid('member_id'),
    position: integer('position').notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'staff_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'staff_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'staff_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    uniqueIndex('staff_member')
      .on(t.workspaceId, t.memberId)
      .where(sql`${t.memberId} is not null`),
    index('staff_order').on(t.workspaceId, t.position),
    check('staff_name', sql`char_length(${t.name}) between 1 and 80`),
    check('staff_title', sql`char_length(${t.title}) <= 60`),
    check('staff_bio', sql`char_length(${t.bio}) <= 600`),
    check('staff_photo_path', sql`char_length(${t.photoPath}) <= 300`),
    check(
      'staff_color',
      sql`${t.color} is null or ${t.color} in ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple')`,
    ),
  ],
);

/** Where a staff member works, and their weekly shifts there (a `PlaceHours` document, AC-6612). */
export const staffPlaces = pgTable(
  'staff_places',
  {
    workspaceId: workspaceId(),
    staffId: uuid('staff_id').notNull(),
    placeId: uuid('place_id').notNull(),
    shifts: jsonb('shifts')
      .notNull()
      .default(sql`'{"weekly":{},"exceptions":[]}'::jsonb`),
    /** Shifts may run outside the place's opening hours (early prep). */
    outsideHours: boolean('outside_hours').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'staff_places_pkey', columns: [t.workspaceId, t.staffId, t.placeId] }),
    foreignKey({
      name: 'staff_places_staff',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'staff_places_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    index('staff_places_place').on(t.workspaceId, t.placeId),
    check(
      'staff_places_shifts',
      sql`jsonb_typeof(${t.shifts}) = 'object' and ${t.shifts} ? 'weekly' and ${t.shifts} ? 'exceptions'`,
    ),
  ],
);

/** An unlinked staff member's time off (a linked one uses their member's own, one source). */
export const staffTimeOff = pgTable(
  'staff_time_off',
  {
    workspaceId: workspaceId(),
    id: id(),
    staffId: uuid('staff_id').notNull(),
    /** One place, or every place they work at when null. */
    placeId: uuid('place_id'),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    reason: text('reason').notNull().default('other'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'staff_time_off_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'staff_time_off_staff',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'staff_time_off_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    index('staff_time_off_by_staff').on(t.workspaceId, t.staffId, t.startsAt),
    index('staff_time_off_place').on(t.workspaceId, t.placeId),
    check(
      'staff_time_off_span',
      sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '367 days'`,
    ),
    check('staff_time_off_reason', sql`${t.reason} in ('holiday', 'sick', 'training', 'other')`),
  ],
);

/** Blocked time of an unlinked staff member at a place (lunch, a meeting): busy for the planner. */
export const staffBlocks = pgTable(
  'staff_blocks',
  {
    workspaceId: workspaceId(),
    id: id(),
    staffId: uuid('staff_id').notNull(),
    placeId: uuid('place_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    reason: text('reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByMemberId: uuid('created_by_member_id'),
  },
  (t) => [
    primaryKey({ name: 'staff_blocks_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'staff_blocks_staff',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'staff_blocks_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    index('staff_blocks_by_staff').on(t.workspaceId, t.staffId, t.startsAt),
    index('staff_blocks_place').on(t.workspaceId, t.placeId),
    check('staff_blocks_span', sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '31 days'`),
    check('staff_blocks_reason', sql`char_length(${t.reason}) <= 60`),
  ],
);

/** The places that offer a service. */
export const servicePlaces = pgTable(
  'service_places',
  {
    workspaceId: workspaceId(),
    serviceId: uuid('service_id').notNull(),
    placeId: uuid('place_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'service_places_pkey', columns: [t.workspaceId, t.serviceId, t.placeId] }),
    foreignKey({
      name: 'service_places_service',
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_places_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    index('service_places_place').on(t.workspaceId, t.placeId),
  ],
);

/** The staff who do a service whose staff rule is `chosen`. */
export const serviceStaff = pgTable(
  'service_staff',
  {
    workspaceId: workspaceId(),
    serviceId: uuid('service_id').notNull(),
    staffId: uuid('staff_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'service_staff_pkey', columns: [t.workspaceId, t.serviceId, t.staffId] }),
    foreignKey({
      name: 'service_staff_service',
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_staff_staff',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }).onDelete('cascade'),
    index('service_staff_staff').on(t.workspaceId, t.staffId),
  ],
);

/** A variant's own length and price for one staff member (senior versus junior, week one needs). */
export const serviceVariantStaff = pgTable(
  'service_variant_staff',
  {
    workspaceId: workspaceId(),
    variantId: uuid('variant_id').notNull(),
    staffId: uuid('staff_id').notNull(),
    minutes: smallint('minutes'),
    priceMinor: bigint('price_minor', { mode: 'number' }),
  },
  (t) => [
    primaryKey({ name: 'service_variant_staff_pkey', columns: [t.workspaceId, t.variantId, t.staffId] }),
    foreignKey({
      name: 'service_variant_staff_variant',
      columns: [t.workspaceId, t.variantId],
      foreignColumns: [serviceVariants.workspaceId, serviceVariants.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_variant_staff_staff',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }).onDelete('cascade'),
    index('service_variant_staff_staff').on(t.workspaceId, t.staffId),
    check(
      'service_variant_staff_values',
      sql`(${t.minutes} is not null or ${t.priceMinor} is not null) and (${t.minutes} is null or ${t.minutes} between 5 and 600)
        and (${t.priceMinor} is null or ${t.priceMinor} >= 0)`,
    ),
  ],
);

/** What a service needs besides staff: `count` resources of a `kind`, or one named resource. */
export const serviceResources = pgTable(
  'service_resources',
  {
    workspaceId: workspaceId(),
    id: id(),
    serviceId: uuid('service_id').notNull(),
    kind: text('kind'),
    count: smallint('count').notNull().default(1),
    resourceId: uuid('resource_id'),
  },
  (t) => [
    primaryKey({ name: 'service_resources_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'service_resources_service',
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_resources_resource',
      columns: [t.workspaceId, t.resourceId],
      foreignColumns: [resources.workspaceId, resources.id],
    }).onDelete('cascade'),
    index('service_resources_service').on(t.workspaceId, t.serviceId),
    index('service_resources_resource').on(t.workspaceId, t.resourceId),
    check(
      'service_resources_need',
      sql`(${t.resourceId} is null) <> (${t.kind} is null) and ${t.count} between 1 and 5
        and (${t.resourceId} is null or ${t.count} = 1)
        and (${t.kind} is null or ${t.kind} in ('table', 'room', 'chair', 'bed', 'court', 'station', 'equipment', 'other'))`,
    ),
  ],
);

/**
 * A visit (AC-6601) at one place: its client, party, status and source, the span of its items, and the keys a guest
 * comes back with (the manage token's hash, and an 8 character lookup code read aloud at the desk). One per attempt:
 * a retry with the same idempotency key answers the first.
 */
export const appointments = pgTable(
  'appointments',
  {
    workspaceId: workspaceId(),
    id: id(),
    placeId: uuid('place_id').notNull(),
    personRecordId: uuid('person_record_id'),
    clientName: text('client_name').notNull(),
    clientEmail: text('client_email'),
    clientPhone: text('client_phone'),
    note: text('note'),
    partySize: smallint('party_size').notNull().default(1),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    status: text('status').notNull().default('booked'),
    approval: text('approval').notNull().default('none'),
    source: text('source').notNull(),
    manageTokenHash: text('manage_token_hash'),
    lookupCode: text('lookup_code').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    createdByMemberId: uuid('created_by_member_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    cancelledAt: timestamptz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    /** Birthday, anniversary, business, date or other: an icon on the Service list. */
    occasion: text('occasion'),
    /** When the guest arrived, was seated (the table's clock) and finished (the table freed). */
    arrivedAt: timestamptz('arrived_at'),
    seatedAt: timestamptz('seated_at'),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [
    primaryKey({ name: 'appointments_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'appointments_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }),
    foreignKey({
      name: 'appointments_person',
      columns: [t.workspaceId, t.personRecordId],
      foreignColumns: [records.workspaceId, records.id],
    }).onDelete('set null'),
    uniqueIndex('appointments_attempt').on(t.workspaceId, t.placeId, t.idempotencyKey),
    uniqueIndex('appointments_manage_token')
      .on(t.workspaceId, t.manageTokenHash)
      .where(sql`${t.manageTokenHash} is not null`),
    uniqueIndex('appointments_lookup_code').on(t.workspaceId, t.lookupCode),
    index('appointments_by_place').on(t.workspaceId, t.placeId, t.startsAt),
    index('appointments_person').on(t.workspaceId, t.personRecordId),
    index('appointments_by_email').on(t.workspaceId, t.placeId, sql`lower(${t.clientEmail})`, t.startsAt),
    check('appointments_client_name', sql`char_length(${t.clientName}) between 1 and 120`),
    check('appointments_client_email', sql`char_length(${t.clientEmail}) <= 254`),
    check('appointments_client_phone', sql`char_length(${t.clientPhone}) <= 40`),
    check('appointments_note', sql`char_length(${t.note}) <= 500`),
    check('appointments_party', sql`${t.partySize} between 1 and 100`),
    check('appointments_span', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'appointments_status',
      sql`${t.status} in ('booked', 'confirmed', 'arrived', 'started', 'completed', 'no_show', 'cancelled')`,
    ),
    check('appointments_approval', sql`${t.approval} in ('none', 'pending', 'approved', 'declined')`),
    check('appointments_source', sql`${t.source} in ('online', 'desk', 'walk_in')`),
    check('appointments_lookup_shape', sql`${t.lookupCode} ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'`),
    check('appointments_total', sql`${t.totalMinor} >= 0`),
    check('appointments_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('appointments_cancel_reason', sql`char_length(${t.cancelReason}) <= 200`),
    check('appointments_occasion', sql`${t.occasion} in ('birthday', 'anniversary', 'business', 'date', 'other')`),
  ],
);

/**
 * One service of a visit, in order (AC-6601), with the names and price copied at booking, so a later rename or
 * price change never rewrites history.
 */
export const appointmentItems = pgTable(
  'appointment_items',
  {
    workspaceId: workspaceId(),
    id: id(),
    appointmentId: uuid('appointment_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    serviceName: text('service_name').notNull(),
    variantName: text('variant_name').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
    priceType: text('price_type').notNull(),
    staffId: uuid('staff_id'),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'appointment_items_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'appointment_items_appointment',
      columns: [t.workspaceId, t.appointmentId],
      foreignColumns: [appointments.workspaceId, appointments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'appointment_items_service',
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }),
    foreignKey({
      name: 'appointment_items_variant',
      columns: [t.workspaceId, t.variantId],
      foreignColumns: [serviceVariants.workspaceId, serviceVariants.id],
    }),
    foreignKey({
      name: 'appointment_items_staff',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }),
    uniqueIndex('appointment_items_order').on(t.workspaceId, t.appointmentId, t.position),
    index('appointment_items_service').on(t.workspaceId, t.serviceId),
    index('appointment_items_variant').on(t.workspaceId, t.variantId),
    index('appointment_items_staff').on(t.workspaceId, t.staffId, t.startsAt),
    check('appointment_items_span', sql`${t.endsAt} > ${t.startsAt}`),
    check('appointment_items_position', sql`${t.position} between 0 and 4`),
    check('appointment_items_price', sql`${t.priceMinor} >= 0`),
    check('appointment_items_price_type', sql`${t.priceType} in ('fixed', 'from', 'free', 'on_request')`),
    check(
      'appointment_items_names',
      sql`char_length(${t.serviceName}) between 1 and 80 and char_length(${t.variantName}) between 1 and 60`,
    ),
  ],
);

/**
 * One staff member's or one resource's time for one item (AC-6601, AC-6602): exactly one of the two, over `during`
 * (the item widened by its buffers; a staff member's split around a processing window). `live` turns false when the
 * visit is cancelled or a no show, freeing the time. The two exclusion constraints (`appointment_holds_staff` and
 * `appointment_holds_resource`, hand written) refuse two live holds of one holder that overlap.
 */
export const appointmentHolds = pgTable(
  'appointment_holds',
  {
    workspaceId: workspaceId(),
    id: id(),
    appointmentId: uuid('appointment_id').notNull(),
    itemId: uuid('item_id').notNull(),
    placeId: uuid('place_id').notNull(),
    staffId: uuid('staff_id'),
    resourceId: uuid('resource_id'),
    during: tstzrange('during').notNull(),
    /** `during`'s ends, kept beside it: plain comparisons reach a btree index under row level security, `&&` doesn't. */
    startsAt: timestamptz('starts_at').generatedAlwaysAs(sql`lower(during)`),
    endsAt: timestamptz('ends_at').generatedAlwaysAs(sql`upper(during)`),
    live: boolean('live').notNull().default(true),
  },
  (t) => [
    primaryKey({ name: 'appointment_holds_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'appointment_holds_item',
      columns: [t.workspaceId, t.itemId],
      foreignColumns: [appointmentItems.workspaceId, appointmentItems.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'appointment_holds_appointment',
      columns: [t.workspaceId, t.appointmentId],
      foreignColumns: [appointments.workspaceId, appointments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'appointment_holds_staff_ref',
      columns: [t.workspaceId, t.staffId],
      foreignColumns: [staff.workspaceId, staff.id],
    }),
    foreignKey({
      name: 'appointment_holds_resource_ref',
      columns: [t.workspaceId, t.resourceId],
      foreignColumns: [resources.workspaceId, resources.id],
    }),
    foreignKey({
      name: 'appointment_holds_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }),
    index('appointment_holds_item').on(t.workspaceId, t.itemId),
    index('appointment_holds_appointment').on(t.workspaceId, t.appointmentId),
    index('appointment_holds_by_staff')
      .on(t.workspaceId, t.staffId, t.startsAt)
      .where(sql`${t.live} and ${t.staffId} is not null`),
    index('appointment_holds_by_resource')
      .on(t.workspaceId, t.resourceId, t.startsAt)
      .where(sql`${t.live} and ${t.resourceId} is not null`),
    index('appointment_holds_by_place')
      .on(t.workspaceId, t.placeId, t.startsAt)
      .where(sql`${t.live}`),
    check('appointment_holds_holder', sql`(${t.staffId} is null) <> (${t.resourceId} is null)`),
    check(
      'appointment_holds_during',
      sql`not isempty(${t.during}) and lower_inc(${t.during}) and not upper_inc(${t.during})
        and upper(${t.during}) - lower(${t.during}) <= interval '1 day'`,
    ),
  ],
);

/**
 * A member's new reservation emails at a place (spec 0066 B7 lite): on or off. No row means the default, on for the
 * workspace's owner and off for everyone else; only a member who can Run service is ever emailed.
 */
export const reservationAlerts = pgTable(
  'reservation_alerts',
  {
    workspaceId: workspaceId(),
    placeId: uuid('place_id').notNull(),
    memberId: uuid('member_id').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'reservation_alerts_pkey', columns: [t.workspaceId, t.placeId, t.memberId] }),
    foreignKey({
      name: 'reservation_alerts_place',
      columns: [t.workspaceId, t.placeId],
      foreignColumns: [places.workspaceId, places.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reservation_alerts_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    index('reservation_alerts_member').on(t.workspaceId, t.memberId),
  ],
);
