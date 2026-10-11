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
import type { LoadApi } from './user.ts';

/** What each call carries to the client's fetch: where to note the API's pool wait. */
interface CallContext {
  readonly poolMs?: number[];
}

/** The contract as one simulated user calls it. */
export type LoadClient = ContractRouterClient<typeof contract, CallContext>;

const POOL = /(?:^|,)\s*pool;dur=([\d.]+)/;

/** The `pool` duration of a `Server-Timing` header, in milliseconds, or undefined without one. */
export function poolWaitOf(header: string | null): number | undefined {
  if (header === null) return undefined;
  const match = POOL.exec(header);
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
        const pool = poolWaitOf(response.headers.get('server-timing'));
        if (pool !== undefined) context.poolMs?.push(pool);
        return response;
      },
    }),
  );
}

/** The calls a simulated user makes, on `client`. */
export function loadApiOf(client: LoadClient): LoadApi {
  return {
    query: (input, call) => client.records.query(input, { context: { poolMs: call.poolMs }, signal: call.signal }),
    count: (input, call) => client.records.count(input, { context: { poolMs: call.poolMs }, signal: call.signal }),
    get: (input, call) => client.records.get(input, { context: { poolMs: call.poolMs }, signal: call.signal }),
    setValues: (input, call) =>
      client.records.setValues(input, { context: { poolMs: call.poolMs }, signal: call.signal }),
    create: (input, call) => client.records.create(input, { context: { poolMs: call.poolMs }, signal: call.signal }),
  };
}
