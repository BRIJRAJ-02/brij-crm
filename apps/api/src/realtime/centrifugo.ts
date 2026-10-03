// Centrifugo's server API, the one place the backend talks to it (spec 0005).
// The relay publishes here over the private network (`CENTRIFUGO_API_URL`, the
// internal port 9000), authenticated by `X-API-Key`. Centrifugo answers 200
// with an `error` object for a refused call, so both are checked.
import * as z from 'zod';

/** What one publish needs: the channel, the event, and the key Centrifugo drops a repeat by. */
export interface PublishInput {
  readonly channel: string;
  readonly data: unknown;
  /** Centrifugo keeps it for 5 minutes and ignores a publish that repeats it. */
  readonly idempotencyKey: string;
}

/** Publishes one message, or throws an error with `code: 'PUBLISH_FAILED'` and a plain message. */
export type Publish = (input: PublishInput) => Promise<void>;

export interface CentrifugoOptions {
  /** The server API's base, like `http://centrifugo.railway.internal:9000`. */
  readonly apiUrl: string;
  readonly apiKey: string;
  /** How long one call may take before it counts as failed (default 5 seconds). */
  readonly timeoutMs?: number;
}

const Reply = z.object({
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

function publishFailed(message: string, cause?: unknown): Error & { readonly code: 'PUBLISH_FAILED' } {
  return Object.assign(new Error(message, { cause }), { code: 'PUBLISH_FAILED' as const });
}

/** The relay's publisher: `POST {apiUrl}/api/publish`. */
export function createCentrifugoPublisher(options: CentrifugoOptions): { readonly publish: Publish } {
  const endpoint = `${options.apiUrl.replace(/\/+$/, '')}/api/publish`;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    async publish({ channel, data, idempotencyKey }) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
          body: JSON.stringify({ channel, data, idempotency_key: idempotencyKey }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw publishFailed('Centrifugo could not be reached.', error);
      }
      if (!response.ok) throw publishFailed(`Centrifugo answered ${String(response.status)}.`);
      const reply = Reply.safeParse(await response.json().catch(() => undefined));
      if (!reply.success) throw publishFailed('Centrifugo answered with something other than a reply.');
      if (reply.data.error !== undefined) {
        throw publishFailed(`Centrifugo refused the publish (${String(reply.data.error.code)}).`);
      }
    },
  };
}
