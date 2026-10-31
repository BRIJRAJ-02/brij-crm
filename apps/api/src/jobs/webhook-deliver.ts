// Webhook deliveries (spec 0064, AC-6421, AC-6423, AC-6424): the one place a webhook leaves for a receiver, and the
// worker's `crm_webhook_deliver` task, which `crm_enqueue_webhook_delivery` queues (migration 0135) in the transaction
// of the write the event describes. The sender is a POST of the stored body with the event's headers and its
// signature, under these bounds, all here rather than at each caller:
// - the address passes core's rules again at send time (https, port 443, a host name), and every address its host
//   resolves to now is checked against the refusal list; one refused answer refuses the send;
// - the connection goes to the address that was checked (a pinned lookup), with the host name kept for TLS, so a DNS
//   answer that changes between the check and the connection (rebinding) can never reach an inside address;
// - 10 seconds for the whole send, no redirect followed (a 3xx is a failure), no cookie, no proxy, a fresh
//   connection each time, and only the first 1 KB of the answer read.
// The task reads the delivery as the system, sends outside every transaction, then records the try: delivered, the
// next try queued at the next backoff step, or given up. Logs name the endpoint, the event type, the status, the
// time and the try; never the address, the body or a secret.
import { promises as dns, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  resolvedProblem,
  SIGNATURE_HEADER,
  signatureHeader,
  webhookUrlProblem,
  type WebhookKey,
  type WebhookSend,
  type WebhookSendResult,
  type WebhookUrlProblem,
} from '@crm/core';
import { finishWebhookDelivery, loadWebhookDelivery, type systemScope } from '@crm/core/system';
import { WEBHOOK_EXCERPT_MAX } from '@crm/contracts';
import * as z from 'zod';

/** The task's name on Graphile's queue. */
export const WEBHOOK_TASK = 'crm_webhook_deliver';

/** Its payload: what `crm_enqueue_webhook_delivery` writes, ids only. */
export const WebhookPayload = z.strictObject({ workspaceId: z.uuid(), deliveryId: z.uuid() });
export type WebhookPayload = z.infer<typeof WebhookPayload>;

/** How long a receiver has to answer, the whole send included (AC-6423). */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Who we say we are (AC-6421). */
export const WEBHOOK_AGENT = 'Timefix-Webhooks/1';

/** What a host resolves to, every answer with its family. Injected so tests never touch DNS. */
export type WebhookLookup = (hostname: string) => Promise<readonly LookupAddress[]>;

const resolveAll: WebhookLookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/** Sends one delivery and says how it went. Never throws. */
export type WebhookSender = (send: WebhookSend) => Promise<WebhookSendResult>;

/** The resolved half of the address rule, for an endpoint being added or changed (AC-6424). */
export function createHostCheck(
  lookup: WebhookLookup = resolveAll,
): (url: URL) => Promise<WebhookUrlProblem | undefined> {
  return async (url) => {
    const found = await lookup(url.hostname).catch((): readonly LookupAddress[] => []);
    return resolvedProblem(found.map((each) => each.address));
  };
}

/** The headers one try carries (AC-6421): the event's id, type and try, our agent, and the signature. */
export function webhookHeaders(send: WebhookSend, unixSeconds: number): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': WEBHOOK_AGENT,
    'timefix-event-id': send.eventId,
    'timefix-event-type': send.eventType,
    'timefix-delivery-attempt': String(send.attempt),
    [SIGNATURE_HEADER.toLowerCase()]: signatureHeader(send.secrets, unixSeconds, send.body),
  };
}

/** A lookup that answers only the address already checked, in whichever shape the caller asked for. */
export function pinnedLookup(pinned: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}

/** Options a test may pass: its own resolver, clock and limit, and (for a local receiver only) a trusted CA. */
export interface WebhookSenderOptions {
  readonly lookup?: WebhookLookup;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** A test's own certificate authority, so a receiver on a test certificate can be reached. Never set in the app. */
  readonly ca?: string;
}

