// `@crm/data/business-page`: the public business page's one read (spec 0066, B4 lite), `/<handle>` and
// `/<handle>/<place-slug>`, on the page's own origin with no cookies, plus the pure rules the page draws with (open now,
// directions, the address line), so the public bundle loads neither the app's layer nor Zod.
import type { PublicBusinessPage } from '@crm/contracts/business-page';
import { publicCaller, type PublicClientOptions } from './public.ts';

export {
  AMENITY_LABELS,
  businessPhotosOf,
  directionsLinks,
  placeAddressLine,
  type BusinessAmenity,
  type PublicBusinessPage,
  type PublicBusinessPlace,
  type BusinessPageMenu,
  type BusinessPageMenuSection,
} from '@crm/contracts/business-page';
export { nextOpening, openAt, rangesOn, weekDayOf, type OpenNow } from '@crm/contracts/hospitality-hours';
export { WEEK_DAYS, type HoursRangeShape, type PlaceHoursShape, type WeekDay } from '@crm/contracts/hospitality';
export { isDataError } from '../errors.ts';

/** The business page's read. */
export interface BusinessClient {
  /** The published page at `/<handle>`, or `/<handle>/<slug>` with a place's slug; NOT_FOUND for no page. */
  readonly page: (handle: string, slug?: string, signal?: AbortSignal) => Promise<PublicBusinessPage>;
}

/** The client, on `origin` (the page's own), with `fetch` passed in for tests. */
export function createBusinessClient(options: PublicClientOptions): BusinessClient {
  const { call } = publicCaller(options, 'business');
  return {
    page: (handle, slug, signal) =>
      call<PublicBusinessPage>(
        slug === undefined ? encodeURIComponent(handle) : `${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
        signal === undefined ? {} : { signal },
      ),
  };
}
