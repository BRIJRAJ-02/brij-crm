// A workspace's logo (spec 0060, AC-1, AC-2, AC-23). Three routes, all under /api, for members of the workspace the
// `x-crm-workspace` header (or, for the read, the `workspace` query) names, through the same member door the RPC
// opens:
// - `POST /brand/logo`: the logo, the request body itself, its `content-type` its type. Owners and admins only
//   (`workspace.manage`, asked before a byte is read). The browser has already drawn it again (which leaves a photo's
//   location behind); this route trusts none of that. The order is `me-picture.ts`'s: a session, the door and the
//   power, a store, the per person limit, the type against the allowlist (PNG, JPEG, WebP; no SVG, which runs
//   scripts), the body to at most 4 MB, the first bytes against the type, the metadata taken out
//   (`picture-strip.ts`), and only then the private store, under `logos/<workspace id>/<random id>.<ext>`, nothing in
//   it typed by anyone. The row then points at it, and the logo it replaced is deleted.
// - `DELETE /brand/logo`: Remove logo (the app asks first, in a Modal). Owners and admins only.
// - `GET /brand/logo?workspace=&v=`: the logo as Settings › Brand shows it, any member, its current version only,
//   kept in their browser alone. Visitors get it through the booking page's or form's own route instead.
// The global Origin check refuses a write from anywhere but the app. Nothing here logs a logo or its path.
import { createHash, randomUUID } from 'node:crypto';
import {
  BRAND_IMAGE_MAX_BYTES,
  matchesContent,
  pictureTypeOf,
  UPLOAD_WORKSPACE_HEADER,
  type ErrorCode,
} from '@crm/contracts';
import { brandLogoFolder, clearBrandLogo, readBrandLogo, requireBrandEditor, saveBrandLogo } from '@crm/core';
import type { getWorkspaceBrand } from '@crm/core';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Auth, AuthSession } from './auth/auth.ts';
import { toApiError } from './errors.ts';
import type { PublicLimiter } from './limits.ts';
import { errorFields, log } from './log.ts';
import { stripPictureMetadata } from './picture-strip.ts';
import { PRIVATE_PICTURE_CACHE_CONTROL, pictureResponse, startsAs, type PictureType } from './public/picture.ts';
import type { FileStore } from './storage/blob.ts';

/** Uploads: ten an hour per person, in this process, as for their own picture. */
export const IMAGE_UPLOAD_LIMIT = { max: 10, windowMs: 3_600_000 } as const;

/** Reads of the member's copy: 60 a minute per person. */
const READ_LIMIT = { max: 60, windowMs: 60_000 } as const;

/** A scope the member door made. */
export type MemberScope = Parameters<typeof getWorkspaceBrand>[0];

/** The member door, as the RPC's `member` base opens it. */
export type EnterWorkspace = (session: AuthSession, slug: string) => Promise<MemberScope>;

/** What the routes need: sign in, the door, the private store, a limiter and the API's error answer. */
export interface ImageRouteDeps {
  readonly auth: Auth;
  readonly enter: EnterWorkspace;
  /** The private store; absent, an upload answers 503 and a stored image is missing. */
  readonly files: FileStore | undefined;
  readonly limiter: PublicLimiter;
  readonly errorResponse: (code: ErrorCode, message: string) => Response;
}

/** What the routes read off the request: as the app sets them. */
export interface ImageVariables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** An image ready to store: its cleaned bytes, checked type, extension and version. */
export interface CheckedImage {
  readonly bytes: Uint8Array;
  readonly type: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly extension: 'png' | 'jpg' | 'webp';
  /** The first 12 hex of the cleaned bytes' SHA-256: a new image is a new path. */
  readonly version: string;
}

const NOT_AN_IMAGE = 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP.';
const TOO_LARGE = 'Choose a picture smaller than 4 MB.';

/**
 * Reads and checks an uploaded image: the type against the allowlist, the size, the first bytes against the type,
 * then its metadata taken out. Answers the image, or the refusal to send.
 */
