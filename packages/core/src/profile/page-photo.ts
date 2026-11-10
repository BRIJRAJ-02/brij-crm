// A link page's own profile photo, for the booking pages under the same handle (owner, 10 Nov 2026: "booking pages
// under the same handle use the page photo, falling back to the account photo"). The photo a person chose for their
// page is the face of everything at that address, so their personal booking pages wear it too, once it is published
// and while the page itself is Live: a Private page's photo is its owner's alone, and a draft is nobody's yet.
import type { WorkspaceTx } from '@crm/db';
import { lookRowOf } from '../brand/look.ts';
import { publicProfilesOf } from '../booking/handles.ts';
import { PAGE_PICTURE_PREFIX, pagePictureOf, pictureVersion, type PersonPicture } from '../booking/picture.ts';

/**
 * `owner`'s published link page photo in `workspace`, as a picture to serve, or undefined: no page there, a page that
 * is Private, or one with no photo of its own. Inside the workspace's own transaction. The version is the one the
 * link page's own picture route uses (`readProfilePicture`), so the edge's copy and the browser's are shared.
 */
export async function publishedPagePhoto(
  tx: WorkspaceTx,
  owner: string,
  workspace: string,
): Promise<PersonPicture | undefined> {
  const page = (await publicProfilesOf(tx, workspace, [owner])).get(owner);
  if (page?.isShown !== true) return undefined;
  const look = await lookRowOf(tx, owner, workspace, 'published');
  const stored = typeof look?.avatar_path === 'string' ? `${PAGE_PICTURE_PREFIX}${look.avatar_path}` : undefined;
  // The same check as the handle's own route: only a path in this person's own folder for this workspace.
  const path = pagePictureOf(owner, workspace, stored);
  return path === undefined ? undefined : { kind: 'stored', path, version: pictureVersion(owner, `page:${path}`) };
}
