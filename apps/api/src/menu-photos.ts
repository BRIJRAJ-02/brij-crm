// A menu item's photo (spec 0065, H1, AC-6527), the logo pipeline of spec 0060 at two widths:
// - `POST /menu/items/:itemId/photo`: one multipart body with two files, `large` (1200 pixels wide) and `small`
//   (400), which the browser has already drawn again as WebP (or JPEG where the browser can't write WebP). Members of
//   the workspace the `x-crm-workspace` header names, with Manage hospitality (asked before a byte is read). The order
//   is the logo's: a session, the door and the power, a store, the per person limit, the whole body to at most 4 MB,
//   each file's type against the allowlist, its first bytes against the type, its metadata taken out, and only then
//   the private store, under `menu-photos/<workspace id>/<random id>-<size>.<ext>`, nothing in it typed by anyone.
//   The item then points at it (a draft change, AC-6525); the photo it replaced stays until Publish or Discard no
//   longer needs it. Guests get it through `GET /api/public/menu/:key/photos/...` (public/menu.ts), versioned.
// The global Origin check refuses a write from anywhere but the app. Nothing here logs a photo or its path.
import { createHash, randomUUID } from 'node:crypto';
import { MENU_LIMITS, MENU_PHOTO_WIDTHS, matchesContent, pictureTypeOf, UPLOAD_WORKSPACE_HEADER } from '@crm/contracts';
import { attachMenuPhoto, menuPhotoFolder, readMenuPhotoFile, requireMenuEditor } from '@crm/core';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  IMAGE_UPLOAD_LIMIT,
  loadStoredImage,
  memberScopeOf,
  refusalResponse,
  type ImageRouteDeps,
  type ImageVariables,
} from './brand-logo.ts';
import { errorFields, log } from './log.ts';
import { pictureSize } from './picture-size.ts';
import { stripPictureMetadata } from './picture-strip.ts';
import { PRIVATE_PICTURE_CACHE_CONTROL, pictureResponse } from './public/picture.ts';

const NOT_AN_IMAGE = 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP.';
const TOO_LARGE = 'Choose a picture smaller than 4 MB.';

/** One checked file: its cleaned bytes, type and extension. */
interface CheckedFile {
  readonly bytes: Uint8Array;
  readonly type: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly extension: 'png' | 'jpg' | 'webp';
}

