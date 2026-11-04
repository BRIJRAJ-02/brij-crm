// The business page's picture picks (spec 0066, B4 lite), one function per kind, so the shared crop step wires in here
// and nowhere else. A gallery photo is free in shape: the person crops it in `PhotoCrop` (shape `free`, spec 0068,
// AC-6809), and the part kept is drawn again at most 1,600 pixels on its long side as the link page's pictures are
// (`preparePhoto(file, 'picture', crop)`), which also leaves its location and other metadata behind before it is sent.
import { preparePhoto, type PhotoRect } from '@crm/ui/photo';
import { PICTURE_PICK_MAX_BYTES } from '../link-page/photo-prep.ts';

/** The largest file a pick takes before it is drawn again. */
export const PHOTO_PICK_MAX_BYTES = PICTURE_PICK_MAX_BYTES;

/** The types a pick takes. */
export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * A gallery photo, ready to upload: the part `crop` names of `source` (a picked file, or a photo already on our own
 * origin, cropped again), at most 1,600 pixels on its long side. Rejects when it can't be read as a picture.
 */
export async function pickGalleryPhoto(source: Blob | string, crop?: PhotoRect): Promise<Blob> {
  return (await preparePhoto(source, 'picture', crop)).blob;
}
