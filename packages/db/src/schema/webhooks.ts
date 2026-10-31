// Outgoing webhooks (spec 0064, slice 3): a workspace's endpoints and their deliveries. Both are tenant tables that
// force row level security with the standard policy (hand written in the migration). An endpoint's signing secret is
// sealed with `WEBHOOK_SECRET_KEY` (AES-256-GCM, bound to the workspace and the endpoint) and never stored in the
// clear; after a rotation the old one stays sealed beside it until `previous_secret_until`. A delivery is one event
// for one endpoint, made in the transaction of the write the event describes, unique on (endpoint, event) so an event
// is queued for an endpoint once; its row carries the latest try. The daily cleanup removes rows past 30 days.
import { sql } from 'drizzle-orm';
import {
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
import { members, workspaces } from './workspaces.ts';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** One endpoint: where events go, which ones, its sealed secrets, and whether it is on. */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    workspaceId: workspaceId(),
    id: id(),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    events: text('events').array().notNull(),
    secretSealed: bytea('secret_sealed').notNull(),
    /** The secret's last 4 characters, for the row (AC-6420). */
    secretHint: text('secret_hint').notNull(),
    previousSecretSealed: bytea('previous_secret_sealed'),
    previousSecretUntil: timestamptz('previous_secret_until'),
    status: text('status').notNull().default('active'),
    offReason: text('off_reason'),
    /** When the current run of failed deliveries began; null after a success. */
    failingSince: timestamptz('failing_since'),
    createdByMemberId: uuid('created_by_member_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'webhook_endpoints_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'webhook_endpoints_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'webhook_endpoints_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('webhook_endpoints_status', sql`${t.status} in ('active', 'off')`),
    check(
      'webhook_endpoints_off',
      sql`(${t.status} = 'off') = (${t.offReason} is not null) and ${t.offReason} in ('turned_off', 'failing')`,
    ),
    check('webhook_endpoints_url', sql`${t.url} like 'https://%' and length(${t.url}) <= 2048`),
    check('webhook_endpoints_description', sql`length(${t.description}) <= 120`),
    check('webhook_endpoints_events', sql`cardinality(${t.events}) between 1 and 6`),
    check('webhook_endpoints_previous', sql`(${t.previousSecretSealed} is null) = (${t.previousSecretUntil} is null)`),
    index('webhook_endpoints_created_by_idx').on(t.workspaceId, t.createdByMemberId),
  ],
);

/** One event for one endpoint, and how its latest try went. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    workspaceId: workspaceId(),
    id: id(),
    endpointId: uuid('endpoint_id').notNull(),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    /** The whole body as sent, at most 64 KB. */
    payload: jsonb('payload').notNull(),
    attempt: smallint('attempt').notNull().default(0),
    state: text('state').notNull().default('pending'),
    responseStatus: smallint('response_status'),
    responseMs: integer('response_ms'),
    responseExcerpt: text('response_excerpt'),
    failure: text('failure'),
    nextAttemptAt: timestamptz('next_attempt_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    primaryKey({ name: 'webhook_deliveries_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'webhook_deliveries_endpoint',
      columns: [t.workspaceId, t.endpointId],
      foreignColumns: [webhookEndpoints.workspaceId, webhookEndpoints.id],
    }).onDelete('cascade'),
    check('webhook_deliveries_state', sql`${t.state} in ('pending', 'sent', 'failed', 'gave_up')`),
    check('webhook_deliveries_payload', sql`pg_column_size(${t.payload}) <= 65536`),
    check('webhook_deliveries_excerpt', sql`length(${t.responseExcerpt}) <= 1024`),
    check('webhook_deliveries_sent', sql`(${t.sentAt} is null) = (${t.state} <> 'sent')`),
    uniqueIndex('webhook_deliveries_once').on(t.workspaceId, t.endpointId, t.eventId),
    index('webhook_deliveries_log').on(t.workspaceId, t.endpointId, t.createdAt.desc(), t.id.desc()),
    index('webhook_deliveries_created').on(t.workspaceId, t.createdAt),
  ],
);
