// A partner's Apple Wallet card in the console (13 November 2026): the picked logo drawn again in the browser at
// the three sizes Wallet asks for, so the server only ever receives finished PNGs, and a small picture of the top of
// the card, the logo on its colour, for the form's preview. A white logo on the form's own surface would be a blank
// box; on its card it is what a person will hold. Nothing is sent from here.
import { walletCardColours, walletRampAt } from '@crm/contracts/wallet-card';
import type { PartnerWalletLogoUpload } from '@crm/data';

/** The largest a pass's logo may be, in points (Apple's bound); each scale's file is that many times bigger. */
const LOGO_POINTS = { width: 160, height: 50 } as const;

/** The preview: the top of a card, at two pixels to the point. */
const PREVIEW = { width: 180, height: 84, cardHeight: 220, inset: 12, scale: 2 } as const;

/** A canvas's picture as base64, without the `data:` head. */
function base64Of(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** The size a picture is drawn at to fit a box, its shape kept, never grown. */
function fit(width: number, height: number, box: { readonly width: number; readonly height: number }) {
  const share = Math.min(1, box.width / width, box.height / height);
  return { width: Math.max(1, Math.round(width * share)), height: Math.max(1, Math.round(height * share)) };
}

/**
 * A picked logo as the three PNGs a pass carries, or undefined when the browser can't read the file. Drawn smooth,
 * so a large logo taken down to 50 points keeps its edges.
 */
export async function walletLogoFrom(file: Blob): Promise<PartnerWalletLogoUpload | undefined> {
  let picture: ImageBitmap;
  try {
    picture = await createImageBitmap(file);
  } catch {
    return undefined;
  }
  const drawn = [1, 2, 3].map((scale) => {
    const size = fit(picture.width, picture.height, {
      width: LOGO_POINTS.width * scale,
      height: LOGO_POINTS.height * scale,
    });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) return undefined;
    context.imageSmoothingQuality = 'high';
    context.drawImage(picture, 0, 0, size.width, size.height);
    return base64Of(canvas);
  });
  picture.close();
  const [x1, x2, x3] = drawn;
  if (x1 === undefined || x2 === undefined || x3 === undefined) return undefined;
  return { x1, x2, x3 };
}

/** A picture from an address on our own origin or a `data:` one, or undefined when it can't be read. */
async function loaded(src: string): Promise<HTMLImageElement | undefined> {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  try {
    await image.decode();
    return image;
  } catch {
    return undefined;
  }
}

/**
 * The top of the card as a `data:` picture: the ground drawn from `colour` by the same rule the pass uses, and the
 * logo where Wallet puts it. Undefined when the browser can't draw.
 */
export async function walletCardPreview(colour: string, logoSrc: string | undefined): Promise<string | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW.width * PREVIEW.scale;
  canvas.height = PREVIEW.height * PREVIEW.scale;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;
  const colours = walletCardColours(colour);
  const rows = PREVIEW.cardHeight * PREVIEW.scale;
  for (let y = 0; y < canvas.height; y += 1) {
    const [red, green, blue] = walletRampAt(colours, y / (rows - 1));
    context.fillStyle = `rgb(${String(Math.round(red))}, ${String(Math.round(green))}, ${String(Math.round(blue))})`;
    context.fillRect(0, y, canvas.width, 1);
  }
  const logo = logoSrc === undefined ? undefined : await loaded(logoSrc);
  if (logo !== undefined && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const size = fit(logo.naturalWidth, logo.naturalHeight, {
      width: (PREVIEW.width - PREVIEW.inset * 2) * PREVIEW.scale,
      height: LOGO_POINTS.height * 0.6 * PREVIEW.scale,
    });
    context.imageSmoothingQuality = 'high';
    context.drawImage(logo, PREVIEW.inset * PREVIEW.scale, PREVIEW.inset * PREVIEW.scale, size.width, size.height);
  }
  return canvas.toDataURL('image/png');
}
