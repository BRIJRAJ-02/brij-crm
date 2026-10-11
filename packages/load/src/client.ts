// The harness's client of the real contract (spec 0011, AC-196, AC-202): one
// per simulated user, sending its minted session cookie and the API's own
// origin (writes need it, as a browser's would), and reading the API's pool
// wait from each answer's `Server-Timing` header. The harness goes through
// the same doors as a browser: the session, the oRPC contract and the access
// door.
import type { contract } from '@crm/contracts';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { LiveApi } from './live/user.ts';
import type { LoadApi } from './user.ts';

/** What each call carries to the client's fetch: where to note the API's pool wait and handler time. */
interface CallContext {
  readonly poolMs?: number[];
  readonly appMs?: number[];
}

/** The contract as one simulated user calls it. */
export type LoadClient = ContractRouterClient<typeof contract, CallContext>;

/** One named duration of a `Server-Timing` header (`pool`, `db` or `app`), in milliseconds, or undefined without it. */
export function serverTimingOf(header: string | null, name: 'pool' | 'db' | 'app'): number | undefined {
  if (header === null) return undefined;
  const match = new RegExp(`(?:^|,)\\s*${name};dur=([\\d.]+)`).exec(header);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** A client of the API at `apiUrl` signed in with `cookie` (a `Cookie` header from `.load/sessions.json`). */
export function createLoadClient(apiUrl: string, cookie: string): LoadClient {
  return createORPCClient(
    new RPCLink<CallContext>({
      url: new URL('/api/rpc', apiUrl).href,
      headers: { cookie, origin: new URL(apiUrl).origin },
      fetch: async (request, init, { context }) => {
        const response = await fetch(request, init);
        const header = response.headers.get('server-timing');
        const pool = serverTimingOf(header, 'pool');
        const app = serverTimingOf(header, 'app');
        if (pool !== undefined) context.poolMs?.push(pool);
        if (app !== undefined) context.appMs?.push(app);
        return response;
      },
    }),
  );
}

/** The calls a simulated user makes, on `client`. */
export function loadApiOf(client: LoadClient): LoadApi {
  return {
    query: (input, call) =>
      client.records.query(input, { context: { poolMs: call.poolMs, appMs: call.appMs }, signal: call.signal }),
    count: (input, call) =>
      client.records.count(input, { context: { poolMs: call.poolMs, appMs: call.appMs }, signal: call.signal }),
    get: (input, call) =>
      client.records.get(input, { context: { poolMs: call.poolMs, appMs: call.appMs }, signal: call.signal }),
    setValues: (input, call) =>
      client.records.setValues(input, { context: { poolMs: call.poolMs, appMs: call.appMs }, signal: call.signal }),
    create: (input, call) =>
      client.records.create(input, { context: { poolMs: call.poolMs, appMs: call.appMs }, signal: call.signal }),
  };
}

/** The live calls a simulated user makes (milestone 3, AC-200), on `client`: the same doors as a browser's. */
export function liveApiOf(client: LoadClient): LiveApi {
  return {
    connectionToken: (call) =>
      client.realtime.connectionToken(undefined, {
        context: { poolMs: call.poolMs, appMs: call.appMs },
        signal: call.signal,
      }),
    subscriptionToken: (input, call) =>
      client.realtime.subscriptionToken(input, {
        context: { poolMs: call.poolMs, appMs: call.appMs },
        signal: call.signal,
      }),
    catchUp: (input, call) =>
      client.realtime.catchUp(input, { context: { poolMs: call.poolMs, appMs: call.appMs }, signal: call.signal }),
  };
}
