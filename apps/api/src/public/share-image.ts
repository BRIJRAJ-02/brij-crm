// A link page's own share image (spec 0055, AC-5511): the picture its owner set, answered from our own origin so a
// pasted link previews with it instead of the card we draw. Nothing is fetched here — the bytes are ours, kept in
// one column and read through `crm_profile_share_image` — so this file is only the answer's shape.
//
// The headers are the same ones every image we serve gets (`pictureResponse`), with a day of cache: the path is
// versioned by the bytes, so a new picture is a new path and the day only bounds how long one outlives its owner's
// change of mind.
import { pictureResponse } from './picture.ts';

/** How long a share image is kept, in the browser, at the edge and in whatever cache a chat app keeps. */
export const SHARE_IMAGE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

/**
 * A share image as our answer. The type is the one the column holds, which the write checked against the bytes'
 * own signature, so nothing is ever answered as a type it does not begin as.
 */
export function shareImageResponse(picture: { readonly type: string; readonly bytes: Uint8Array }): Response {
  const type = picture.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return pictureResponse({ type, bytes: picture.bytes }, SHARE_IMAGE_CACHE_CONTROL);
}
