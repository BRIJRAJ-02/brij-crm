// A dish's photo drawn again in the browser (spec 0065, AC-6527): first the part the person kept in the cropper
// (`PhotoCrop`, shape `dish`; spec 0068, AC-6809) through the library's `preparePhoto(file, 'dish', crop)`, then that
// drawn at 1200 and 400 pixels wide as WebP, or JPEG where the browser can't write WebP (older Safari). Drawing again
// leaves a photo's location and camera behind; the server checks the bytes and strips metadata once more.
import { MENU_PHOTO_WIDTHS } from '@crm/data/menu';
import { preparePhoto, type PhotoRect } from '@crm/ui/photo';

/** Draws `bitmap` at most `width` wide, keeping its shape, as WebP (or JPEG). */
async function drawAt(bitmap: ImageBitmap, width: number): Promise<Blob> {
  const scale = Math.min(1, width / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No canvas to draw on.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const as = (type: string) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, 0.85);
    });
  const webp = await as('image/webp');
  if (webp !== null && webp.type === 'image/webp') return webp;
  const jpeg = await as('image/jpeg');
  if (jpeg === null) throw new Error('The photo could not be drawn.');
  return jpeg;
}

/**
 * The part `crop` names of `source` (a picked file, or a photo already on our own origin), at both widths, ready to
 * send; no crop keeps the dish's own 4:3 middle. Rejects when the browser can't read it.
 */
export async function prepareMenuPhoto(
  source: Blob | string,
  crop?: PhotoRect,
): Promise<{ readonly large: Blob; readonly small: Blob }> {
  const kept = await preparePhoto(source, 'dish', crop);
  const bitmap = await createImageBitmap(kept.blob);
  try {
    return {
      large: await drawAt(bitmap, MENU_PHOTO_WIDTHS.large),
      small: await drawAt(bitmap, MENU_PHOTO_WIDTHS.small),
    };
  } finally {
    bitmap.close();
  }
}

/** The look's cover (`PhotoCrop` shape `cover`, the page's 3:1 banner) at both widths, ready to send. */
export async function prepareMenuCover(
  source: Blob | string,
  crop?: PhotoRect,
): Promise<{ readonly large: Blob; readonly small: Blob }> {
  const kept = await preparePhoto(source, 'cover', crop);
  const bitmap = await createImageBitmap(kept.blob);
  try {
    return {
      large: await drawAt(bitmap, MENU_PHOTO_WIDTHS.large),
      small: await drawAt(bitmap, MENU_PHOTO_WIDTHS.small),
    };
  } finally {
    bitmap.close();
  }
}

/** A draft photo as the editor shows it: the member's own copy, from the api's own route, versioned. */
export const draftPhotoHref = (slug: string, photoId: string, size: 'large' | 'small', version: string): string =>
  `/api/menu/photos/${encodeURIComponent(photoId)}/${size}?${new URLSearchParams({ workspace: slug, v: version }).toString()}`;
