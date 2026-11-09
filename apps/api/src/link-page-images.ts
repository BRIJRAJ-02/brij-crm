// A link page's two photos (spec 0060, AC-10, AC-13, AC-23): the cover band and the photo ground. Two routes each,
// under /api, for the signed in person's own page in the workspace `x-crm-workspace` names, through the same member
// door the RPC opens:
// - `POST /me/link-page/cover` and `POST /me/link-page/ground`: the photo, the request body itself, with the logo's
//   checks in the logo's order (`brand-logo.ts`): the type allowlist, 4 MB, the first bytes, the metadata taken out,
//   ten an hour per person, then the private store under `profile-images/<user>/<workspace>/<random id>.<ext>`. The
//   browser has already cropped a cover to 3:1. The page then points at it, and the photo it replaced is deleted.
//   The photo the draft already has (the same version) is stored nowhere: the answer carries `same: true`.
// - `DELETE` on the same addresses: the photo goes from the page and the store.
// The owner is the page's own identity, never an input: the caller's, or (spec 0070) a member's whose page a team
// page manager edits, named by `x-crm-page-member` and let through only by the door's `enterTeamLinkPage`. Visitors read
// the photos through the handle's own routes (`public/look.ts`). The global Origin check refuses a write from
// anywhere but the app. Nothing here logs a photo or its path.
import { randomUUID } from 'node:crypto';
import { PAGE_MEMBER_HEADER, UPLOAD_WORKSPACE_HEADER, type PageImageSlot } from '@crm/contracts';
import { pageImageFolder, readProfileLook, saveProfileImage } from '@crm/core';
import type { Context, Hono } from 'hono';
import {
  checkedUpload,
  IMAGE_UPLOAD_LIMIT,
  imageBodyLimit,
  refusalResponse,
  type ImageRouteDeps,
  type ImageVariables,
} from './brand-logo.ts';
import { pageScopeOf } from './link-page-pictures.ts';
import { errorFields, log } from './log.ts';

/** Mounts the link page photo routes. */
export function mountLinkPageImages(app: Hono<{ Variables: ImageVariables }>, deps: ImageRouteDeps): void {
  const { files, limiter, errorResponse } = deps;

  for (const slot of ['cover', 'ground'] as const satisfies readonly PageImageSlot[]) {
    const path = `/me/link-page/${slot}`;

    app.post(path, imageBodyLimit(errorResponse), async (c: Context<{ Variables: ImageVariables }>) => {
      const entered = await pageScopeOf(
        c,
        deps,
        c.req.header(UPLOAD_WORKSPACE_HEADER),
        c.req.header(PAGE_MEMBER_HEADER),
      );
      if (entered instanceof Response) return entered;
      const { scope, session, owner } = entered;
      if (files === undefined) return errorResponse('API_UNAVAILABLE', 'Photos can’t be uploaded here yet.');
      const decision = limiter(`link-page-image:${session.user.id}`, IMAGE_UPLOAD_LIMIT);
      if (!decision.allowed) {
        return errorResponse('RATE_LIMITED', 'You’ve changed your photos a few times just now. Try again later.');
      }
      const image = await checkedUpload(c, errorResponse);
      if (image instanceof Response) return image;
      // The same picture in the same crop is the same bytes, so the same version (spec 0068): the draft already
      // has it, so nothing is stored and nothing changes, and the answer says so (`same`) for the editor to say.
      const current = await readProfileLook(scope).catch(() => undefined);
      if (current?.[slot] === image.version) {
        log.info('link_page.image.same', { requestId: c.get('requestId'), slot });
        return c.json({ version: image.version, same: true });
      }
      const stored = `${pageImageFolder(owner, scope.workspaceId)}${randomUUID()}.${image.extension}`;
      try {
        await files.put(stored, image.bytes, image.type);
      } catch (error) {
        log.error('link_page.image.store_failed', { requestId: c.get('requestId'), slot, ...errorFields(error) });
        return errorResponse('API_UNAVAILABLE', 'Your photo couldn’t be saved. Try again in a moment.');
      }
      let previous: string | undefined;
      try {
        ({ previous } = await saveProfileImage(scope, {
          slot,
          image: { path: stored, type: image.type, version: image.version },
        }));
      } catch (error) {
        // Nothing points at it (no page, say): the store keeps no orphan.
        await files.remove([stored]).catch(() => undefined);
        return refusalResponse(error, errorResponse);
      }
      if (previous !== undefined) {
        await files.remove([previous]).catch((error: unknown) => {
          log.warn('link_page.image.old_kept', { requestId: c.get('requestId'), slot, ...errorFields(error) });
        });
      }
      log.info('link_page.image.uploaded', { requestId: c.get('requestId'), slot, type: image.type });
      return c.json({ version: image.version });
    });

    app.delete(path, async (c) => {
      const entered = await pageScopeOf(
        c,
        deps,
        c.req.header(UPLOAD_WORKSPACE_HEADER),
        c.req.header(PAGE_MEMBER_HEADER),
      );
      if (entered instanceof Response) return entered;
      let previous: string | undefined;
      try {
        ({ previous } = await saveProfileImage(entered.scope, { slot }));
      } catch (error) {
        return refusalResponse(error, errorResponse);
      }
      if (previous !== undefined) {
        await files?.remove([previous]).catch((error: unknown) => {
          log.warn('link_page.image.removal_kept', { requestId: c.get('requestId'), slot, ...errorFields(error) });
        });
      }
      return c.json({ removed: previous !== undefined });
    });
  }
}
