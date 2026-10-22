// A person's account picture from our own origin (the owner, 23 Oct 2026): the picture Google gave their account,
// served by the api, since the app's and the public pages' policy (img-src 'self') loads nothing from Google. Only
// Google's account picture addresses are ever named here, so the api's fetch can never be pointed anywhere else.
import { createHash } from 'node:crypto';

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

/** An older account picture's path: `/<id>/AAAAAAAAAAI/AAAAAAAAAAA/<id>/s96-c/photo.jpg`, kept as it is. */
const LEGACY_PICTURE_PATH =
  /^\/-?[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/(s\d+(-c)?\/)?photo\.jpg$/;

/** Whether `url` is on Google's picture hosts: https, no port, no credentials. A redirect is followed only there. */
export function isPictureHost(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    PICTURE_HOST.test(url.hostname)
  );
}

/**
 * The URL to fetch for an account picture, or undefined for anything but an https account picture on Google's
 * picture hosts (no port, no credentials, no other path those hosts serve). Its size options become a 256px square.
 */
export function accountPicture(image: string | undefined): URL | undefined {
  if (image === undefined || image.length > PICTURE_URL_MAX || !URL.canParse(image)) return undefined;
  const url = new URL(image);
  if (!isPictureHost(url)) return undefined;
  url.hash = '';
  const sized = ACCOUNT_PICTURE_PATH.exec(url.pathname);
  if (sized?.[1] !== undefined) {
    url.pathname = `${sized[1]}${PICTURE_SIZE}`;
    url.search = '';
    return url;
  }
  return LEGACY_PICTURE_PATH.test(url.pathname) && url.search === '' ? url : undefined;
}

/**
 * A picture's version in our own paths (`?v=`): 12 hex of the person and their picture's address. A new picture,
 * or the same address under another person (a handle freed and claimed again), is a new path, so nothing cached
 * under the old one is ever shown for it; the routes answer only the current version.
 */
export function pictureVersion(userId: string, image: string): string {
  return createHash('sha256').update(`${userId}\n${image}`).digest('hex').slice(0, 12);
}

/** An account picture to serve: where to fetch it, and its version for our path. */
export interface AccountPicture {
  readonly url: URL;
  readonly version: string;
}

/** A person's picture to serve, or undefined unless it is an account picture of Google's (`accountPicture`). */
export function servedPicture(userId: string, image: string | undefined): AccountPicture | undefined {
  const url = accountPicture(image);
  return url === undefined || image === undefined ? undefined : { url, version: pictureVersion(userId, image) };
}
