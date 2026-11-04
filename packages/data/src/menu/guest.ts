// `@crm/data/menu-guest` (spec 0065, H1): the guest menu page's one read, `GET /api/public/menu/:key`, on the page's
// own origin with no cookies, each failure a DataError (`NOT_FOUND` for a menu that isn't there, `API_UNAVAILABLE`
// offline). Small and Zod free, so the guest page's bundle stays light.
import type { PublicMenu, PublicMenuTable } from '@crm/contracts';
import { publicCaller, type PublicClientOptions } from '../booking/public.ts';

export { isDataError, type DataError } from '../errors.ts';
export type { PublicMenu, PublicMenuTable } from '@crm/contracts';

/** The guest menu's client. */
export interface MenuClient {
  /** The place's published menu, the items sold out now and the header. */
  readonly read: (key: string, signal?: AbortSignal) => Promise<PublicMenu>;
  /** The table a QR's code named (spec 0065, H2), for the bar's "Table 4"; reading it counts the scan. */
  readonly table: (key: string, code: string, signal?: AbortSignal) => Promise<PublicMenuTable>;
}

/** The client, on `origin` (the page's own), with `fetch` passed in for tests. */
export function createMenuClient(options: PublicClientOptions): MenuClient {
  const { call } = publicCaller(options, 'menu');
  return {
    read: (key, signal) => call<PublicMenu>(encodeURIComponent(key), signal === undefined ? {} : { signal }),
    table: (key, code, signal) =>
      call<PublicMenuTable>(
        `${encodeURIComponent(key)}/tables/${encodeURIComponent(code)}`,
        signal === undefined ? {} : { signal },
      ),
  };
}
