// The one place a picture is made ready to send (spec 0068, AC-6809; before it spec 0060 AC-2 and AC-13, spec 0061
// AC-6108, first run's avatar of 27 Oct 2026): the part the person kept in the cropper (or, with no crop, the
// kind's own middle), drawn again in the browser, which leaves a photo's location and camera behind, sized down
// for its kind and written as the kind's file type. The server still checks the type and the first bytes and strips
// the metadata again; this is for the honest file, not against a hostile one. The original is never kept.
import { PICTURE_SIDE } from '@crm/contracts/pictures';
import { centreCrop, clampRect, outputSize, type PhotoRect, type PhotoSize } from './crop-math.ts';

/**
 * What a picture is for, which says its size, shape and file type: `avatar` a person's photo (square), `logo` a
 * workspace's logo (its own shape, PNG so it keeps its transparency), `cover` a page's 3:1 banner, `ground` a link
 * page's photo background, `picture` a link page block's or gallery's picture, `share` the picture a pasted link
 * shows (1.91:1), and `dish` a menu dish (4:3 unless cropped square).
 */
export type PhotoKind = 'avatar' | 'logo' | 'cover' | 'ground' | 'picture' | 'share' | 'dish';

/** One kind's rules: its longest side, the shape it keeps when nobody cropped, its type, and the most it may weigh. */
export interface PhotoKindRule {
  readonly side: number;
  readonly ratio: number | undefined;
  readonly type: 'image/png' | 'image/jpeg';
  /** Past this, a JPEG is written a step softer, then refused. Undefined: whatever one pass makes. */
  readonly maxBytes: number | undefined;
}

/**
 * Every kind's rules. The numbers the server holds to are repeated here and kept equal by hand where `apps/web`
 * reads them back (`PICTURE_SIDE` comes from the contracts, which this package may read).
 */
export const PHOTO_KINDS: Readonly<Record<PhotoKind, PhotoKindRule>> = {
  avatar: { side: PICTURE_SIDE, ratio: 1, type: 'image/jpeg', maxBytes: undefined },
  logo: { side: 1200, ratio: undefined, type: 'image/png', maxBytes: undefined },
  cover: { side: 1800, ratio: 3, type: 'image/jpeg', maxBytes: undefined },
  ground: { side: 2400, ratio: undefined, type: 'image/jpeg', maxBytes: undefined },
  picture: { side: 1600, ratio: undefined, type: 'image/jpeg', maxBytes: 1_572_864 },
  share: { side: 1200, ratio: 1200 / 630, type: 'image/jpeg', maxBytes: 500_000 },
  dish: { side: 1600, ratio: 4 / 3, type: 'image/jpeg', maxBytes: 1_572_864 },
};

/** How sharp a JPEG is: high enough that a photo stays a photo, then a step softer each time it is still too heavy. */
const QUALITIES: readonly number[] = [0.86, 0.76, 0.64];

/** What the browser says when it can't read or draw the picture. */
const UNREADABLE = 'This browser can’t draw the picture.';

/** What `preparePhoto` draws: the part of the photo kept, and the pixels it is drawn at. */
export interface PhotoPlan {
  readonly source: PhotoRect;
  readonly width: number;
  readonly height: number;
}

/**
 * The plan for one picture, pure: `crop` held inside the photo (or the kind's own middle when there is none), and
 * the size it is drawn at, never larger than the kind's side and never grown.
 */
export function planPhoto(size: PhotoSize, kind: PhotoKind, crop?: PhotoRect): PhotoPlan {
  const rule = PHOTO_KINDS[kind];
  const source = clampRect(size, crop ?? centreCrop(size, rule.ratio));
  return { source, ...outputSize(source, rule.side) };
}

/** A finished picture: the file to send, and its size, so a screen holds its box before the server answers. */
export interface PreparedPhoto {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/**
 * The picture as the browser draws it, turned the way the photo says it should be (`imageOrientation`): a file
 * read straight, or an address on our own origin (a photo already there, cropped again) through an image element.
 */
async function decode(source: Blob | string): Promise<ImageBitmap> {
  if (typeof source !== 'string') return createImageBitmap(source, { imageOrientation: 'from-image' });
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  await image.decode();
  return createImageBitmap(image);
}

/** `canvas` written as `type`. */
function written(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error(UNREADABLE));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

/**
 * `source` made ready to send as `kind`: the part `crop` names (in the photo's own pixels, as `PhotoCrop` answers
 * it), else the kind's middle, drawn again at most the kind's side as its file type. A JPEG has no transparency to
 * keep, so a transparent picture goes on white; a logo keeps its own. A kind with a weight limit is written a step
 * softer until it fits, and refused ("That picture is too big.") if it never does. Rejects when the browser can't
 * read it as a picture.
 */
export async function preparePhoto(source: Blob | string, kind: PhotoKind, crop?: PhotoRect): Promise<PreparedPhoto> {
  const rule = PHOTO_KINDS[kind];
  const bitmap = await decode(source);
  try {
    const plan = planPhoto({ width: bitmap.width, height: bitmap.height }, kind, crop);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error(UNREADABLE);
    if (rule.type === 'image/jpeg') {
      // A canvas takes no tokens: plain white under a picture that had transparency, as every JPEG has.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, plan.width, plan.height);
    }
    context.imageSmoothingQuality = 'high';
    const { x, y, width, height } = plan.source;
    context.drawImage(bitmap, x, y, width, height, 0, 0, plan.width, plan.height);
    const qualities = rule.maxBytes === undefined ? QUALITIES.slice(0, 1) : QUALITIES;
    for (const quality of qualities) {
      const blob = await written(canvas, rule.type, quality);
      if (rule.maxBytes === undefined || blob.size <= rule.maxBytes) {
        return { blob, width: plan.width, height: plan.height };
      }
    }
    throw new Error('That picture is too big.');
  } finally {
    bitmap.close();
  }
}
