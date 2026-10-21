// Queued email (the emails lane): one row per message, written in the
// transaction of the change it tells someone about, so an email exists
// exactly when that change commits. The queue (Graphile Worker) holds only
// the workspace and the row's id; what the email says lives here, behind row
// level security, until it is sent, when the worker blanks it. `key` is the
// email's idempotency key (ids only), unique per workspace, so the same event
// never makes a second email. `email_preferences` holds the topics a member
// turned off (a missing row is on). Both force row level security with the
// standard policy, hand written in the migration.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, id, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, members, workspaces } from './workspaces.ts';

/** Where a queued email is: waiting or trying, sent, skipped (a reason in `error_code`), or failed for good. */
export const emailStatus = pgEnum('email_status', ['queued', 'sent', 'skipped', 'failed']);

const createdBy = actorColumns('created_by');

/** One queued email: its kind, who it goes to, its params until it is sent, and how sending went. */
export const emails = pgTable(
  'emails',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** A queued kind from `@crm/contracts/emails`, checked when it is queued and again when it is drawn. */
    kind: text('kind').notNull(),
    /** The idempotency key: the kind and the ids of what it is about (`form_submission:<id>:<member>`), never a value. */
    key: text('key').notNull(),
    /** A member reader: the address is read from `members` when it is sent, so a removed member gets nothing. */
    toMemberId: uuid('to_member_id'),
    /** Anyone else (a form's visitor): the address, blanked once sent. */
    toAddress: text('to_address'),
    /** Who a reply goes to, when not the sender (a form's owner). */
    replyToMemberId: uuid('reply_to_member_id'),
    /** The kind's params (its schema in `@crm/contracts/emails`), blanked to `{}` once sent. */
    params: jsonb('params').notNull(),
    status: emailStatus('status').notNull().default('queued'),
    /** Tries made, counted by the worker. */
    attempts: smallint('attempts').notNull().default(0),
    /** Why it was skipped or failed: a code, never a message that could quote an address. */
    errorCode: text('error_code'),
    sentAt: timestamptz('sent_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByType: createdBy.type.notNull(),
    createdById: createdBy.id,
    createdByMemberId: createdBy.memberId,
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'emails_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'emails_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'emails_to_member',
      columns: [t.workspaceId, t.toMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'emails_reply_to_member',
      columns: [t.workspaceId, t.replyToMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    ...actorConstraints('emails', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    // A waiting email has exactly one reader; a finished one may have lost its address to the blanking.
    check('emails_reader', sql`${t.status} <> 'queued' or (${t.toMemberId} is null) <> (${t.toAddress} is null)`),
    // Ids and words only: an address (or anything with `@`) can never be part of a key.
    check('emails_key', sql`${t.key} ~ '^[a-z_]+(:[A-Za-z0-9_-]+)+$' and length(${t.key}) <= 300`),
    check('emails_sent', sql`(${t.sentAt} is null) = (${t.status} <> 'sent')`),
    uniqueIndex('emails_key_unique').on(t.workspaceId, t.key),
    // The daily cleanup: finished emails by age.
    index('emails_created').on(t.workspaceId, t.createdAt),
    // The readers' foreign keys, so removing a member never scans.
    index('emails_to_member_idx').on(t.workspaceId, t.toMemberId),
    index('emails_reply_to_member_idx').on(t.workspaceId, t.replyToMemberId),
  ],
);

/** A member's choice for one topic of optional email (`@crm/contracts/emails`' `EMAIL_TOPICS`); no row is on. */
export const emailPreferences = pgTable(
  'email_preferences',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    /** A topic from `EMAIL_TOPICS`, kept in that one list. */
    topic: text('topic').notNull(),
    subscribed: boolean('subscribed').notNull(),
    /** How the choice was last made: from an email's link (no sign in) or in the app. */
    updatedVia: text('updated_via').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'email_preferences_pkey', columns: [t.workspaceId, t.memberId, t.topic] }),
    check('email_preferences_via', sql`${t.updatedVia} in ('email_link', 'app')`),
    foreignKey({
      name: 'email_preferences_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
  ],
);
