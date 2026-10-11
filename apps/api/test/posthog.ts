// A fake PostHog capture endpoint for tests (spec 0010, milestone 3): a local
// HTTP server that keeps every request the real `posthog-node` client sends
// it, its body ungzipped and parsed, so a test sees exactly what would reach
// PostHog. It can also answer slowly or fail, to prove sending never slows or
// breaks the app (AC-166).
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

/** One request the fake endpoint received. */
export interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** One event as PostHog's batch endpoint receives it. */
export interface SentProductEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly uuid?: string;
  readonly timestamp?: string;
  readonly properties: Record<string, unknown>;
}

/** How the fake endpoint answers: at once, never (hangs), or with a server error. */
export type FakeMode = 'ok' | 'hang' | 'fail';

/** A running fake endpoint: its address, what it got, and how to stop it. */
export interface FakePostHog {
  readonly host: string;
  readonly requests: CapturedRequest[];
  /** Every event in every batch received, in order. */
  events(): SentProductEvent[];
  setMode(mode: FakeMode): void;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const text = (request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Starts a fake PostHog on a free local port. */
export async function startFakePostHog(): Promise<FakePostHog> {
  const requests: CapturedRequest[] = [];
  let mode: FakeMode = 'ok';
  const hanging = new Set<() => void>();
  const server: Server = createServer((request, response) => {
    void readBody(request).then((body) => {
      requests.push({ method: request.method ?? '', path: new URL(request.url ?? '/', 'http://x').pathname, body });
      if (mode === 'hang') {
        hanging.add(() => response.destroy());
        return;
      }
      response.writeHead(mode === 'fail' ? 500 : 200, { 'content-type': 'application/json' });
      response.end(mode === 'fail' ? '{"error":"down"}' : '{"status":"Ok"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    host: `http://127.0.0.1:${port}`,
    requests,
    events: () =>
      requests.flatMap((request) =>
        isRecord(request.body) && Array.isArray(request.body.batch) ? (request.body.batch as SentProductEvent[]) : [],
      ),
    setMode: (next) => {
      mode = next;
    },
    close: async () => {
      for (const end of hanging) end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
