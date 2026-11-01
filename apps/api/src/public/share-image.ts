// A link page's own share image (spec 0055, AC-5511): the picture its owner set, answered from our own origin so a
// pasted link previews with it instead of the card we draw. Nothing is fetched here — the bytes are ours, kept in
// one column and read through `crm_profile_share_image` — so this file is only the answer's shape.
//
// The headers are the same ones every image we serve gets (`pictureResponse`), with five minutes of cache: the path
// is versioned by the bytes, so a new picture is a new path, and the five minutes bound how long one outlives its
// owner's change of mind where the Private switch's purge of the edge (spec 0058, AC-23) can't reach.
import { pictureResponse } from './picture.ts';

/**
 * How long a share image is kept, in the browser, at the edge and in whatever cache a chat app keeps: five minutes,
 * as a public picture is, since a page made Private must stop showing it promptly.
 */
export const SHARE_IMAGE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

/**
 * A share image as our answer. The type is the one the column holds, which the write checked against the bytes'
 * own signature, so nothing is ever answered as a type it does not begin as.
 */
export function shareImageResponse(picture: { readonly type: string; readonly bytes: Uint8Array }): Response {
  const type = picture.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return pictureResponse({ type, bytes: picture.bytes }, SHARE_IMAGE_CACHE_CONTROL);
}