/** Builds the one webhook sender. */
export function createWebhookSender(options: WebhookSenderOptions = {}): WebhookSender {
  const lookup = options.lookup ?? resolveAll;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  return async (send) => {
    const started = now();
    const elapsed = () => Math.max(0, now() - started);
    const refused = (failure: 'address'): WebhookSendResult => ({ ok: false, ms: elapsed(), failure });
    if (webhookUrlProblem(send.url) !== undefined) return refused('address');
    const url = new URL(send.url);
    const found = await lookup(url.hostname).catch((): readonly LookupAddress[] => []);
    if (resolvedProblem(found.map((each) => each.address)) !== undefined) return refused('address');
    const [pinned] = found;
    if (pinned === undefined) return refused('address');
    const headers = webhookHeaders(send, Math.floor(now() / 1000));
    return new Promise<WebhookSendResult>((resolve) => {
      let settled = false;
      const finish = (result: WebhookSendResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const signal = AbortSignal.timeout(timeoutMs);
      const outgoing = request(
        {
          method: 'POST',
          host: url.hostname,
          servername: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          headers: { ...headers, 'content-length': String(Buffer.byteLength(send.body)) },
          lookup: pinnedLookup(pinned),
          agent: false,
          signal,
          ...(options.ca === undefined ? {} : { ca: options.ca }),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const chunks: Buffer[] = [];
          let size = 0;
          const done = () => {
            const excerpt = Buffer.concat(chunks).toString('utf8').slice(0, WEBHOOK_EXCERPT_MAX);
            const ok = status >= 200 && status < 300;
            finish({
              ok,
              status,
              ms: elapsed(),
              ...(excerpt === '' ? {} : { excerpt }),
              ...(ok ? {} : { failure: status >= 300 && status < 400 ? ('redirect' as const) : ('status' as const) }),
            });
          };
          response.on('data', (chunk: Buffer) => {
            if (size >= WEBHOOK_EXCERPT_MAX) return;
            chunks.push(chunk.subarray(0, WEBHOOK_EXCERPT_MAX - size));
            size += chunk.length;
            // The rest of the answer is never read: the excerpt is all the log keeps.
            if (size >= WEBHOOK_EXCERPT_MAX) {
              done();
              response.destroy();
            }
          });
          response.on('end', done);
          response.on('error', done);
          response.on('close', done);
        },
      );
      outgoing.on('error', () => {
        finish({ ok: false, ms: elapsed(), failure: signal.aborted ? 'timeout' : 'network' });
      });
      outgoing.end(send.body);
    });
  };
}

/** What the task needs: the system's scope in a workspace, the sealing key, the sender and the log. */
export interface WebhookDeliverDeps {
  readonly systemScope: (workspaceId: string) => ReturnType<typeof systemScope>;
  readonly key: WebhookKey;
  readonly send: WebhookSender;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
}

/**
 * One queued delivery's try. Anything that throws (the database) is thrown on for Graphile's own retries (3); a
 * receiver's failure never throws: it is recorded, and its next try queued by the record itself.
 */
export async function runWebhookDelivery(deps: WebhookDeliverDeps, payload: unknown): Promise<void> {
  const parsed = WebhookPayload.safeParse(payload);
  if (!parsed.success) {
    deps.log.warn('webhooks.payload_invalid', {});
    return;
  }
  const { workspaceId, deliveryId } = parsed.data;
  const scope = deps.systemScope(workspaceId);
  const loaded = await loadWebhookDelivery(scope, deps.key, { deliveryId });
  if (loaded.kind === 'skip') {
    deps.log.info('webhooks.delivery.skipped', { workspaceId, deliveryId, reason: loaded.reason });
    return;
  }
  const result = await deps.send(loaded.send);
  const finished = await finishWebhookDelivery(scope, loaded.send, result);
  deps.log[result.ok ? 'info' : 'warn']('webhooks.delivery', {
    workspaceId,
    endpointId: loaded.send.endpointId,
    eventType: loaded.send.eventType,
    status: result.status,
    failure: result.failure,
    ms: result.ms,
    attempt: loaded.send.attempt,
    state: finished.delivery.state,
  });
  if (finished.endpointOff) {
    deps.log.warn('webhooks.endpoint_off', { workspaceId, endpointId: loaded.send.endpointId });
  }
}