/** Checks one uploaded file as the logo route checks its body: type, size, first bytes, metadata out. */
async function checkedFile(file: unknown, maxWidth: number): Promise<CheckedFile | string> {
  if (!(file instanceof Blob)) return 'Choose a picture.';
  const type = pictureTypeOf(file.type);
  if (type === undefined) return 'Choose a JPEG, PNG or WebP picture.';
  if (file.size === 0) return 'Choose a picture.';
  if (file.size > MENU_LIMITS.photoMaxBytes) return TOO_LARGE;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesContent(type, bytes.subarray(0, 4096))) return NOT_AN_IMAGE;
  // Its pixel size from its own header, before anything decodes it: never wider than the width it was drawn at, never
  // taller than four times that (a decompression bomb is a few bytes that unpack to an enormous picture).
  const size = pictureSize(bytes);
  if (size === undefined || size.width < 1 || size.height < 1 || size.width > maxWidth || size.height > maxWidth * 4) {
    return NOT_AN_IMAGE;
  }
  const clean = stripPictureMetadata(type.sniff, bytes);
  if (clean === undefined) return NOT_AN_IMAGE;
  return type.sniff === 'jpeg'
    ? { bytes: clean, type: 'image/jpeg', extension: 'jpg' }
    : type.sniff === 'png'
      ? { bytes: clean, type: 'image/png', extension: 'png' }
      : { bytes: clean, type: 'image/webp', extension: 'webp' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mounts the menu photo upload. */
export function mountMenuPhotos(app: Hono<{ Variables: ImageVariables }>, deps: ImageRouteDeps): void {
  const { files, limiter, errorResponse } = deps;

  // The editor's own copy of a draft photo (`?workspace=&v=`), any member who reads the Menus screen, kept in their
  // browser alone; guests get photos through the guest menu's route, only as a published snapshot shows them.
  app.get('/menu/photos/:photoId/:size', async (c) => {
    const entered = await memberScopeOf(c, deps, c.req.query('workspace'));
    if (entered instanceof Response) return entered;
    const size = c.req.param('size');
    const photoId = c.req.param('photoId');
    if ((size !== 'large' && size !== 'small') || !UUID.test(photoId))
      return errorResponse('NOT_FOUND', 'There’s no photo here.');
    const decision = limiter(`menu-photo-read:${entered.session.user.id}`, { max: 300, windowMs: 60_000 });
    if (!decision.allowed) return errorResponse('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    let photo: Awaited<ReturnType<typeof readMenuPhotoFile>>;
    try {
      photo = await readMenuPhotoFile(entered.scope, { photoId, size });
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
    if (photo === undefined || photo.version !== c.req.query('v'))
      return errorResponse('NOT_FOUND', 'There’s no photo here.');
    const loaded = await loadStoredImage(files, photo.path, photo.type);
    if (loaded === undefined) return errorResponse('NOT_FOUND', 'There’s no photo here.');
    return pictureResponse(loaded, PRIVATE_PICTURE_CACHE_CONTROL);
  });
  app.post(
    '/menu/items/:itemId/photo',
    // Both widths together, as drawn by the browser: well under the 4 MB a photo may come in at.
    bodyLimit({
      maxSize: MENU_LIMITS.photoMaxBytes + 64 * 1024,
      onError: () => errorResponse('PAYLOAD_TOO_LARGE', TOO_LARGE),
    }),
    async (c: Context<{ Variables: ImageVariables }>) => {
      const entered = await memberScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER));
      if (entered instanceof Response) return entered;
      const { scope, session } = entered;
      try {
        requireMenuEditor(scope);
      } catch (error) {
        return refusalResponse(error, errorResponse);
      }
      const itemId = c.req.param('itemId') ?? '';
      if (!UUID.test(itemId)) return errorResponse('NOT_FOUND', 'That dish doesn’t exist.');
      if (files === undefined) return errorResponse('API_UNAVAILABLE', 'Photos can’t be uploaded here yet.');
      const decision = limiter(`menu-photo:${session.user.id}`, { ...IMAGE_UPLOAD_LIMIT, max: 60 });
      if (!decision.allowed) return errorResponse('RATE_LIMITED', 'That’s a lot of photos at once. Try again shortly.');
      let body: Record<string, unknown>;
      try {
        body = await c.req.parseBody();
      } catch {
        return errorResponse('INPUT_INVALID', 'Choose a picture.');
      }
      const large = await checkedFile(body['large'], MENU_PHOTO_WIDTHS.large);
      if (typeof large === 'string') return errorResponse('INPUT_INVALID', large);
      const small = await checkedFile(body['small'], MENU_PHOTO_WIDTHS.small);
      if (typeof small === 'string') return errorResponse('INPUT_INVALID', small);
      // Both widths are one drawing: the same type, or it isn't what the browser made.
      if (small.type !== large.type) return errorResponse('INPUT_INVALID', NOT_AN_IMAGE);
      const version = createHash('sha256').update(large.bytes).update(small.bytes).digest('hex').slice(0, 12);
      const stem = `${menuPhotoFolder(scope.workspaceId)}${randomUUID()}`;
      const largePath = `${stem}-large.${large.extension}`;
      const smallPath = `${stem}-small.${small.extension}`;
      try {
        await files.put(largePath, large.bytes, large.type);
        await files.put(smallPath, small.bytes, small.type);
      } catch (error) {
        log.error('menu.photo.store_failed', { requestId: c.get('requestId'), ...errorFields(error) });
        await files.remove([largePath, smallPath]).catch(() => undefined);
        return errorResponse('API_UNAVAILABLE', 'The photo couldn’t be saved. Try again in a moment.');
      }
      try {
        // Like the logo, no record changes, so no change event: the editor takes the draft this answers.
        const draft = await attachMenuPhoto(scope, {
          itemId: itemId.toLowerCase(),
          photo: { largePath, smallPath, type: large.type, version },
        });
        log.info('menu.photo.uploaded', { requestId: c.get('requestId'), type: large.type });
        return c.json(draft);
      } catch (error) {
        // Nothing points at them: the store keeps no orphan.
        await files.remove([largePath, smallPath]).catch(() => undefined);
        return refusalResponse(error, errorResponse);
      }
    },
  );
}
