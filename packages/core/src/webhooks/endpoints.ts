// Settings › Webhooks (spec 0064, AC-6419, AC-6420, AC-6425): a workspace's endpoints and their delivery log, every
// service behind `webhooks.manage` (owners and admins), checked before anything is read. The secret is made here,
// sealed with the key the api passes in, answered whole only by create and rotate, and shown afterwards as its last 4
// characters. An address is checked twice before it is stored: its shape here (`webhookUrlProblem`), its resolved
// addresses by the api's `checkHost` (which needs the network), and again before every send.
import {
  WEBHOOK_DELIVERIES_PAGE,
  WEBHOOK_ENDPOINTS_MAX,
  WEBHOOK_ROTATION_OVERLAP_HOURS,
  type WebhookDelivery,
  type WebhookDeliveryPage,
  type WebhookEndpoint,
  type WebhookEventType,
  type WebhookList,
  type WebhookWithSecret,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql, type SQL } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { writeAudit } from '../members/audit.ts';
import { isUuid } from '../engine/ids.ts';
import { inputInvalid, refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { WEBHOOK_URL_MESSAGES, webhookUrlProblem, type WebhookUrlProblem } from './addresses.ts';
import { newWebhookSecret, sealSecret, secretHint, type WebhookKey } from './signing.ts';

/** What the endpoint services need: the sealing key, and the resolved address check (the network's half). */
export interface WebhookDeps {
  readonly key: WebhookKey;
  /** Resolves the address's host and answers `address` when any answer is refused or none came back. */
  readonly checkHost: (url: URL) => Promise<WebhookUrlProblem | undefined>;
}

/** What an endpoint that isn't this workspace's, or is gone, answers. */
export const ENDPOINT_NOT_FOUND = 'That webhook endpoint doesn’t exist.';

/** What an eleventh endpoint answers (AC-6419). */
export const ENDPOINT_LIMIT_MESSAGE = `A workspace can have at most ${String(WEBHOOK_ENDPOINTS_MAX)} webhook endpoints.`;

/** A timestamp as the contract carries it: UTC, to the millisecond. */
export const iso = (column: SQL): SQL => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

interface EndpointRow extends Record<string, unknown> {
  readonly id: string;
  readonly url: string;
  readonly description: string;
  readonly events: readonly string[];
  readonly status: string;
  readonly off_reason: string | null;
  readonly secret_hint: string;
  readonly previous_until: string | null;
  readonly created_at: string;
  readonly last_state: string | null;
  readonly last_status: number | null;
  readonly last_at: string | null;
}

/** The endpoint read: each with its newest delivery through the log's index. */
const endpointSelect = (where: SQL): SQL => sql`
  select e.id, e.url, e.description, e.events, e.status, e.off_reason, e.secret_hint,
    case when e.previous_secret_until > now() then ${iso(sql`e.previous_secret_until`)} end as previous_until,
    ${iso(sql`e.created_at`)} as created_at,
    d.state as last_state, d.response_status as last_status, ${iso(sql`d.created_at`)} as last_at
  from webhook_endpoints e
  left join lateral (
    select state, response_status, created_at from webhook_deliveries
    where workspace_id = e.workspace_id and endpoint_id = e.id
    order by created_at desc limit 1
  ) d on true
  where ${where}
  order by e.created_at desc, e.id desc
`;

const KNOWN_STATES = new Set(['pending', 'sent', 'failed', 'gave_up']);

/** A row as the contract's endpoint. */
function toEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events as WebhookEventType[],
    status: row.status === 'off' ? 'off' : 'active',
    ...(row.status === 'off' ? { offReason: row.off_reason === 'failing' ? 'failing' : 'turned_off' } : {}),
    secretHint: row.secret_hint,
    ...(row.previous_until === null ? {} : { previousSecretUntil: row.previous_until }),
    ...(row.last_state === null || row.last_at === null || !KNOWN_STATES.has(row.last_state)
      ? {}
      : {
          lastDelivery: {
            state: row.last_state as WebhookDelivery['state'],
            ...(row.last_status === null ? {} : { responseStatus: row.last_status }),
            at: row.last_at,
          },
        }),
    createdAt: row.created_at,
  };
}

