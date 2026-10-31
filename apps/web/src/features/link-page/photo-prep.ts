// A brand logo, a cover or a photo ground made ready to send (spec 0060, AC-2, AC-13): drawn again in the browser,
// which leaves a photo's location and camera behind, a cover cropped to 3:1 from its middle, and each one sized
// down so it stays well under the 4 MB the server takes. The server checks the type and the first bytes and strips
// the metadata again; this is for the honest file, not against a hostile one. `apps/web` may not import the
// contracts, so the numbers the server holds to are repeated here and kept equal by hand.

/** The types a person may pick: what the server takes. SVG is refused (it runs scripts). */
export const BRAND_PHOTO_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The largest file a person may pick, before it is drawn again: a phone's photo is a few megabytes. */
export const BRAND_PHOTO_PICK_MAX_BYTES = 20_000_000;

/** What each picture is for, and how it is drawn again. */
export type BrandPhotoKind = 'logo' | 'cover' | 'ground';

/** Each kind's longest side, its shape, and its file type: a logo keeps its transparency as PNG. */
const SHAPES = {
  logo: { side: 1200, ratio: undefined, type: 'image/png' },
  cover: { side: 1800, ratio: 3, type: 'image/jpeg' },
  ground: { side: 2400, ratio: undefined, type: 'image/jpeg' },
} as const satisfies Record<
  BrandPhotoKind,
  { readonly side: number; readonly ratio: number | undefined; readonly type: string }
>;

/** How sharp a JPEG is: high enough that a photo stays a photo, low enough that it stays small. */
const QUALITY = 0.86;

/**
 * `file` drawn again for its kind, turned the way the photo says it should be (`createImageBitmap` reads its
 * orientation). Rejects when the browser can't read it as a picture.
 */
export async function preparePhoto(file: Blob, kind: BrandPhotoKind): Promise<Blob> {
  const shape = SHAPES[kind];
  const bitmap = await createImageBitmap(file);
  try {
    // The part of the picture kept: all of it, or the middle band of a cover at 3:1.
    let [sx, sy, sw, sh] = [0, 0, bitmap.width, bitmap.height];
    if (shape.ratio !== undefined) {
      if (sw / sh > shape.ratio) {
        sw = Math.round(sh * shape.ratio);
        sx = Math.round((bitmap.width - sw) / 2);
      } else {
        sh = Math.round(sw / shape.ratio);
        sy = Math.round((bitmap.height - sh) / 2);
      }
    }
    const scale = Math.min(1, shape.side / Math.max(sw, sh));
    const [width, height] = [Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale))];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This browser can’t draw the picture.');
    // A JPEG has no transparency to keep, so a transparent PNG photo goes on white; a logo keeps its own.
    if (shape.type === 'image/jpeg') {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob === null) reject(new Error('This browser can’t draw the picture.'));
          else resolve(blob);
        },
        shape.type,
        QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** The largest picture a block may be picked from (spec 0061, AC-6108): `PROFILE_IMAGE_PICK_MAX_BYTES`. */
export const PICTURE_PICK_MAX_BYTES = 10 * 1024 * 1024;

/** The longest side a block's picture is made before upload (AC-6108): `PROFILE_IMAGE_EDGE`. */
const PICTURE_EDGE = 1600;

/** The most a stored picture may weigh (AC-6108): `PROFILE_IMAGE_MAX_BYTES`. */
const PICTURE_MAX_BYTES = 1_572_864;

/**
 * A block's picture made ready to send (spec 0061, AC-6101, AC-6108): drawn again at most 1,600 pixels on its long
 * side, which leaves a photo's location and camera behind, as a JPEG a step softer each time it is still over
 * 1.5 MB. Answers the picture and its size, so the editor holds its box before the server answers. Rejects when
 * the browser can't read it as a picture.
 */
export async function preparePicture(
  file: Blob,
): Promise<{ readonly picture: Blob; readonly width: number; readonly height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PICTURE_EDGE / Math.max(bitmap.width, bitmap.height));
    const [width, height] = [
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    ];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This browser can’t draw the picture.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [QUALITY, 0.76, 0.64]) {
      const picture = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob === null) reject(new Error('This browser can’t draw the picture.'));
            else resolve(blob);
          },
          'image/jpeg',
          quality,
        );
      });
      if (picture.size <= PICTURE_MAX_BYTES) return { picture, width, height };
    }
    throw new Error('That picture is too big.');
  } finally {
    bitmap.close();
  }
}
