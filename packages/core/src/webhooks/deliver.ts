// Delivering a webhook (spec 0064, AC-6421, AC-6423, AC-6425). The api's sender does the network part; this is
// everything around it. `loadWebhookDelivery` (the system, for the worker's `crm_webhook_deliver` task) reads what to
// send: the endpoint's address, the body as stored, and the secrets that sign it (the current one, and the previous
// one while a rotation overlaps). `finishWebhookDelivery` records how the try went and decides what comes next:
// delivered; another try after about 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours (with
// a tenth of jitter either way), queued in the same transaction; or given up after the eighth. A failure starts or
// continues the endpoint's failing spell, a success ends it; a failure 3 days into a spell turns the endpoint off and
// tells each owner and admin by email. Send test event and Resend (`prepareWebhookTest`, `prepareWebhookResend`)
// send at once from the request and record the result the same way, with no retry of their own.
import { WEBHOOK_EXCERPT_MAX, type WebhookDelivery, type WebhookDeliveryType } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { queueWebhookEndpointOff } from '../emails/queue.ts';
import { isUuid, newId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { auditWebhook, deliveryColumns, ENDPOINT_NOT_FOUND, hostOf, toDelivery } from './endpoints.ts';
import { webhookEnvelope } from './payloads.ts';
import { openSecret, type WebhookKey } from './signing.ts';

/** The waits before each retry, in seconds (AC-6423): 7 retries after the first try, 8 tries in all. */
export const WEBHOOK_BACKOFF_SECONDS: readonly number[] = [60, 300, 1_800, 7_200, 21_600, 43_200, 86_400];

/** How long every delivery must have failed before the endpoint turns off (AC-6423). */
export const WEBHOOK_FAILING_DAYS = 3;

/** What one send needs: where, what, signed with which secrets, and the headers' event id, type and try. */
export interface WebhookSend {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly url: string;
  /** The body exactly as stored, so a retry sends the same bytes. */
  readonly body: string;
  /** The current secret first, then the previous one while it still signs. */
  readonly secrets: readonly string[];
  readonly eventId: string;
  readonly eventType: WebhookDeliveryType;
  /** This try's number, from 1. */
  readonly attempt: number;
}

/** Why nothing came back from a receiver, beside its status. */
export type WebhookFailure = NonNullable<WebhookDelivery['failure']>;

/** How one send went. A 2xx inside the time limit is `ok`; anything else is a failure. */
export interface WebhookSendResult {
  readonly ok: boolean;
  readonly status?: number | undefined;
  readonly ms: number;
  /** At most the first 1 KB of the answer, as text. */
  readonly excerpt?: string | undefined;
  readonly failure?: WebhookFailure | undefined;
}

/** The wait before retry `n` (1 for the first retry), with a tenth of jitter either way; undefined past the last. */
export function retryDelaySeconds(retry: number, random: () => number = Math.random): number | undefined {
  const base = WEBHOOK_BACKOFF_SECONDS[retry - 1];
  if (base === undefined) return undefined;
  return Math.round(base * (0.9 + random() * 0.2));
}

interface PlanRow extends Record<string, unknown> {
  readonly id: string;
  readonly endpoint_id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly payload: unknown;
  readonly attempt: number;
  readonly state: string;
  readonly url: string;
  readonly status: string;
  readonly secret_sealed: Uint8Array;
  readonly previous_secret_sealed: Uint8Array | null;
  readonly previous_live: boolean;
}

/** The send of one stored delivery, its next try counted, its secrets opened. */
async function planOf(tx: WorkspaceTx, key: WebhookKey, workspaceId: string, deliveryId: string) {
  const found = await tx.execute<PlanRow>(sql`
    select d.id, d.endpoint_id, d.event_id, d.event_type, d.payload, d.attempt, d.state,
      e.url, e.status, e.secret_sealed, e.previous_secret_sealed,
      coalesce(e.previous_secret_until > now(), false) as previous_live
    from webhook_deliveries d
    join webhook_endpoints e on e.workspace_id = d.workspace_id and e.id = d.endpoint_id
    where d.id = ${deliveryId}::uuid
    for update of d
  `);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const binding = { workspaceId, endpointId: row.endpoint_id };
  const secrets = [
    openSecret(key, row.secret_sealed, binding),
    ...(row.previous_live && row.previous_secret_sealed !== null
      ? [openSecret(key, row.previous_secret_sealed, binding)]
      : []),
  ];
  const send: WebhookSend = {
    deliveryId: row.id,
    endpointId: row.endpoint_id,
    url: row.url,
    body: JSON.stringify(row.payload),
    secrets,
    eventId: row.event_id,
    eventType: row.event_type as WebhookDeliveryType,
    attempt: row.attempt + 1,
  };
  return { row, send };
}

/** What the task does with a queued delivery: send it, or nothing (gone, done, or its endpoint is off). */
export type WebhookLoad =
  | { readonly kind: 'send'; readonly send: WebhookSend }
  | { readonly kind: 'skip'; readonly reason: 'gone' | 'done' | 'off' };

/** The system's read of one queued delivery (the worker's task). An endpoint turned off gives its waiting ones up. */
export async function loadWebhookDelivery(
  scope: EngineScope,
  key: WebhookKey,
  input: { readonly deliveryId: string },
): Promise<WebhookLoad> {
  checkScope(scope);
  if (scope.access.principal.kind !== 'system') throw new Error('Only the system sends queued webhooks.');
  if (!isUuid(input.deliveryId)) return { kind: 'skip', reason: 'gone' };
  return inWorkspace(scope, async (tx) => {
    const plan = await planOf(tx, key, scope.workspaceId, input.deliveryId);
    if (plan === undefined) return { kind: 'skip', reason: 'gone' };
    if (plan.row.state !== 'pending' && plan.row.state !== 'failed') return { kind: 'skip', reason: 'done' };
    if (plan.row.status !== 'active') {
      await tx.execute(
        sql`update webhook_deliveries set state = 'gave_up', next_attempt_at = null where id = ${input.deliveryId}::uuid`,
      );
      return { kind: 'skip', reason: 'off' };
    }
    return { kind: 'send', send: plan.send };
  });
}

/** What finishing a try did, for the log. */
export interface WebhookFinished {
  readonly delivery: WebhookDelivery;
  /** When the next try is due, when one is. */
  readonly nextAttemptAt?: string | undefined;
  /** The endpoint turned off with this try (AC-6423). */
  readonly endpointOff: boolean;
}

/** A receiver's answer cut to the log's 1 KB, by characters. */
const excerptOf = (text: string | undefined): string | null =>
  text === undefined || text === '' ? null : text.slice(0, WEBHOOK_EXCERPT_MAX);

/**
 * Records one try (`retry`: whether a failure queues the next, which only a queued delivery does) and keeps the
 * endpoint's failing spell. Pings never count towards turning an endpoint off.
 */
async function recordTry(
  tx: WorkspaceTx,
  scope: EngineScope,
  send: WebhookSend,
  result: WebhookSendResult,
  options: { readonly retry: boolean; readonly random?: () => number },
): Promise<WebhookFinished> {
  const delay = result.ok || !options.retry ? undefined : retryDelaySeconds(send.attempt, options.random);
  const state = result.ok ? 'sent' : !options.retry ? 'failed' : delay === undefined ? 'gave_up' : 'failed';
  const updated = await tx.execute<Parameters<typeof toDelivery>[0]>(sql`
    update webhook_deliveries set attempt = ${send.attempt}, state = ${state},
      response_status = ${result.status ?? null}, response_ms = ${Math.max(0, Math.round(result.ms))},
      response_excerpt = ${excerptOf(result.excerpt)}, failure = ${result.ok ? null : (result.failure ?? 'status')},
      next_attempt_at = ${
        delay !== undefined
          ? sql`now() + make_interval(secs => ${delay})`
          : !options.retry && !result.ok
            ? sql`next_attempt_at`
            : null
      },
      sent_at = ${result.ok ? sql`now()` : null}
    where id = ${send.deliveryId}::uuid
    returning ${deliveryColumns}
  `);
  const row = updated.rows[0];
  if (row === undefined) throw new Error('The webhook delivery was not recorded.');
  if (delay !== undefined) {
    const queued = await tx.execute<{ queued: boolean }>(
      sql`select crm_enqueue_webhook_delivery(${send.deliveryId}::uuid) as queued`,
    );
    if (queued.rows[0]?.queued !== true) throw new Error('The next webhook try could not be queued.');
  }
  let endpointOff = false;
  if (send.eventType !== 'ping') {
    if (result.ok) {
      await tx.execute(
        sql`update webhook_endpoints set failing_since = null where id = ${send.endpointId}::uuid and failing_since is not null`,
      );
    } else {
      // Only a failure that starts a spell or ends one 3 days in writes the row; one in between changes nothing.
      const spell = await tx.execute<{ off: boolean; spell_ms: string; slug: string; url: string }>(sql`
        update webhook_endpoints e set failing_since = coalesce(e.failing_since, now()),
          status = case when e.failing_since <= now() - make_interval(days => ${WEBHOOK_FAILING_DAYS}) then 'off'
            else e.status end,
          off_reason = case when e.failing_since <= now() - make_interval(days => ${WEBHOOK_FAILING_DAYS})
            then 'failing' else e.off_reason end,
          updated_at = case when e.failing_since <= now() - make_interval(days => ${WEBHOOK_FAILING_DAYS})
            then now() else e.updated_at end
        from workspaces w
        where e.id = ${send.endpointId}::uuid and e.status = 'active' and w.id = e.workspace_id
          and (e.failing_since is null or e.failing_since <= now() - make_interval(days => ${WEBHOOK_FAILING_DAYS}))
        returning e.status = 'off' as off, floor(extract(epoch from e.failing_since) * 1000)::bigint::text as spell_ms,
          w.slug, e.url
      `);
      const turned = spell.rows[0];
      if (turned?.off === true) {
        endpointOff = true;
        await auditWebhook(tx, scope, 'webhook.turned_off', turned.url);
        await tellAdmins(tx, {
          endpointId: send.endpointId,
          spellMillis: turned.spell_ms,
          slug: turned.slug,
          url: turned.url,
        });
      }
    }
  }
  const delivery = toDelivery(row);
  return { delivery, nextAttemptAt: delivery.nextAttemptAt, endpointOff };
}

/** The endpoint as an email may name it: its host only, since Zapier, Make and n8n keep their token in the path. */
const endpointLine = (url: string): string => hostOf(url).slice(0, 200) || 'Your webhook endpoint';

/** Emails each active owner and admin that an endpoint turned off (AC-6423). */
async function tellAdmins(
  tx: WorkspaceTx,
  input: { readonly endpointId: string; readonly spellMillis: string; readonly slug: string; readonly url: string },
): Promise<void> {
  const admins = await tx.execute<{ id: string }>(
    sql`select id from members where status = 'active' and role in ('owner', 'admin') order by id`,
  );
  for (const admin of admins.rows) {
    await queueWebhookEndpointOff(tx, {
      endpointId: input.endpointId,
      spellMillis: input.spellMillis,
      memberId: admin.id,
      params: {
        endpoint: endpointLine(input.url),
        settingsPath: `/w/${encodeURIComponent(input.slug)}/settings/webhooks`,
      },
    });
  }
}

/** Records how a queued delivery's try went (the worker's task): sent, the next try queued, or given up. */
export async function finishWebhookDelivery(
  scope: EngineScope,
  send: WebhookSend,
  result: WebhookSendResult,
  random?: () => number,
): Promise<WebhookFinished> {
  checkScope(scope);
  if (scope.access.principal.kind !== 'system') throw new Error('Only the system records queued webhooks.');
  return inWorkspace(scope, (tx) =>
    recordTry(tx, scope, send, result, { retry: true, ...(random === undefined ? {} : { random }) }),
  );
}

/**
 * Send test event (AC-6425): a `ping` delivery made now for the endpoint, under its own event id, to send at once
 * from the request. Its result is recorded by `recordWebhookSend`; a failed ping is never tried again.
 */
export async function prepareWebhookTest(
  scope: EngineScope,
  key: WebhookKey,
  input: { readonly endpointId: string },
  now: Date = new Date(),
): Promise<WebhookSend> {
  requirePermission(scope, 'webhooks.manage');
  if (!isUuid(input.endpointId)) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const eventId = newId(now.getTime());
    const envelope = webhookEnvelope({
      eventId,
      type: 'ping',
      createdAt: now.toISOString(),
      workspaceId: scope.workspaceId,
      data: { message: 'A test event from Timefix.' },
    });
    const made = await tx.execute<{ id: string }>(sql`
      insert into webhook_deliveries (workspace_id, endpoint_id, event_id, event_type, payload)
      select workspace_id, id, ${eventId}::uuid, 'ping', ${JSON.stringify(envelope)}::jsonb
      from webhook_endpoints where id = ${input.endpointId}::uuid
      returning id
    `);
    const id = made.rows[0]?.id;
    if (id === undefined) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
    const plan = await planOf(tx, key, scope.workspaceId, id);
    if (plan === undefined) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
    return plan.send;
  });
}

