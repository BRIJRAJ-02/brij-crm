// The business page's picture picks (spec 0066, B4 lite), one function per kind, so the shared crop step (PhotoCrop
// and `preparePhoto(file, kind, crop)`, another lane) wires in here and nowhere else. Today a gallery photo is free in
// shape: drawn again at most 1,600 pixels on its long side as the link page's pictures are, which also leaves its
// location and other metadata behind before it is sent.
import { PICTURE_PICK_MAX_BYTES, preparePicture } from '../link-page/photo-prep.ts';

/** The largest file a pick takes before it is drawn again. */
export const PHOTO_PICK_MAX_BYTES = PICTURE_PICK_MAX_BYTES;

/** The types a pick takes. */
export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * A gallery photo, ready to upload: free in shape (no crop), at most 1,600 pixels on its long side. The crop step
 * lands here as `preparePhoto(file, 'gallery', crop)`. Rejects when the file can't be read as a picture.
 */
export async function pickGalleryPhoto(file: File): Promise<Blob> {
  return (await preparePicture(file)).picture;
}
