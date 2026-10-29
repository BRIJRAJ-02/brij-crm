// Forms (spec 0023, milestone 1): a form, its numbered versions (the draft is
// the one row not yet published; a published version is never changed), the
// submissions visitors send, and the records each submission touched. A
// submission is stored first, in one insert, and a background job turns it
// into records later (`forms.process`), writing as the form's own actor
// (`actor_type` 'form'). The public endpoints find a form by its public key
// through `crm_form_by_key` (migration 0038), the only read that crosses
// workspaces, and only ever answers ids.
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
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, timestamptz, workspaceId } from './common.ts';
import { objects } from './definitions.ts';
import { records } from './records.ts';
import { rotations } from './rotation.ts';
import { actorConstraints, members } from './workspaces.ts';

/** One form. Its documents live in `form_versions`; `draft_version_id` is the one being edited. */
export const forms = pgTable(
  'forms',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints when the member creates the form. */
    id: uuid('id').notNull(),
    /** `built` (questions on our page); `capture` arrives with milestone 3. */
    kind: text('kind').notNull().default('built'),
    /** `draft`, `live`, `paused` or `archived` (spec 0023, state transitions). */
    status: text('status').notNull().default('draft'),
    /** 1 to 200 characters, trimmed by the service. */
    name: text('name').notNull(),
    /**
     * The object each submission adds or updates, as the draft has it (People by default); null keeps the
     * submissions only (the owner's "what if I don't need to map", 21 October 2026). Each published version
     * carries its own target, which is what its submissions are filed with.
     */
    mainObjectId: uuid('main_object_id'),
    /**
     * The form's public address, after `/f/` (`form-a1b2c3`, or one the member
     * chose): unique across every workspace, in every link and embed; internal
     * ids never appear publicly (AC-552). An old one keeps finding the form (`formPublicKeys`, 0120).
     */
    publicKey: text('public_key').notNull(),
    /** Who owns a record the form creates (AC-567); applies at once. Null: nobody. */
    ownerMemberId: uuid('owner_member_id'),
    /**
     * Or the round robin rotation that gives each new lead its owner (spec 0029 milestone 3, AC-755, AC-756; spec
     * 0023 AC-1050); applies at once. At most one of the two is set.
     */
    ownerRotationId: uuid('owner_rotation_id'),
    /** The sites that may post their own form's answers here ("Your own form"), as origins. */
    allowedOrigins: text('allowed_origins')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Refuse posts from those sites unless signed with `signing_secret`. */
    requireSignature: boolean('require_signature').notNull().default(false),
    /** The secret a site's server signs its posts with (HMAC SHA-256 of the body). */
    signingSecret: text('signing_secret').notNull(),
    draftVersionId: uuid('draft_version_id'),
    /** Null until the first publish. */
    liveVersionId: uuid('live_version_id'),
    /** Up by one on every draft save, publish, status change and key rotation: a stale editor's save is refused. */
    revision: integer('revision').notNull().default(1),
    /** The editors' warnings of AC-551 (milestone 2). */
    drift: jsonb('drift'),
    archivedAt: timestamptz('archived_at'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'forms_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'forms_main_object',
      columns: [t.workspaceId, t.mainObjectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    // A key is unique across every workspace: the public lookup finds one form by it.
    uniqueIndex('forms_public_key').on(t.publicKey),
    // The forms list, newest first, archived ones apart.
    index('forms_by_workspace').on(t.workspaceId, t.createdAt.desc(), t.id),
    check('forms_kind', sql`${t.kind} in ('built', 'capture')`),
    check('forms_status', sql`${t.status} in ('draft', 'live', 'paused', 'archived')`),
    check('forms_name', sql`char_length(${t.name}) between 1 and 200`),
    check('forms_public_key_shape', sql`${t.publicKey} ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'`),
    foreignKey({
      name: 'forms_owner',
      columns: [t.workspaceId, t.ownerMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'forms_owner_rotation',
      columns: [t.workspaceId, t.ownerRotationId],
      foreignColumns: [rotations.workspaceId, rotations.id],
    }),
    // The forms a rotation gives owners for: its delete guard ("Used by 1 form") and the foreign key's check.
    index('forms_by_owner_rotation')
      .on(t.workspaceId, t.ownerRotationId)
      .where(sql`${t.ownerRotationId} is not null`),
    check('forms_one_owner', sql`${t.ownerMemberId} is null or ${t.ownerRotationId} is null`),
    check(
      'forms_live_version',
      sql`(${t.status} = 'draft') = (${t.liveVersionId} is null) or ${t.status} = 'archived'`,
    ),
    check('forms_archived', sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`),
    ...actorConstraints('forms', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('forms', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

const publishedBy = actorColumns('published_by');

/**
 * Every address a form holds or held, after `/f/` (late trap #54, 29 Oct 2026): its current one and up to 5 old
 * ones (none kept past 180 days once left), which keep finding the form, so an embed or link already pasted survives a change. Kept only by the trigger
 * crm_form_public_keys_keep (0120) on `forms`; a deleted form takes its rows with it. `form_public_keys_key` keeps
 * an address one form holds or held from every other form, in any workspace; the same form may take it back.
 */
export const formPublicKeys = pgTable(
  'form_public_keys',
  {
    workspaceId: workspaceId(),
    formId: uuid('form_id').notNull(),
    publicKey: text('public_key').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** When the form last took or left this address: the oldest past the cap of 5 old ones goes first. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'form_public_keys_pkey', columns: [t.workspaceId, t.formId, t.publicKey] }),
    foreignKey({
      name: 'form_public_keys_form',
      columns: [t.workspaceId, t.formId],
      foreignColumns: [forms.workspaceId, forms.id],
    }).onDelete('cascade'),
    uniqueIndex('form_public_keys_key').on(t.publicKey),
  ],
);

/**
 * One numbered version of a form's document (`FormDocument` in
 * `@crm/contracts`). The draft is the form's one row with no `published_at`;
 * publishing stamps it and the next edit starts a new draft numbered after it.
 */
export const formVersions = pgTable(
  'form_versions',
  {
    workspaceId: workspaceId(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    formId: uuid('form_id').notNull(),
    /** 1, 2, … in the form; the draft is the highest. */
    number: integer('number').notNull(),
    document: jsonb('document').notNull(),
    publishedAt: timestamptz('published_at'),
    publishedByType: publishedBy.type,
    publishedById: publishedBy.id,
    publishedByMemberId: publishedBy.memberId,
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'form_versions_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'form_versions_form',
      columns: [t.workspaceId, t.formId],
      foreignColumns: [forms.workspaceId, forms.id],
    }).onDelete('cascade'),
    uniqueIndex('form_versions_number').on(t.workspaceId, t.formId, t.number),
    // At most one draft per form.
    uniqueIndex('form_versions_one_draft')
      .on(t.workspaceId, t.formId)
      .where(sql`${t.publishedAt} is null`),
    check('form_versions_number_positive', sql`${t.number} >= 1`),
    check('form_versions_published', sql`(${t.publishedAt} is null) = (${t.publishedByType} is null)`),
    ...actorConstraints('form_versions', 'published_by', t.workspaceId, {
      type: t.publishedByType,
      id: t.publishedById,
      memberId: t.publishedByMemberId,
    }),
    ...actorConstraints('form_versions', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('form_versions', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * One submission, stored as sent before any record is written (AC-554).
 * `state` moves `received → processing → processed`, or to `spam`, `failed`
 * and (milestone 2) `held` and `needs_review`. `idempotency_key` is the
 * browser's per attempt key: a retry of the same attempt is the same row (AC-555).
 */
export const formSubmissions = pgTable(
  'form_submissions',
  {
    workspaceId: workspaceId(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    formId: uuid('form_id').notNull(),
    versionId: uuid('version_id').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    state: text('state').notNull().default('received'),
    /** The validated answers, by question id, as the visitor sent them. */
    answers: jsonb('answers').notNull(),
    /** UTM tags, the page and the referrer, and prefill (milestone 3 fills more). */
    hidden: jsonb('hidden').notNull().default({}),
    /**
     * Where it came from (spec 0023, the embeds): the page, its title, the visit's first landing, the referrer,
     * the UTM tags, the parameters the site passed, the embed's mode and, only where the site allowed it, the
     * first party visitor id. Checked field by field on the way in (`SubmitContext`); null when none came.
     */
    context: jsonb('context'),
    /** The bot checks' verdict, score and signals. */
    spam: jsonb('spam').notNull().default({}),
    /** Set once processing found or made the main record. No foreign key: the purge clears it. */
    mainRecordId: uuid('main_record_id'),
    /** Who was given ownership and why (AC-567). */
    assignment: jsonb('assignment'),
    /** Refused fields and fallbacks (AC-565, AC-571). */
    outcome: jsonb('outcome'),
    /** Why the last processing failed, in plain words (AC-566). */
    failure: text('failure'),
    /** The client address, hashed with a salt: rate limits and abuse review only. */
    ipHash: text('ip_hash'),
    /** SHA-256 of the stored answers in key order: finds the same answers sent again (the spam checker's repeats). */
    answersHash: text('answers_hash'),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'form_submissions_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'form_submissions_form',
      columns: [t.workspaceId, t.formId],
      foreignColumns: [forms.workspaceId, forms.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'form_submissions_version',
      columns: [t.workspaceId, t.versionId],
      foreignColumns: [formVersions.workspaceId, formVersions.id],
    }),
    uniqueIndex('form_submissions_attempt').on(t.workspaceId, t.formId, t.idempotencyKey),
    // A form's submissions, newest first.
    index('form_submissions_by_form').on(t.workspaceId, t.formId, t.receivedAt.desc(), t.id),
    // A form's submissions by id: a sync's snapshot walks them as a keyset (spec 0023, Sync old records).
    index('form_submissions_by_form_id').on(t.workspaceId, t.formId, t.id),
    // The same answers on one form lately (the spam checker's repeats), counted from the index alone.
    index('form_submissions_repeats')
      .on(t.workspaceId, t.formId, t.answersHash, t.receivedAt)
      .where(sql`${t.answersHash} is not null`),
    // The ones still to look at.
    index('form_submissions_open')
      .on(t.workspaceId, t.state)
      .where(sql`${t.state} <> 'processed'`),
    // A record's submissions as their main record: the purge clears it when the record goes for good (spec 0022).
    index('form_submissions_by_main_record')
      .on(t.workspaceId, t.mainRecordId)
      .where(sql`${t.mainRecordId} is not null`),
    check(
      'form_submissions_state',
      sql`${t.state} in ('received', 'processing', 'processed', 'spam', 'held', 'needs_review', 'failed')`,
    ),
    check('form_submissions_processed', sql`(${t.state} = 'processed') = (${t.processedAt} is not null)`),
  ],
);

/** One record a submission touched, with what happened to it and its role (AC-561). */
export const formSubmissionRecords = pgTable(
  'form_submission_records',
  {
    workspaceId: workspaceId(),
    submissionId: uuid('submission_id').notNull(),
    objectId: uuid('object_id').notNull(),
    recordId: uuid('record_id').notNull(),
    action: text('action').notNull(),
    role: text('role').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'form_submission_records_pkey', columns: [t.workspaceId, t.submissionId, t.recordId, t.role] }),
    foreignKey({
      name: 'form_submission_records_submission',
      columns: [t.workspaceId, t.submissionId],
      foreignColumns: [formSubmissions.workspaceId, formSubmissions.id],
    }).onDelete('cascade'),
    // No `on delete` action: the purge deletes these rows first, with the record's other links.
    foreignKey({
      name: 'form_submission_records_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    // A record's timeline and the purge.
    index('form_submission_records_by_record').on(t.workspaceId, t.recordId, t.createdAt.desc()),
    check('form_submission_records_action', sql`${t.action} in ('created', 'updated', 'matched', 'linked')`),
    check('form_submission_records_role', sql`${t.role} in ('main', 'person', 'company', 'deal', 'entry')`),
  ],
);

/**
 * A file a visitor uploaded to a public form (#32): kept in the blob store under `pathname`, bound here to its
 * workspace and form, and to its submission once one takes it (`submission_id`). Unguessable ids, never listed.
 * `submission_id` and `form_id` carry no foreign key on purpose: a deleted submission or form must leave the row
 * behind so the daily cleanup can remove the stored file too (`uploads` phase), which a cascade would hide.
 */
export const formUploads = pgTable(
  'form_uploads',
  {
    workspaceId: workspaceId(),
    id: uuid('id')
      .notNull()
      .default(sql`gen_random_uuid()`),
    formId: uuid('form_id').notNull(),
    /** Where the file lives in the store: `forms/<workspace>/<form>/<id>.<ext>`. */
    pathname: text('pathname').notNull(),
    /** The visitor's file name, made safe (`sanitiseFileName`). */
    name: text('name').notNull(),
    size: integer('size').notNull(),
    contentType: text('content_type').notNull(),
    /** Set once a submission took the file. */
    submissionId: uuid('submission_id'),
    /** The uploader's address, hashed with a salt: abuse review only. */
    ipHash: text('ip_hash'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'form_uploads_pkey', columns: [t.workspaceId, t.id] }),
    // The cleanup's unattached files, oldest first, and a form's recent uploads (the per form cap).
    index('form_uploads_by_form').on(t.workspaceId, t.formId, t.createdAt),
    index('form_uploads_by_submission').on(t.workspaceId, t.submissionId),
    check('form_uploads_size', sql`${t.size} >= 0 and ${t.size} <= 10485760`),
  ],
);
