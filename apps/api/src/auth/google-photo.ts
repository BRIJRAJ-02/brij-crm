// Settings › Account › Profile's "Sync Google photo" (23 Oct 2026): a fresh Google consent for the signed in person,
// through Better Auth's account linking (`/link-social`), which links Google when it isn't yet and only refreshes it
// when it is. Its callback saves that profile's picture by `setUserImageFromGoogle`'s rules and goes back to Profile
// with `?google-photo=<result>`. Only `auth.ts` imports this.
import * as z from 'zod';

/** Better Auth's linking route, which the API serves for this button only. */
export const LINK_SOCIAL_PATH = '/link-social';

/** The search parameter Profile reads the result from. */
export const GOOGLE_PHOTO_PARAM = 'google-photo';

/**
 * What the link's start puts in its OAuth state's server context (no caller can set it): the mark that says the
 * button sent it, and whether Google was linked already, so a new link is kept in the security history.
 */
export const PHOTO_PURPOSE = { key: 'crmPurpose', value: 'google-photo', wasLinked: 'crmWasLinked' } as const;

/**
 * How a sync went, as Profile's toast says it: saved (or already the current one), Google sent no photo, a picture
 * not from Google stays, the person closed Google, the Google account has another email, is another account's, or
 * isn't verified, or anything else.
 */
export type GooglePhotoResult =
  'synced' | 'none' | 'kept' | 'cancelled' | 'other-email' | 'other-account' | 'unverified' | 'failed';

/**
 * What the button may send: Google, back to the same Profile address either way, and none of the rest Better Auth's
 * linking takes (an id token, more scopes, extra state, sign up, a login hint, provider parameters).
 */
export const LinkGoogleBody = z.strictObject({
  provider: z.literal('google'),
  callbackURL: z.string().max(512),
  errorCallbackURL: z.string().max(512),
  disableRedirect: z.boolean().optional(),
});

/** A Profile page's path: `/w/<workspace>/settings/account/profile`. */
const PROFILE_PATH = /^\/w\/[a-z0-9-]{1,63}\/settings\/account\/profile$/;

/** Whether `address` is a Profile page on the app's own origin, with nothing more (no search, no fragment). */
export function isProfileReturn(address: string, appOrigin: string): boolean {
  if (!URL.canParse(address)) return false;
  const url = new URL(address);
  return (
    url.origin === appOrigin &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    PROFILE_PATH.test(url.pathname)
  );
}

/** Profile's address with how the sync went. */
export function profileWithResult(profile: string, result: GooglePhotoResult): string {
  const url = new URL(profile);
  url.searchParams.set(GOOGLE_PHOTO_PARAM, result);
  return url.toString();
}

/** A refused link's result, from the `error` Better Auth put on the address it sent the browser to. */
export function linkFailure(location: string | undefined): GooglePhotoResult {
  const error = location !== undefined && URL.canParse(location) ? new URL(location).searchParams.get('error') : null;
  switch (error) {
    case 'access_denied':
      return 'cancelled';
    case 'email_does_not_match':
      return 'other-email';
    case 'account_already_linked_to_different_user':
      return 'other-account';
    // Better Auth's answer when Google hasn't verified the email, or the link couldn't be saved.
    case 'unable_to_link_account':
    case 'email_not_verified':
      return 'unverified';
    default:
      return 'failed';
  }
}
