// The one `@vercel/functions` import in apps/api (spec 0045): what the api
// asks of Vercel's platform when it runs as a Vercel Function. Outside a
// function both are harmless: `waitUntil` lets the promise run on its own, and
// a pool handed over is left as it is.
import { attachDatabasePool, waitUntil } from '@vercel/functions';

/** Keeps the function instance alive until `work` settles, after the response has gone. Never rejects. */
export function keepAlive(work: Promise<unknown>): void {
  waitUntil(work.catch(() => undefined));
}

/** Hands a pg pool to the platform, so a suspending instance first closes its idle clients. */
export const attachPool: (pool: Parameters<typeof attachDatabasePool>[0]) => void = (pool) => {
  attachDatabasePool(pool);
};
