// A picture the person chose, made ready to send (27 Oct 2026): the middle square of it, drawn again at
// `PICTURE_SIDE` pixels as a JPEG. Drawing it again is the point: a phone's photo carries where it was taken and
// with what, and none of that survives a canvas, so a picture that shows on a public booking page never carries
// its owner's location. The server still checks what arrives; this is for the honest file, not against a hostile one.
import { PICTURE_SIDE } from '@crm/contracts/pictures';

/** The types a person may pick: what the server takes. */
export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** The largest file a person may pick, before it is drawn again: a phone's photo is a few megabytes. */
export const PHOTO_PICK_MAX_BYTES = 20 * 1024 * 1024;

/** How sharp the JPEG is: high enough that a face stays a face, low enough that it stays small. */
const QUALITY = 0.88;

/**
 * The middle square of `file`, drawn again at `PICTURE_SIDE` pixels as a JPEG, turned the way the photo says it
 * should be (`createImageBitmap` reads its orientation). Rejects when the browser can't read it as a picture.
 */
export async function squarePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(PICTURE_SIDE, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This browser can’t draw the picture.');
    // A transparent PNG goes on white, as a JPEG has no transparency to keep.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, out, out);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob === null) reject(new Error('This browser can’t draw the picture.'));
          else resolve(blob);
        },
        'image/jpeg',
        QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
