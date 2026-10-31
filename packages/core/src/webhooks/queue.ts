// Queueing a webhook event (spec 0064, AC-6422): called inside the transaction of the write the event describes, so a
// delivery exists exactly when that write commits (a write that rolls back takes its deliveries with it), and the write
// never waits for a receiver. One indexed read finds the workspace's active endpoints subscribed to the types at hand
// (at most 10); with none, that is all it costs, and the data is never read. With some, the data is read once, held to
// its type's strict schema (AC-6426: a payload that doesn't match is never sent, and never fails the write), one event
// id (a UUID v7) is made, and one delivery row per endpoint is stored and queued in one statement. An endpoint already
// failing gets its first try a minute later rather than at once, so a dead receiver isn't tried once per event.
import { WEBHOOK_DATA, type WebhookEventType } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { newId } from '../engine/ids.ts';
import { bookingWebhookData, emailAnswer, formWebhookData, signupHandle, webhookEnvelope } from './payloads.ts';

/** What queueing did: how many deliveries it stored (0 with no subscribed endpoint). */
export interface QueuedWebhook {
  readonly deliveries: number;
}

/** A subscribed endpoint, as the queue reads it. */
interface Subscriber extends Record<string, unknown> {
  readonly id: string;
  readonly workspace_id: string;
  readonly events: readonly string[];
}

/** The workspace's active endpoints that want any of `types`: one read, through row level security. */
async function subscribers(tx: WorkspaceTx, types: readonly WebhookEventType[]): Promise<readonly Subscriber[]> {
  const found = await tx.execute<Subscriber>(sql`
    select id, workspace_id, events from webhook_endpoints
    where status = 'active' and events && ${`{${types.join(',')}}`}::text[]
  `);
  return found.rows;
}

/** Stores and queues one event for the endpoints given that want `type`. */
async function store(
  tx: WorkspaceTx,
  endpoints: readonly Subscriber[],
  type: WebhookEventType,
  data: unknown,
  now: Date,
): Promise<QueuedWebhook> {
  const wanting = endpoints.filter((endpoint) => endpoint.events.includes(type));
  // Row level security gave only this workspace's endpoints, so they all name it.
  const workspaceId = wanting[0]?.workspace_id;
  if (workspaceId === undefined || data === undefined) return { deliveries: 0 };
  if (!WEBHOOK_DATA[type].safeParse(data).success) return { deliveries: 0 };
  const eventId = newId(now.getTime());
  const envelope = webhookEnvelope({ eventId, type, createdAt: now.toISOString(), workspaceId, data });
  if (envelope === undefined) return { deliveries: 0 };
  const queued = await tx.execute<{ queued: boolean }>(sql`
    with made as (
      insert into webhook_deliveries (workspace_id, endpoint_id, event_id, event_type, payload, next_attempt_at)
      select e.workspace_id, e.id, ${eventId}::uuid, ${type}, ${JSON.stringify(envelope)}::jsonb,
        case when e.failing_since is not null then now() + interval '1 minute' end
      from webhook_endpoints e
      where e.id = any (${`{${wanting.map((endpoint) => endpoint.id).join(',')}}`}::uuid[])
      returning id
    )
    select crm_enqueue_webhook_delivery(id) as queued from made
  `);
  if (queued.rows.some((row) => !row.queued)) throw new Error('A webhook delivery could not be queued.');
  return { deliveries: queued.rows.length };
}

/**
 * Stores one delivery of `type` per active endpoint subscribed to it, with the data `read` answers, and queues each.
 * `read` runs only when some endpoint wants the type; undefined (the row isn't there) queues nothing.
 */
export async function queueWebhookEvent(
  tx: WorkspaceTx,
  type: WebhookEventType,
  read: () => Promise<unknown>,
  now: Date = new Date(),
): Promise<QueuedWebhook> {
  const endpoints = await subscribers(tx, [type]);
  if (endpoints.length === 0) return { deliveries: 0 };
  return store(tx, endpoints, type, await read(), now);
}

/** A booking's event: booking.created, rescheduled, cancelled or no_show. */
export function queueBookingWebhook(
  tx: WorkspaceTx,
  type: Extract<WebhookEventType, `booking.${string}`>,
  bookingId: string,
): Promise<QueuedWebhook> {
  return queueWebhookEvent(tx, type, () => bookingWebhookData(tx, bookingId));
}

/** The same event for several bookings (a sync that cancels many): one endpoint read for all of them. */
export async function queueBookingWebhooks(
  tx: WorkspaceTx,
  type: Extract<WebhookEventType, `booking.${string}`>,
  bookingIds: readonly string[],
): Promise<QueuedWebhook> {
  if (bookingIds.length === 0) return { deliveries: 0 };
  const endpoints = await subscribers(tx, [type]);
  if (endpoints.length === 0) return { deliveries: 0 };
  let deliveries = 0;
  for (const bookingId of bookingIds) {
    deliveries += (await store(tx, endpoints, type, await bookingWebhookData(tx, bookingId), new Date())).deliveries;
  }
  return { deliveries };
}

/**
 * A form submission taken as received: `form.submitted`, and `link_page.signup` too when it came from a link page
 * that carries the form (the referrer its visitor's browser sent is that page) and holds an email. One endpoint read
 * and one submission read for both.
 */
export async function queueFormWebhooks(
  tx: WorkspaceTx,
  input: { readonly submissionId: string; readonly formId: string; readonly referrer: string | undefined },
  now: Date = new Date(),
): Promise<QueuedWebhook> {
  const endpoints = await subscribers(tx, ['form.submitted', 'link_page.signup']);
  if (endpoints.length === 0) return { deliveries: 0 };
  const data = await formWebhookData(tx, input.submissionId);
  const submitted = await store(tx, endpoints, 'form.submitted', data, now);
  const wantsSignup = endpoints.some((endpoint) => endpoint.events.includes('link_page.signup'));
  const email = data === undefined ? undefined : emailAnswer(data.answers);
  const handle =
    !wantsSignup || email === undefined
      ? undefined
      : await signupHandle(tx, { formId: input.formId, referrer: input.referrer });
  const signup =
    handle === undefined || email === undefined
      ? { deliveries: 0 }
      : await store(tx, endpoints, 'link_page.signup', { email, handle }, now);
  return { deliveries: submitted.deliveries + signup.deliveries };
}