export async function checkedUpload(
  c: Context<{ Variables: ImageVariables }>,
  errorResponse: ImageRouteDeps['errorResponse'],
): Promise<CheckedImage | Response> {
  const type = pictureTypeOf(c.req.header('content-type') ?? '');
  if (type === undefined) return errorResponse('INPUT_INVALID', 'Choose a JPEG, PNG or WebP picture.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) return errorResponse('INPUT_INVALID', 'Choose a picture.');
  if (bytes.byteLength > BRAND_IMAGE_MAX_BYTES) return errorResponse('PAYLOAD_TOO_LARGE', TOO_LARGE);
  // What it says it is, by its own first bytes: a PNG named .jpg, or a script renamed, is never kept.
  if (!matchesContent(type, bytes.subarray(0, 4096))) return errorResponse('INPUT_INVALID', NOT_AN_IMAGE);
  const clean = stripPictureMetadata(type.sniff, bytes);
  if (clean === undefined) return errorResponse('INPUT_INVALID', NOT_AN_IMAGE);
  const [contentType, extension] =
    type.sniff === 'jpeg'
      ? (['image/jpeg', 'jpg'] as const)
      : type.sniff === 'png'
        ? (['image/png', 'png'] as const)
        : (['image/webp', 'webp'] as const);
  const version = createHash('sha256').update(clean).digest('hex').slice(0, 12);
  return { bytes: clean, type: contentType, extension, version };
}

/** The body limit every image upload route puts in front of itself. */
export function imageBodyLimit(errorResponse: ImageRouteDeps['errorResponse']) {
  return bodyLimit({ maxSize: BRAND_IMAGE_MAX_BYTES, onError: () => errorResponse('PAYLOAD_TOO_LARGE', TOO_LARGE) });
}

/**
 * The scope of the signed in member of the workspace the request names, or the answer to send: no session is 401,
 * a workspace they aren't in is the door's own refusal. Refreshed session cookies are set on `c`.
 */
export async function memberScopeOf(
  c: Context<{ Variables: ImageVariables }>,
  deps: Pick<ImageRouteDeps, 'auth' | 'enter' | 'errorResponse'>,
  slug: string | undefined,
): Promise<{ readonly scope: MemberScope; readonly session: AuthSession } | Response> {
  const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
  if (session === undefined) return deps.errorResponse('UNAUTHENTICATED', 'Sign in to continue.');
  for (const cookie of session.setCookies) c.header('set-cookie', cookie, { append: true });
  if (slug === undefined || slug === '' || slug.length > 64) {
    return deps.errorResponse('NOT_FOUND', "That workspace doesn't exist, or you're not a member of it.");
  }
  try {
    return { scope: await deps.enter(session, slug), session };
  } catch (error) {
    return refusalResponse(error, deps.errorResponse);
  }
}

/** A refusal as the API's `{ code, message }` answer; anything unexpected is rethrown for the one error handler. */
export function refusalResponse(error: unknown, errorResponse: ImageRouteDeps['errorResponse']): Response {
  const mapped = toApiError(error);
  if (!mapped.expected) throw error;
  return errorResponse(mapped.error.code, mapped.error.message);
}

/** The largest stored image read back: the upload's own ceiling. */
const STORED_MAX_BYTES = BRAND_IMAGE_MAX_BYTES;

/**
 * A stored image's bytes, checked again on the way out against the type its row holds, or undefined: no store, gone,
 * too large, or not what it says. Never throws.
 */
export async function loadStoredImage(
  files: FileStore | undefined,
  path: string,
  type: string,
): Promise<{ readonly type: PictureType; readonly bytes: Uint8Array } | undefined> {
  if (files === undefined || (type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/webp')) return undefined;
  try {
    const found = await files.get(path);
    if (found === undefined || found.size > STORED_MAX_BYTES) return undefined;
    const bytes = new Uint8Array(await new Response(found.stream).arrayBuffer());
    return startsAs(type, bytes) ? { type, bytes } : undefined;
  } catch {
    return undefined;
  }
}

/** Mounts the workspace logo routes. */
export function mountBrandLogo(app: Hono<{ Variables: ImageVariables }>, deps: ImageRouteDeps): void {
  const { files, limiter, errorResponse } = deps;

  app.get('/brand/logo', async (c) => {
    const entered = await memberScopeOf(c, deps, c.req.query('workspace'));
    if (entered instanceof Response) return entered;
    const decision = limiter(`brand-logo:${entered.session.user.id}`, READ_LIMIT);
    if (!decision.allowed) return errorResponse('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    const { logo } = await readBrandLogo(entered.scope, c.req.query('v') ?? '');
    const loaded = logo === undefined ? undefined : await loadStoredImage(files, logo.path, logo.type);
    if (loaded === undefined) return errorResponse('NOT_FOUND', 'There’s no logo here.');
    return pictureResponse(loaded, PRIVATE_PICTURE_CACHE_CONTROL);
  });

  app.post('/brand/logo', imageBodyLimit(errorResponse), async (c: Context<{ Variables: ImageVariables }>) => {
    const entered = await memberScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER));
    if (entered instanceof Response) return entered;
    const { scope, session } = entered;
    // Owners and admins only, before anything is read or stored (AC-23).
    try {
      requireBrandEditor(scope);
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
    if (files === undefined) return errorResponse('API_UNAVAILABLE', 'Logos can’t be uploaded here yet.');
    const decision = limiter(`brand-logo-upload:${session.user.id}`, IMAGE_UPLOAD_LIMIT);
    if (!decision.allowed) {
      return errorResponse('RATE_LIMITED', 'You’ve changed the logo a few times just now. Try again later.');
    }
    const image = await checkedUpload(c, errorResponse);
    if (image instanceof Response) return image;
    const path = `${brandLogoFolder(scope.workspaceId)}${randomUUID()}.${image.extension}`;
    try {
      await files.put(path, image.bytes, image.type);
    } catch (error) {
      log.error('brand.logo.store_failed', { requestId: c.get('requestId'), ...errorFields(error) });
      return errorResponse('API_UNAVAILABLE', 'The logo couldn’t be saved. Try again in a moment.');
    }
    let previous: string | undefined;
    try {
      ({ previous } = await saveBrandLogo(scope, { path, type: image.type, version: image.version }));
    } catch (error) {
      // Nothing points at it: the store keeps no orphan.
      await files.remove([path]).catch(() => undefined);
      return refusalResponse(error, errorResponse);
    }
    if (previous !== undefined) {
      await files.remove([previous]).catch((error: unknown) => {
        log.warn('brand.logo.old_kept', { requestId: c.get('requestId'), ...errorFields(error) });
      });
    }
    log.info('brand.logo.uploaded', { requestId: c.get('requestId'), type: image.type });
    return c.json({ version: image.version });
  });

  app.delete('/brand/logo', async (c) => {
    const entered = await memberScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER));
    if (entered instanceof Response) return entered;
    let previous: string | undefined;
    try {
      ({ previous } = await clearBrandLogo(entered.scope));
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
    if (previous !== undefined) {
      await files?.remove([previous]).catch((error: unknown) => {
        log.warn('brand.logo.removal_kept', { requestId: c.get('requestId'), ...errorFields(error) });
      });
    }
    return c.json({ removed: previous !== undefined });
  });
}
