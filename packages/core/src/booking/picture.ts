// A host's account picture on the public pages (the owner, 23 Oct 2026): the picture Google gave their account, served
// from our own origin, since the public pages' policy (img-src 'self') loads nothing from Google. Only Google's
// picture hosts are ever named here, so the api's fetch can never be pointed anywhere else.

/** Reads a person's account picture by their user id: the stored URL as it is, or undefined. */
export type AccountPictureReader = (userId: string) => Promise<string | undefined>;

/** Google's profile picture hosts (`lh3` today; `lh4` to `lh6` on older accounts). */
const PICTURE_HOST = /^lh[3-6]\.googleusercontent\.com$/;

/** The longest picture URL taken (the same bound as `members.avatar_url`). */
const PICTURE_URL_MAX = 2048;

/** The square size asked of Google: twice the largest avatar (72px), for sharp screens. */
const PICTURE_SIZE = '=s256-c';

/** An account picture's path (`/a/<id>` or `/a-/<id>`), with or without its size options (`=s96-c`). */
const ACCOUNT_PICTURE_PATH = /^(\/a-?\/[A-Za-z0-9_-]+)(=[A-Za-z0-9-]*)?$/;

/**
 * The URL to fetch for an account picture, or undefined for anything that isn't an https picture on Google's
 * picture hosts (no port, no credentials). An account picture's size options become a 256px square; any other
 * path on those hosts is kept as it is.
 */
export function accountPicture(image: string | undefined): URL | undefined {
  if (image === undefined || image.length > PICTURE_URL_MAX || !URL.canParse(image)) return undefined;
  const url = new URL(image);
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return undefined;
  if (!PICTURE_HOST.test(url.hostname)) return undefined;
  const sized = ACCOUNT_PICTURE_PATH.exec(url.pathname);
  if (sized?.[1] !== undefined) {
    url.pathname = `${sized[1]}${PICTURE_SIZE}`;
    url.search = '';
  }
  url.hash = '';
  return url;
}

/** Whether `url` is one `accountPicture` would fetch: a redirect is followed only to such a place. */
export function isPictureHost(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && PICTURE_HOST.test(url.hostname);
}
