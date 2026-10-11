// Where one request's database time goes (spec 0011, AC-202): how long each
// checkout waited for a client, and how long it held one. The API turns these
// into its `Server-Timing` header only with `LOAD_TIMING=on`, on a laptop;
// without a timing function a pool is left exactly as pg made it.
import type pg from 'pg';

/** What one piece of work hears about its checkouts, in milliseconds. */
export interface PoolTimingSink {
  /** A checkout waited this long for a client (the pool, then the pooler's handshake for a new one). */
  readonly waited: (ms: number) => void;
  /** A checkout held its client this long, from getting it to giving it back: its queries and round trips. */
  readonly held: (ms: number) => void;
}

/**
 * The sink of the work running now, or undefined to time nothing. It is read
 * when a checkout starts, in the caller's async context (the API keeps one
 * per request), never when the pool hands the client over, which may happen
 * in whichever request released it.
 */
export type PoolTiming = () => PoolTimingSink | undefined;

type Connect = pg.Pool['connect'];
type ConnectCallback = (error: Error | undefined, client: pg.PoolClient | undefined, done: () => void) => void;

/**
 * Times every checkout of `pool` for the sink `timing` names at that moment:
 * its wait for a client, and how long it held it until release. Wraps this
 * pool's own `connect`, which `pool.query` and Drizzle's transactions both go
 * through, in its promise and callback forms alike.
 */
export function timePool(pool: pg.Pool, timing: PoolTiming): void {
  const connect = pool.connect.bind(pool) as (callback?: ConnectCallback) => Promise<pg.PoolClient> | undefined;
  const holding = new WeakMap<pg.PoolClient, { readonly sink: PoolTimingSink; readonly at: number }>();
  pool.on('release', (_error: Error | undefined, client: pg.PoolClient) => {
    const entry = holding.get(client);
    if (entry === undefined) return;
    holding.delete(client);
    entry.sink.held(performance.now() - entry.at);
  });
  const timed = (callback?: ConnectCallback) => {
    const sink = timing();
    if (sink === undefined) return connect(callback);
    const started = performance.now();
    const got = (client: pg.PoolClient) => {
      const at = performance.now();
      sink.waited(at - started);
      holding.set(client, { sink, at });
    };
    if (callback !== undefined) {
      return connect((error, client, done) => {
        if (error === undefined && client !== undefined) got(client);
        callback(error, client, done);
      });
    }
    return (connect() ?? Promise.reject(new Error('The pool did not answer the checkout.'))).then((client) => {
      got(client);
      return client;
    });
  };
  // The pool is this module's caller's own, made a line before; only its checkout is wrapped.
  Object.assign(pool, { connect: timed as unknown as Connect });
}