/** One endpoint of this workspace, or NOT_FOUND. */
async function readEndpoint(tx: WorkspaceTx, endpointId: string): Promise<WebhookEndpoint> {
  if (!isUuid(endpointId)) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  const found = await tx.execute<EndpointRow>(endpointSelect(sql`e.id = ${endpointId}::uuid`));
  const row = found.rows[0];
  if (row === undefined) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  return toEndpoint(row);
}

/** Refuses an address that may not be an endpoint, with its one line on `url` (CONFIG_INVALID, AC-6424). */
async function checkUrl(deps: WebhookDeps, url: string): Promise<string> {
  const shape = webhookUrlProblem(url);
  if (shape !== undefined) throw refuseOn('CONFIG_INVALID', WEBHOOK_URL_MESSAGES[shape], 'url');
  const resolved = await deps.checkHost(new URL(url));
  if (resolved !== undefined) throw refuseOn('CONFIG_INVALID', WEBHOOK_URL_MESSAGES[resolved], 'url');
  return new URL(url).href;
}

/** The workspace's endpoints, newest first (AC-6419). `available` is the api's: false without a sealing key. */
export async function listWebhooks(scope: EngineScope, available: boolean): Promise<WebhookList> {
  requirePermission(scope, 'webhooks.manage');
  const found = await inWorkspace(scope, (tx) => tx.execute<EndpointRow>(endpointSelect(sql`true`)));
  return { available, endpoints: found.rows.map(toEndpoint) };
}

/**
 * Refuses FORBIDDEN unless the scope holds `webhooks.manage`: the check the api makes before it counts a send against
 * an endpoint's limit, so nobody without the power can use up an admin's sends.
 */
export function checkWebhooksAccess(scope: EngineScope): Promise<void> {
  // A promise, so a refusal reaches the caller the way every service's does.
  return Promise.resolve().then(() => requirePermission(scope, 'webhooks.manage'));
}

/** An endpoint's host, the one part of its address the audit log and an email may name. */
export const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : '');

/** One audit row for an endpoint (spec 0064): the host only, never the path, which can hold a receiver's token. */
export function auditWebhook(
  tx: WorkspaceTx,
  scope: EngineScope,
  action: 'webhook.created' | 'webhook.updated' | 'webhook.secret_rotated' | 'webhook.deleted' | 'webhook.turned_off',
  url: string,
): Promise<void> {
  return writeAudit(tx, scope.workspaceId, scope.actor, {
    action,
    targetType: 'workspace',
    targetId: scope.workspaceId,
    after: { host: hostOf(url) },
  });
}

/** The member a write is made by, for `created_by_member_id`; null for any other actor. */
const memberOf = (scope: EngineScope): string | null =>
  scope.access.principal.kind === 'member' ? scope.access.principal.memberId : null;

/**
 * Adds an endpoint (AC-6419): the address checked, at most 10 a workspace (counted under the workspace's webhook
 * lock), a new secret sealed to it. Answers the endpoint and its whole secret, the only time it is shown (AC-6420).
 */
