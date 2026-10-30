// The one `@vercel/functions` import in apps/api (spec 0045): what the api
// asks of Vercel's platform when it runs as a Vercel Function. Outside a
// function all of it is harmless: `waitUntil` lets the promise run on its own,
// a pool handed over is left as it is, and the cache tag calls do nothing.
import { addCacheTag, attachDatabasePool, dangerouslyDeleteByTag, waitUntil } from '@vercel/functions';
import type { EdgeCache } from '../edge-cache.ts';
import { errorFields, log } from '../log.ts';

/** Keeps the function instance alive until `work` settles, after the response has gone. Never rejects. */
export function keepAlive(work: Promise<unknown>): void {
  waitUntil(work.catch(() => undefined));
}

/** Hands a pg pool to the platform, so a suspending instance first closes its idle clients. */
export const attachPool: (pool: Parameters<typeof attachDatabasePool>[0]) => void = (pool) => {
  attachDatabasePool(pool);
};

/**
 * Vercel's CDN cache tags (spec 0058, AC-23). `forget` deletes rather than invalidates: an invalidated answer is
 * served stale once more while it revalidates, and a page its owner just made private must not be served at all.
 */
export const edgeCache: EdgeCache = {
  tag: (tags) => {
    if (tags.length === 0) return;
    addCacheTag([...tags]).catch((error: unknown) => log.warn('edge.cache.tag_failed', errorFields(error)));
  },
  forget: async (tags) => {
    if (tags.length === 0) return;
    try {
      await dangerouslyDeleteByTag([...tags], { revalidationDeadlineSeconds: 0 });
    } catch (error) {
      log.warn('edge.cache.forget_failed', { tags: tags.length, ...errorFields(error) });
    }
  },
};
