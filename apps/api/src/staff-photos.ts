// A staff member's photo (spec 0066 B1, AC-6611), for a member of the workspace `x-crm-workspace` (or for a read,
// `workspace`) names, through the same member door the RPC opens:
// - `POST /services/staff/:staffId/photo`: one picture, the request body itself, already cropped square and drawn
//   again by the screen (`preparePhoto(file, 'avatar', crop)`), its `content-type` its type. The order is the business
//   page photos' (`business-page-photos.ts`): a session, the door, a store, the per person limit, the type against the
//   allowlist (JPEG, PNG, WebP; never SVG), the body to at most 4 MB, `checkProfileImage` (the first bytes, the sides,
//   the metadata taken out, at most 1.5 MB kept), the private store under `staff/<workspace>/<staff>-<random>.<ext>`
//   (nothing in it typed by anyone), then the row (`setStaffPhoto`, which checks `services.manage`; refused, the new
//   file goes again), and the photo it replaced is removed. A new upload is a new path, so the photo's address changes
//   with it. Answers the photo's version.
// - `GET /services/staff/:staffId/photo?workspace=`: the profile's photo for the screens (`services.manage` or
//   `services.calendar`). Guests read it through the public booking pages (B2), not here. Nothing logs a path.
import { randomBytes } from 'node:crypto';
import { PROFILE_IMAGE_TYPES, UPLOAD_WORKSPACE_HEADER, type UploadedStaffPhoto } from '@crm/contracts';
import { checkProfileImage, readStaffPhoto, setStaffPhoto, staffPhotoFolder } from '@crm/core';
import type { Context, Hono } from 'hono';
import {
  imageBodyLimit,
  IMAGE_UPLOAD_LIMIT,
  loadStoredImage,
  memberScopeOf,
  refusalResponse,
  type ImageRouteDeps,
  type ImageVariables,
} from './brand-logo.ts';
import { errorFields, log } from './log.ts';

/** Photos added: 60 an hour per person, in this process (a salon sets up its whole team at once). */
const PHOTO_UPLOAD_LIMIT = { max: 60, windowMs: IMAGE_UPLOAD_LIMIT.windowMs } as const;

const PHOTO_REFUSALS = {
  type: 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP.',
  size: 'That picture is too big. Choose one under 1.5 MB.',
  shape: 'That picture can’t be read. Choose another, at most 4,096 pixels on a side.',
  store: 'Photos can’t be uploaded here yet.',
} as const;

const EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Mounts the staff photo routes. */
export function mountStaffPhotos(app: Hono<{ Variables: ImageVariables }>, deps: ImageRouteDeps): void {
  const { files, limiter, errorResponse } = deps;

  app.post(
    '/services/staff/:staffId/photo',
    imageBodyLimit(errorResponse),
    async (c: Context<{ Variables: ImageVariables }>) => {
      const entered = await memberScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER));
      if (entered instanceof Response) return entered;
      const { scope, session } = entered;
      if (files === undefined) return errorResponse('API_UNAVAILABLE', PHOTO_REFUSALS.store);
      if (!limiter(`staff-photo:${session.user.id}`, PHOTO_UPLOAD_LIMIT).allowed) {
        return errorResponse('RATE_LIMITED', 'You’ve added a lot of photos just now. Try again later.');
      }
      const declared = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!PROFILE_IMAGE_TYPES.some((type) => type === declared)) {
        return errorResponse('INPUT_INVALID', 'Choose a JPEG, PNG or WebP picture.');
      }
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) return errorResponse('INPUT_INVALID', 'Choose a picture.');
      const checked = checkProfileImage(bytes);
      if (!checked.ok) {
        return errorResponse(
          checked.reason === 'size' ? 'PAYLOAD_TOO_LARGE' : 'INPUT_INVALID',
          PHOTO_REFUSALS[checked.reason],
        );
      }
      const version = randomBytes(6).toString('hex');
      const staffId = c.req.param('staffId') ?? '';
      // The bytes first, then the row: a refused row takes the new file away again, and a stored row never points
      // at a file that isn't there. The path is the server's own, under the profile's folder.
      const path = `${staffPhotoFolder(scope.workspaceId, staffId.toLowerCase())}${version}.${EXTENSIONS[checked.type] ?? 'jpg'}`;
      if (!/^[0-9a-f-]{36}$/i.test(staffId)) return errorResponse('NOT_FOUND', 'That staff member doesn’t exist.');
      try {
        await files.put(path, checked.bytes, checked.type);
      } catch (error) {
        log.error('staff.photo.store_failed', { requestId: c.get('requestId'), ...errorFields(error) });
        return errorResponse('API_UNAVAILABLE', 'The photo couldn’t be saved. Try again in a moment.');
      }
      let previous: string | undefined;
      try {
        ({ previous } = await setStaffPhoto(scope, { staffId, path }));
      } catch (error) {
        await files.remove([path]).catch(() => undefined);
        return refusalResponse(error, errorResponse);
      }
      // The photo it replaced goes, so a face nobody chose any more never stays in the store.
      if (previous !== undefined) {
        await files.remove([previous]).catch((error: unknown) => {
          log.warn('staff.photo.remove_failed', { requestId: c.get('requestId'), ...errorFields(error) });
        });
      }
      log.info('staff.photo.added', { requestId: c.get('requestId'), width: checked.width, height: checked.height });
      return c.json({ photo: `${staffId}-${version}` } satisfies UploadedStaffPhoto);
    },
  );

  app.get('/services/staff/:staffId/photo', async (c) => {
    const entered = await memberScopeOf(c, deps, c.req.query('workspace'));
    if (entered instanceof Response) return entered;
    let found: { readonly path: string; readonly type: string } | undefined;
    try {
      found = await readStaffPhoto(entered.scope, { staffId: c.req.param('staffId') });
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
    const stored = found === undefined ? undefined : await loadStoredImage(files, found.path, found.type);
    if (stored === undefined) return errorResponse('NOT_FOUND', 'There’s no photo here.');
    return new Response(new Uint8Array(stored.bytes), {
      headers: {
        'content-type': stored.type,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'content-security-policy': "default-src 'none'",
      },
    });
  });
}
