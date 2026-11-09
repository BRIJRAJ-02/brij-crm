// The business page's gallery pictures (spec 0066, B4 lite), for a member with `hospitality.manage` in the workspace
// `x-crm-workspace` (or for a read, `workspace`) names, through the same member door the RPC opens:
// - `POST /business/page/photos`: one picture, the request body itself, its `content-type` its type. The order is the
//   link page pictures' (`link-page-pictures.ts`): a session, the door, a store, the per person limit, the type
//   against the allowlist (JPEG, PNG, WebP; never SVG), the body to at most 4 MB, then `checkProfileImage` (the
//   first bytes, the sides, the metadata taken out, at most 1.5 MB kept), the row (which checks the permission and
//   the 60 kept), and only then the private store under `business-page/<workspace>/<id>.<ext>`, nothing in it typed
//   by anyone. Answers the picture's id and size; the editor then puts it in the draft.
// - `GET /business/page/photos/:id?workspace=`: the business's own copy, for the editor (drafted or published).
// Guests read published pictures through `public/business.ts`. Nothing here logs a picture or its path.
import { randomUUID } from 'node:crypto';
import {
  PROFILE_IMAGE_TYPES,
  UPLOAD_PROPERTY_HEADER,
  UPLOAD_WORKSPACE_HEADER,
  type UploadedBusinessPhoto,
} from '@crm/contracts';
import { addBusinessPhoto, checkProfileImage, readBusinessPhoto } from '@crm/core';
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

/** Pictures added: 60 an hour per person, in this process. */
const PHOTO_UPLOAD_LIMIT = { max: 60, windowMs: IMAGE_UPLOAD_LIMIT.windowMs } as const;

/** The sentence each refused picture is answered with. */
const PHOTO_REFUSALS = {
  type: 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP.',
  size: 'That picture is too big. Choose one under 1.5 MB.',
  shape: 'That picture can’t be read. Choose another, at most 4,096 pixels on a side.',
  store: 'Photos can’t be uploaded here yet.',
} as const;

/** Mounts the gallery picture routes. */
export function mountBusinessPagePhotos(app: Hono<{ Variables: ImageVariables }>, deps: ImageRouteDeps): void {
  const { files, limiter, errorResponse } = deps;

  app.post(
    '/business/page/photos',
    imageBodyLimit(errorResponse),
    async (c: Context<{ Variables: ImageVariables }>) => {
      const entered = await memberScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER));
      if (entered instanceof Response) return entered;
      const { scope, session } = entered;
      if (files === undefined) return errorResponse('API_UNAVAILABLE', PHOTO_REFUSALS.store);
      if (!limiter(`business-photo:${session.user.id}`, PHOTO_UPLOAD_LIMIT).allowed) {
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
      const id = randomUUID();
      const property = c.req.header(UPLOAD_PROPERTY_HEADER);
      let path: string;
      try {
        // The row first: it checks the permission and the limit before a byte is stored.
        ({ path } = await addBusinessPhoto(scope, {
          id,
          type: checked.type,
          bytes: checked.bytes.byteLength,
          width: checked.width,
          height: checked.height,
          // The business the picture is for (spec 0065 H7, `x-crm-property`); core refuses another workspace's.
          ...(property === undefined || property === '' ? {} : { propertyId: property }),
        }));
      } catch (error) {
        return refusalResponse(error, errorResponse);
      }
      try {
        await files.put(path, checked.bytes, checked.type);
      } catch (error) {
        log.error('business_page.photo.store_failed', { requestId: c.get('requestId'), ...errorFields(error) });
        return errorResponse('API_UNAVAILABLE', 'Your photo couldn’t be saved. Try again in a moment.');
      }
      log.info('business_page.photo.added', {
        requestId: c.get('requestId'),
        width: checked.width,
        height: checked.height,
      });
      return c.json({ id, width: checked.width, height: checked.height } satisfies UploadedBusinessPhoto);
    },
  );

  app.get('/business/page/photos/:id', async (c) => {
    const entered = await memberScopeOf(c, deps, c.req.query('workspace'));
    if (entered instanceof Response) return entered;
    let found: { readonly path: string; readonly type: string } | undefined;
    try {
      found = await readBusinessPhoto(entered.scope, { id: c.req.param('id') });
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
