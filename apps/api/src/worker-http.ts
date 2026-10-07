// The worker's one HTTP port: Railway's health check (`GET /health`) and the
// api's poke (`POST /internal/outbox-wake`, see `realtime/wake.ts`). Nothing
// here reads a request body or touches the database: a poke only wakes the
// relay, which then drains whatever waits in the outbox.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWakeCheck, WAKE_HEADER, WAKE_PATH } from './realtime/wake.ts';

export interface WorkerHttpOptions {
  /** `WORKER_WAKE_SECRET`; unset only locally (see `createWakeCheck`). */
  readonly wakeSecret: string | undefined;
  /** Wakes the relay. Called only for a poke that carries the secret. */
  readonly onWake: () => void;
}

function answer(response: ServerResponse, status: number, body?: Record<string, string>): void {
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
    // Whatever was sent, it isn't read.
    request.resume();
    // The path without parsing a URL, which throws on a malformed target (`GET http://[/`) and would end the
    // worker: only origin form (`/path?query`) is taken.
    const target = request.url ?? '';
    if (!target.startsWith('/')) {
      answer(response, 400, { code: 'BAD_REQUEST', message: 'This request target is not a path.' });
      return;
    }
    const path = target.split('?', 1)[0];
    if (path === '/health') {
      answer(response, 200, { status: 'ok' });
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