export async function createWebhook(
  scope: EngineScope,
  deps: WebhookDeps,
  input: { readonly url: string; readonly description: string; readonly events: readonly WebhookEventType[] },
): Promise<WebhookWithSecret> {
  requirePermission(scope, 'webhooks.manage');
  const url = await checkUrl(deps, input.url);
  const secret = newWebhookSecret();
  return inWorkspace(scope, async (tx) => {
    await lockKey(tx, `webhooks:${scope.workspaceId}`);
    const counted = await tx.execute<{ count: number }>(sql`select count(*)::int as count from webhook_endpoints`);
    if ((counted.rows[0]?.count ?? 0) >= WEBHOOK_ENDPOINTS_MAX) throw refuse('CONFIG_INVALID', ENDPOINT_LIMIT_MESSAGE);
    const made = await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`);
    const id = made.rows[0]?.id;
    if (id === undefined) throw new Error('No id was made for the endpoint.');
    const sealed = sealSecret(deps.key, secret, { workspaceId: scope.workspaceId, endpointId: id });
    await tx.execute(sql`
      insert into webhook_endpoints (workspace_id, id, url, description, events, secret_sealed, secret_hint,
        created_by_member_id)
      values (${scope.workspaceId}::uuid, ${id}::uuid, ${url}, ${input.description},
        ${`{${input.events.join(',')}}`}::text[], ${sealed}, ${secretHint(secret)}, ${memberOf(scope)}::uuid)
    `);
    await auditWebhook(tx, scope, 'webhook.created', url);
    return { endpoint: await readEndpoint(tx, id), secret };
  });
}

/**
 * Changes an endpoint's address, description, events or switch. Turning it back on is the one switch AC-6423 names:
 * it clears why it was off and its failing spell. A new address is checked as on add.
 */
export async function updateWebhook(
  scope: EngineScope,
  deps: WebhookDeps,
  input: {
    readonly endpointId: string;
    readonly url?: string | undefined;
    readonly description?: string | undefined;
    readonly events?: readonly WebhookEventType[] | undefined;
    readonly status?: 'active' | 'off' | undefined;
  },
): Promise<WebhookEndpoint> {
  requirePermission(scope, 'webhooks.manage');
  if (!isUuid(input.endpointId)) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  const url = input.url === undefined ? undefined : await checkUrl(deps, input.url);
  return inWorkspace(scope, async (tx) => {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (url !== undefined) sets.push(sql`url = ${url}`);
    if (input.description !== undefined) sets.push(sql`description = ${input.description}`);
    if (input.events !== undefined) sets.push(sql`events = ${`{${input.events.join(',')}}`}::text[]`);
    if (input.status === 'active') sets.push(sql`status = 'active', off_reason = null, failing_since = null`);
    if (input.status === 'off') {
      sets.push(sql`status = 'off', off_reason = case when status = 'off' then off_reason else 'turned_off' end`);
    }
    const changed = await tx.execute<{ url: string }>(
      sql`update webhook_endpoints set ${sql.join(sets, sql`, `)} where id = ${input.endpointId}::uuid returning url`,
    );
    const row = changed.rows[0];
    if (row === undefined) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
    await auditWebhook(tx, scope, 'webhook.updated', row.url);
    return readEndpoint(tx, input.endpointId);
  });
}

/**
 * A new secret (AC-6420): the current one becomes the previous, still signing beside the new one for 24 hours, so a
 * receiver can move over without missing a delivery. Answers the whole new secret, once.
 */
export async function rotateWebhookSecret(
  scope: EngineScope,
  deps: WebhookDeps,
  input: { readonly endpointId: string },
): Promise<WebhookWithSecret> {
  requirePermission(scope, 'webhooks.manage');
  if (!isUuid(input.endpointId)) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  const secret = newWebhookSecret();
  const sealed = sealSecret(deps.key, secret, { workspaceId: scope.workspaceId, endpointId: input.endpointId });
  return inWorkspace(scope, async (tx) => {
    const changed = await tx.execute<{ url: string }>(sql`
      update webhook_endpoints set previous_secret_sealed = secret_sealed,
        previous_secret_until = now() + make_interval(hours => ${WEBHOOK_ROTATION_OVERLAP_HOURS}),
        secret_sealed = ${sealed}, secret_hint = ${secretHint(secret)}, updated_at = now()
      where id = ${input.endpointId}::uuid
      returning url
    `);
    const row = changed.rows[0];
    if (row === undefined) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
    await auditWebhook(tx, scope, 'webhook.secret_rotated', row.url);
    return { endpoint: await readEndpoint(tx, input.endpointId), secret };
  });
}

/** Removes an endpoint and its log; its waiting deliveries find nothing and send nothing. */
export async function deleteWebhook(
  scope: EngineScope,
  input: { readonly endpointId: string },
): Promise<{ readonly deleted: boolean }> {
  requirePermission(scope, 'webhooks.manage');
  if (!isUuid(input.endpointId)) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const removed = await tx.execute<{ url: string }>(
      sql`delete from webhook_endpoints where id = ${input.endpointId}::uuid returning url`,
    );
    const row = removed.rows[0];
    if (row === undefined) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
    await auditWebhook(tx, scope, 'webhook.deleted', row.url);
    return { deleted: true };
  });
}

interface DeliveryRow extends Record<string, unknown> {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly attempt: number;
  readonly state: string;
  readonly response_status: number | null;
  readonly response_ms: number | null;
  readonly response_excerpt: string | null;
  readonly failure: string | null;
  readonly next_attempt_at: string | null;
  readonly created_at: string;
  readonly created_text: string;
  readonly sent_at: string | null;
}

/** The log's columns, in the contract's shape. */
export const deliveryColumns = sql`
  id, event_id, event_type, attempt, state, response_status, response_ms, response_excerpt, failure,
  ${iso(sql`next_attempt_at`)} as next_attempt_at, ${iso(sql`created_at`)} as created_at,
  created_at::text as created_text, ${iso(sql`sent_at`)} as sent_at
`;

const FAILURES = new Set(['address', 'timeout', 'network', 'redirect', 'status', 'too_large']);

/** A row as the contract's delivery. */
export function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type as WebhookDelivery['eventType'],
    attempt: Math.max(1, row.attempt),
    state: (KNOWN_STATES.has(row.state) ? row.state : 'pending') as WebhookDelivery['state'],
    ...(row.response_status === null ? {} : { responseStatus: row.response_status }),
    ...(row.response_ms === null ? {} : { responseMs: row.response_ms }),
    ...(row.response_excerpt === null ? {} : { responseExcerpt: row.response_excerpt }),
    ...(row.failure === null || !FAILURES.has(row.failure)
      ? {}
      : { failure: row.failure as NonNullable<WebhookDelivery['failure']> }),
    ...(row.next_attempt_at === null || row.state !== 'failed' ? {} : { nextAttemptAt: row.next_attempt_at }),
    createdAt: row.created_at,
    ...(row.sent_at === null ? {} : { sentAt: row.sent_at }),
  };
}

/** What a log cursor that isn't one of ours answers. */
const CURSOR_MESSAGE = 'That list position is not valid here. Start again from the top.';

function encodeCursor(row: DeliveryRow): string {
  return Buffer.from(JSON.stringify({ a: row.created_text, i: row.id })).toString('base64url');
}

function decodeCursor(cursor: string): { readonly at: string; readonly id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const { a, i } = parsed as Record<string, unknown>;
      if (typeof a === 'string' && a.length <= 40 && !Number.isNaN(Date.parse(a)) && isUuid(i)) return { at: a, id: i };
    }
  } catch {
    // Falls through to the refusal.
  }
  throw inputInvalid('cursor', CURSOR_MESSAGE);
}

/**
 * One page of an endpoint's log (AC-6425), newest first, keyset paged on (`created_at`, `id`) through
 * `webhook_deliveries_log`. The daily cleanup keeps it to 30 days.
 */
export async function listWebhookDeliveries(
  scope: EngineScope,
  input: { readonly endpointId: string; readonly cursor?: string | undefined; readonly limit?: number | undefined },
): Promise<WebhookDeliveryPage> {
  requirePermission(scope, 'webhooks.manage');
  if (!isUuid(input.endpointId)) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
  const limit = Math.min(Math.max(input.limit ?? WEBHOOK_DELIVERIES_PAGE, 1), 100);
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  return inWorkspace(scope, async (tx) => {
    const endpoint = await tx.execute(sql`select 1 from webhook_endpoints where id = ${input.endpointId}::uuid`);
    if (endpoint.rows.length === 0) throw refuse('NOT_FOUND', ENDPOINT_NOT_FOUND);
    const found = await tx.execute<DeliveryRow>(sql`
      select ${deliveryColumns} from webhook_deliveries
      where workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
        and endpoint_id = ${input.endpointId}::uuid
        ${after === undefined ? sql`` : sql`and (created_at, id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
      order by created_at desc, id desc
      limit ${limit + 1}
    `);
    const rows = found.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      deliveries: rows.map(toDelivery),
      ...(found.rows.length > limit && last !== undefined ? { nextCursor: encodeCursor(last) } : {}),
    };
  });
}