/** What a delivery that isn't this workspace's answers. */
export const DELIVERY_NOT_FOUND = 'That delivery doesn’t exist any more.';

/**
 * Resend (AC-6425): the same delivery again, now, with the same event id and body, as its next try. Works on a
 * delivered or given up one too; a waiting retry stays queued and, if this one lands, finds it delivered.
 */
export async function prepareWebhookResend(
  scope: EngineScope,
  key: WebhookKey,
  input: { readonly deliveryId: string },
): Promise<WebhookSend> {
  requirePermission(scope, 'webhooks.manage');
  if (!isUuid(input.deliveryId)) throw refuse('NOT_FOUND', DELIVERY_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const plan = await planOf(tx, key, scope.workspaceId, input.deliveryId);
    if (plan === undefined) throw refuse('NOT_FOUND', DELIVERY_NOT_FOUND);
    return plan.send;
  });
}

/**
 * Records a send made from the request (a test or a resend), with no retry: a failure stays `failed` with no next
 * try of its own. A resend that fails while a queued try still waits keeps that try and its time.
 */
export async function recordWebhookSend(
  scope: EngineScope,
  send: WebhookSend,
  result: WebhookSendResult,
): Promise<WebhookDelivery> {
  requirePermission(scope, 'webhooks.manage');
  return inWorkspace(scope, async (tx) => (await recordTry(tx, scope, send, result, { retry: false })).delivery);
}
