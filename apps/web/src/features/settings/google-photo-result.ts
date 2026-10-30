// How a Google photo sync went (`?google-photo=`): plain values with no imports, so the Profile route's
// `validateSearch` (in the first load) can read the address without pulling in the settings pages' words, as
// object-tabs.ts does for the object settings route. `workspace-strings.ts` has one note for each.

/** The results the API sends Profile back with, on the way back from Google. */
export const GOOGLE_PHOTO_RESULTS = [
  'synced',
  'none',
  'kept',
  'cancelled',
  'other-email',
  'other-account',
  'unverified',
  'failed',
] as const;

/** How a Google photo sync went, as the API's way back from Google names it (`?google-photo=`). */
export type GooglePhotoResult = (typeof GOOGLE_PHOTO_RESULTS)[number];

/** True when `value` is one of the results the API sends Profile back with. */
export function isGooglePhotoResult(value: unknown): value is GooglePhotoResult {
  return typeof value === 'string' && (GOOGLE_PHOTO_RESULTS as readonly string[]).includes(value);
}
