// The worker's one HTTP port: Railway's health check (`GET /health`, with the
// relay's delivery numbers from memory) and the
// api's poke (`POST /internal/outbox-wake`, see `realtime/wake.ts`). Nothing
// here reads a request body or touches the database: a poke only wakes the
// relay, which then drains whatever waits in the outbox. A request that comes
// with a body is refused and its connection closed, and a slow one is cut off
// after 5 seconds.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createWakeCheck, WAKE_HEADER, WAKE_PATH } from './realtime/wake.ts';

export interface WorkerHttpOptions {
  /** `WORKER_WAKE_SECRET`; unset only locally (see `createWakeCheck`). */
  readonly wakeSecret: string | undefined;
  /** Wakes the relay. Called only for a poke that carries the secret. */
  readonly onWake: () => void;
  /**
   * What `/health` reports beside `status`: the relay's mode and delivery
   * numbers (spec 0007, AC-77), from memory, so the check never queries.
   */
  readonly health?: () => Readonly<Record<string, unknown>>;
}

/** How long a request (and its headers) may take to arrive on the worker's port. */
const REQUEST_TIMEOUT_MS = 5_000;

function answer(response: ServerResponse, status: number, body?: Readonly<Record<string, unknown>>): void {
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** The worker's request listener. */
export function createWorkerListener(
  options: WorkerHttpOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const admits = createWakeCheck(options.wakeSecret);
  return (request, response) => {
    // Nothing here takes a body: refuse one unread, and close the connection rather than drain it.
    const length = request.headers['content-length'];
    if ((length !== undefined && length !== '0') || request.headers['transfer-encoding'] !== undefined) {
      response.setHeader('connection', 'close');
      response.on('finish', () => request.socket.destroy());
      answer(response, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'Requests here carry no body.' });
      return;
    }
    // The path without parsing a URL, which throws on a malformed target (`GET http://[/`) and would end the
    // worker: only origin form (`/path?query`) is taken.
    const target = request.url ?? '';
    if (!target.startsWith('/')) {
      answer(response, 400, { code: 'BAD_REQUEST', message: 'This request target is not a path.' });
      return;
    }
    const path = target.split('?', 1)[0];
    if (path === '/health') {
      answer(response, 200, { status: 'ok', ...options.health?.() });
      return;
    }
    if (path !== WAKE_PATH) {
      answer(response, 404, { code: 'NOT_FOUND', message: 'There is nothing at this address.' });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      answer(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Poke the relay with a POST.' });
      return;
    }
    const presented = request.headers[WAKE_HEADER];
    if (!admits(typeof presented === 'string' ? presented : undefined)) {
      answer(response, 401, { code: 'UNAUTHENTICATED', message: 'This poke does not carry the wake secret.' });
      return;
    }
    options.onWake();
    answer(response, 204);
  };
}

/** The worker's server: the listener, with requests and their headers cut off after 5 seconds. */
export function createWorkerServer(options: WorkerHttpOptions): Server {
  return createServer(
    { requestTimeout: REQUEST_TIMEOUT_MS, headersTimeout: REQUEST_TIMEOUT_MS },
    createWorkerListener(options),
  );
}
