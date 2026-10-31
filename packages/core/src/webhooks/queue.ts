// Queueing a webhook event (spec 0064, AC-6422): called inside the transaction of the write the event describes, so a
// delivery exists exactly when that write commits, and the write never waits for a receiver. One indexed read finds
// the workspace's active endpoints subscribed to the type (at most 10); with none, that is all it costs, and the data
// is never read. With some, the data is read once, one event id (a UUID v7) is made, and one delivery row per
// endpoint is stored and put on the queue in one statement, keyed (endpoint, event) so it is queued once however
// often a retried write calls this.
import type { WebhookEventType } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { newId } from '../engine/ids.ts';
import { bookingWebhookData, emailAnswer, formWebhookData, signupHandle, webhookEnvelope } from './payloads.ts';

/** What queueing did: how many deliveries it stored (0 with no subscribed endpoint). */
export interface QueuedWebhook {
  readonly deliveries: number;
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
  const endpoints = await tx.execute<{ id: string; workspace_id: string }>(sql`
    select id, workspace_id from webhook_endpoints where status = 'active' and ${type} = any (events)
  `);
  if (endpoints.rows.length === 0) return { deliveries: 0 };
  const data = await read();
  if (data === undefined) return { deliveries: 0 };
  const eventId = newId(now.getTime());
  // Row level security gave only this workspace's endpoints, so they all name it.
  const workspaceId = endpoints.rows[0]?.workspace_id;
  if (workspaceId === undefined) return { deliveries: 0 };
  const envelope = webhookEnvelope({ eventId, type, createdAt: now.toISOString(), workspaceId, data });
  if (envelope === undefined) return { deliveries: 0 };
  const queued = await tx.execute<{ queued: boolean }>(sql`
    with made as (
      insert into webhook_deliveries (workspace_id, endpoint_id, event_id, event_type, payload)
      select ${workspaceId}::uuid, e.id::uuid, ${eventId}::uuid, ${type}, ${JSON.stringify(envelope)}::jsonb
      from jsonb_array_elements_text(${JSON.stringify(endpoints.rows.map((row) => row.id))}::jsonb) as e(id)
      on conflict (workspace_id, endpoint_id, event_id) do nothing
      returning id
    )
    select crm_enqueue_webhook_delivery(id) as queued from made
  `);
  if (queued.rows.some((row) => !row.queued)) throw new Error('A webhook delivery could not be queued.');
  return { deliveries: queued.rows.length };
}

/** A booking's event: booking.created, rescheduled, cancelled or no_show. */
export function queueBookingWebhook(
  tx: WorkspaceTx,
  type: Extract<WebhookEventType, `booking.${string}`>,
  bookingId: string,
): Promise<QueuedWebhook> {
  return queueWebhookEvent(tx, type, () => bookingWebhookData(tx, bookingId));
}

/**
 * A form submission taken as received: `form.submitted`, and `link_page.signup` too when it came from a link page
 * that carries the form (its referrer is that page) and holds an email.
 */
export async function queueFormWebhooks(
  tx: WorkspaceTx,
  input: { readonly submissionId: string; readonly formId: string; readonly referrer: string | undefined },
): Promise<QueuedWebhook> {
  const submitted = await queueWebhookEvent(tx, 'form.submitted', () => formWebhookData(tx, input.submissionId));
  const signup = await queueWebhookEvent(tx, 'link_page.signup', async () => {
    const handle = await signupHandle(tx, { formId: input.formId, referrer: input.referrer });
    if (handle === undefined) return undefined;
    const data = await formWebhookData(tx, input.submissionId);
    const email = data === undefined ? undefined : emailAnswer(data.answers);
    return email === undefined ? undefined : { email, handle };
  });
  return { deliveries: submitted.deliveries + signup.deliveries };
}
