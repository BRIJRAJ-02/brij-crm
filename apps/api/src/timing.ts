// The load harness's timing header (spec 0011, AC-202): with `APP_ENV=local`
// and `LOAD_TIMING=on`, every `/api/rpc` answer carries
// `Server-Timing: pool;dur=<ms>, db;dur=<ms>, app;dur=<ms>`: the request's
// time waiting for a database client, its time holding one (its queries and
// their round trips), and the whole handler. It exposes internal timings, so
// the API refuses `LOAD_TIMING=on` anywhere but local (env.ts), and without
// it nothing here runs and no header is sent.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolTiming, PoolTimingSink } from '@crm/db';

/** One request's database time so far, in milliseconds. */
interface Totals {
  pool: number;
  db: number;
}

/** The request timing the API's pools and its RPC route share. */
export interface RequestTiming {
  /** What the pools call at each checkout: the running request's sink, or none outside a timed request. */
  readonly current: PoolTiming;
  /** Runs `handle` as one timed request, and answers its response with the `Server-Timing` header added. */
  readonly timed: (handle: () => Promise<Response>) => Promise<Response>;
}

/** Milliseconds as the header writes them: one decimal place. */
const ms = (value: number): string => value.toFixed(1);

/** The header's value for one request. */
export function serverTiming(totals: { readonly pool: number; readonly db: number; readonly app: number }): string {
  return `pool;dur=${ms(totals.pool)}, db;dur=${ms(totals.db)}, app;dur=${ms(totals.app)}`;
}

/** A request timing of its own: one per API process, made only with `LOAD_TIMING=on`. */
export function createRequestTiming(): RequestTiming {
  const requests = new AsyncLocalStorage<PoolTimingSink>();
  return {
    current: () => requests.getStore(),
    async timed(handle) {
      // Added to as the request's checkouts finish; read once, when the handler has answered.
      const totals: Totals = { pool: 0, db: 0 };
      const sink: PoolTimingSink = {
        waited: (wait) => {
          totals.pool += wait;
        },
        held: (hold) => {
          totals.db += hold;
        },
      };
      const started = performance.now();
      const response = await requests.run(sink, handle);
      const app = performance.now() - started;
      const headers = new Headers(response.headers);
      headers.set('Server-Timing', serverTiming({ ...totals, app }));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  };
}
