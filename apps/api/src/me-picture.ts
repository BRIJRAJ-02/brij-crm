// The signed in person's own picture (23 Oct 2026; uploads 27 Oct 2026). Two routes, both under /api:
// - `GET /me/picture?v=`: their picture from our own origin, an upload or Google's (the app's policy loads nothing
//   from Google), only its current version, kept in their browser alone.
// - `POST /me/picture`: a picture they chose, the request body itself, its `content-type` its type. The browser has
//   already squared it and drawn it again (`apps/web`, `photo.ts`), which leaves a photo's location and camera
//   behind; this route trusts none of that. The order: a session, a store, the person's own limit, the type against
//   the allowlist, the body read to at most `PICTURE_UPLOAD_MAX_BYTES`, the first bytes against the type, and only
//   then the store, under `pictures/<their id>/<random id>.<ext>`, nothing in it typed by anyone. Then their account's
//   picture becomes it, over Google's too (an upload is a choice they made), and an older upload of theirs goes.
// The global Origin check refuses a write from anywhere but the app. Nothing here logs a picture or its address.
import { randomUUID } from 'node:crypto';
import { matchesContent, PICTURE_UPLOAD_MAX_BYTES, pictureTypeOf, type ErrorCode } from '@crm/contracts';
import { personPicture, storedPictureImage, storedPictureOf, storedPicturePath } from '@crm/core';
import type { IdentityStore } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Auth } from './auth/auth.ts';
import type { PublicLimiter } from './limits.ts';
import { errorFields, log } from './log.ts';
import { pictureResponse, PRIVATE_PICTURE_CACHE_CONTROL, type PictureLoad } from './public/picture.ts';
import type { FileStore } from './storage/blob.ts';

/** A person's own picture: 60 reads a minute each, in this process. */
const READ_LIMIT = { max: 60, windowMs: 60_000 } as const;

/** Uploads: ten an hour each, in this process. Enough to try a few; not a free image host. */
const UPLOAD_LIMIT = { max: 10, windowMs: 3_600_000 } as const;

/** What the routes need: sign in, the identity store's two picture calls, the store, the loader and the limiter. */
export interface MyPictureDeps {
  readonly auth: Auth;
  readonly identity: Pick<IdentityStore, 'setUserImageFromUpload'>;
  /** The private store pictures are kept in; absent, an upload answers 503 and a stored picture is missing. */
  readonly files: FileStore | undefined;
  readonly load: PictureLoad;
  readonly limiter: PublicLimiter;
  readonly errorResponse: (code: ErrorCode, message: string) => Response;
}

/** What the routes read off the request: as the app sets them. */
interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** The path a picture is read from: `/api/me/picture?v=<version>`. */
export function myPictureHref(version: string): string {
  return `/api/me/picture?v=${version}`;
}

/** Mounts the person's own picture routes. */
export function mountMyPicture(app: Hono<{ Variables: Variables }>, deps: MyPictureDeps): void {
  const { auth, identity, files, load, limiter, errorResponse } = deps;

  app.get('/me/picture', async (c) => {
    const session = await auth.session(c.req.raw.headers, c.get('clientIp'));
    if (session === undefined) return errorResponse('UNAUTHENTICATED', 'Sign in to continue.');
    const picture = personPicture(session.user.id, session.user.image);
    if (picture === undefined || c.req.query('v') !== picture.version) {
      return errorResponse('NOT_FOUND', 'There’s no picture here.');
    }
    const decision = limiter(`me-picture:${session.user.id}`, READ_LIMIT);
    if (!decision.allowed) return errorResponse('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    const fetched = await load(picture);
    if (!fetched.ok) {
      log.warn('me.picture.missed', { requestId: c.get('requestId'), kind: picture.kind, reason: fetched.reason });
      return errorResponse('NOT_FOUND', 'There’s no picture here.');
    }
    const answered = pictureResponse(fetched, PRIVATE_PICTURE_CACHE_CONTROL);
    for (const cookie of session.setCookies) answered.headers.append('set-cookie', cookie);
    return answered;
  });

  app.post(
    '/me/picture',
    bodyLimit({
      maxSize: PICTURE_UPLOAD_MAX_BYTES,
      onError: () => errorResponse('PAYLOAD_TOO_LARGE', 'Choose a picture smaller than 2 MB.'),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      const session = await auth.session(c.req.raw.headers, c.get('clientIp'));
      if (session === undefined) return errorResponse('UNAUTHENTICATED', 'Sign in to continue.');
      if (files === undefined) return errorResponse('API_UNAVAILABLE', 'Pictures can’t be uploaded here yet.');
      const userId = session.user.id;
      const decision = limiter(`me-picture-upload:${userId}`, UPLOAD_LIMIT);
      if (!decision.allowed) {
        return errorResponse('RATE_LIMITED', 'You’ve changed your picture a few times just now. Try again later.');
      }
      const type = pictureTypeOf(c.req.header('content-type') ?? '');
      if (type === undefined) return errorResponse('INPUT_INVALID', 'Choose a JPEG, PNG or WebP picture.');
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) return errorResponse('INPUT_INVALID', 'Choose a picture.');
      if (bytes.byteLength > PICTURE_UPLOAD_MAX_BYTES) {
        return errorResponse('PAYLOAD_TOO_LARGE', 'Choose a picture smaller than 2 MB.');
      }
      // What it says it is, by its own first bytes: a script renamed .png is never kept as a picture.
      if (!matchesContent(type, bytes.subarray(0, 4096))) {
        return errorResponse('INPUT_INVALID', 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP.');
      }
      const extension = type.sniff === 'jpeg' ? 'jpg' : type.sniff === 'png' ? 'png' : 'webp';
      const path = storedPicturePath(userId, randomUUID(), extension);
      try {
        await files.put(path, bytes, type.contentType);
      } catch (error) {
        log.error('me.picture.store_failed', { requestId: c.get('requestId'), ...errorFields(error) });
        return errorResponse('API_UNAVAILABLE', 'Your picture couldn’t be saved. Try again in a moment.');
      }
      const image = storedPictureImage(path);
      const saved = await identity.setUserImageFromUpload(userId, image).catch((error: unknown) => {
        log.error('me.picture.save_failed', { requestId: c.get('requestId'), ...errorFields(error) });
        return undefined;
      });
      if (saved === undefined) {
        // Nothing points at it: the store keeps no orphan.
        await files.remove([path]).catch(() => undefined);
        return errorResponse('API_UNAVAILABLE', 'Your picture couldn’t be saved. Try again in a moment.');
      }
      // Their older upload, if the picture before was one, goes; Google's was never in the store.
      const previous = storedPictureOf(userId, saved.previous);
      if (previous !== undefined && previous !== path) {
        await files.remove([previous]).catch((error: unknown) => {
          log.warn('me.picture.old_kept', { requestId: c.get('requestId'), ...errorFields(error) });
        });
      }
      const picture = personPicture(userId, image);
      log.info('me.picture.uploaded', { requestId: c.get('requestId'), type: type.contentType });
      return c.json({ image: picture === undefined ? undefined : myPictureHref(picture.version) });
    },
  );
}
