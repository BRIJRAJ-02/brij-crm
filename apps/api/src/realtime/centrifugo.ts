// Centrifugo's server API, the one place the backend talks to it (spec 0005).
// The relay publishes here over the private network (`CENTRIFUGO_API_URL`, the
// internal port 9000), authenticated by `X-API-Key`: one workspace's batch is
// one `/api/batch` call in sequential mode. Centrifugo runs every command in a
// batch and answers each one, with an `error` object for a refused command (and
// 200 overall), so the replies are read in order up to the first error.
import * as z from 'zod';

/** What one publish needs: the channel, the event, and the key Centrifugo drops a repeat by. */
export interface PublishInput {
  readonly channel: string;
  readonly data: unknown;
  /** Centrifugo keeps it for 5 minutes and ignores a publish that repeats it. */
  readonly idempotencyKey: string;
}

/** A failed publish: `code: 'PUBLISH_FAILED'` and a plain message. */
export type PublishError = Error & { readonly code: 'PUBLISH_FAILED' };

/** How a batch went: how many leading publishes landed, and what stopped the rest, if anything did. */
export interface BatchOutcome {
  /** The publishes that landed, counted from the first up to the first failure. */
  readonly published: number;
  readonly error?: PublishError;
}

/**
 * Publishes a batch in order with one call. Never throws: what failed comes
 * back as `error`, and only the first `published` items count as sent (any
 * after a failure may have landed too, and their idempotency keys make a
 * retry of them harmless).
 */
export type PublishBatch = (items: readonly PublishInput[]) => Promise<BatchOutcome>;

export interface CentrifugoOptions {
  /** The server API's base, like `http://centrifugo.railway.internal:9000`. */
  readonly apiUrl: string;
  readonly apiKey: string;
  /** How long one call may take before it counts as failed (default 5 seconds). */
  readonly timeoutMs?: number;
}

const ReplyError = z.object({ code: z.number(), message: z.string() });

// `/api/batch` answers `{ replies: [...] }`, one per command in order, or an `error` for the whole call. An
// empty batch answers `{}`.
const BatchReply = z.object({
  replies: z.array(z.object({ error: ReplyError.optional() }).loose()).optional(),
  error: ReplyError.optional(),
});

function publishFailed(message: string, cause?: unknown): PublishError {
  return Object.assign(new Error(message, { cause }), { code: 'PUBLISH_FAILED' as const });
}

/** The relay's publisher: `POST {apiUrl}/api/batch`, sequential. */
export function createCentrifugoPublisher(options: CentrifugoOptions): { readonly publishBatch: PublishBatch } {
  const endpoint = `${options.apiUrl.replace(/\/+$/, '')}/api/batch`;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    async publishBatch(items) {
      if (items.length === 0) return { published: 0 };
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
          body: JSON.stringify({
            commands: items.map(({ channel, data, idempotencyKey }) => ({
              publish: { channel, data, idempotency_key: idempotencyKey },
            })),
            parallel: false,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return { published: 0, error: publishFailed('Centrifugo could not be reached.', error) };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { published: 0, error: publishFailed(`Centrifugo answered ${String(response.status)}.`) };
      }
      const reply = BatchReply.safeParse(await response.json().catch(() => undefined));
      if (!reply.success) {
        return { published: 0, error: publishFailed('Centrifugo answered with something other than a reply.') };
      }
      if (reply.data.error !== undefined) {
        return {
          published: 0,
          error: publishFailed(`Centrifugo refused the batch (${String(reply.data.error.code)}).`),
        };
      }
      const replies = reply.data.replies ?? [];
      const failedAt = replies.findIndex((item) => item.error !== undefined);
      if (failedAt >= 0) {
        return {
          published: failedAt,
          error: publishFailed(`Centrifugo refused a publish (${String(replies[failedAt]?.error?.code)}).`),
        };
      }
      if (replies.length < items.length) {
        return { published: replies.length, error: publishFailed('Centrifugo answered fewer replies than publishes.') };
      }
      return { published: items.length };
    },
  };
}
