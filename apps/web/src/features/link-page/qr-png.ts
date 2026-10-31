// The link page's QR as a PNG to save (spec 0051, AC-5122): the QrCode the Modal draws, its colours read off the page
// (dark modules on a light ground in either theme), drawn into a canvas at 1024 by 1024 with its quiet margin, and
// saved through a `blob:` address, which the app's policy allows. Nothing is sent anywhere.

/** How many pixels a side the saved PNG is. */
export const QR_PNG_SIZE = 1024;

/**
 * A picture already drawn on the page, as a `data:` address: an SVG loaded as an image (the PNG's canvas, a saved
 * file) reads nothing from outside itself, so a centre picture (spec 0061, AC-6124) has to travel inside it. It is
 * from our own origin, so the canvas stays readable.
 */
async function inlined(href: string): Promise<string | undefined> {
  if (href.startsWith('data:')) return href;
  const image = new Image();
  image.src = href;
  try {
    await image.decode();
  } catch {
    return undefined;
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The code's SVG with its token colours written in, at `size` pixels, as markup an image can load on its own. */
async function standalone(svg: SVGSVGElement, size: number): Promise<string> {
  const copy = svg.cloneNode(true);
  if (!(copy instanceof SVGSVGElement)) throw new Error('The QR code is not an SVG.');
  for (const picture of copy.querySelectorAll('image')) {
    const href = picture.getAttribute('href') ?? '';
    const data = href === '' ? undefined : await inlined(href);
    if (data === undefined) picture.remove();
    else picture.setAttribute('href', data);
  }
  const shapes = svg.querySelectorAll('rect, path, text');
  copy.querySelectorAll('rect, path, text').forEach((shape, index) => {
    const drawn = shapes[index];
    if (drawn !== undefined) {
      const look = getComputedStyle(drawn);
      shape.setAttribute('fill', look.fill);
      // A styled code's frame is a line, and its label words (spec 0061, AC-6124): both carry their look too.
      if (look.stroke !== 'none' && look.stroke !== '') shape.setAttribute('stroke', look.stroke);
      if (shape.tagName === 'text') {
        shape.setAttribute('font-family', look.fontFamily);
        shape.setAttribute('font-weight', look.fontWeight);
      }
    }
    shape.removeAttribute('class');
  });
  copy.removeAttribute('class');
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(size));
  copy.setAttribute('height', String(size));
  return new XMLSerializer().serializeToString(copy);
}

/** The QR code `svg` draws, as a square PNG `size` pixels a side, every module sharp. */
export async function qrPng(svg: SVGSVGElement, size = QR_PNG_SIZE): Promise<Blob> {
  const source = URL.createObjectURL(new Blob([await standalone(svg, size)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(size, size);
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This browser can’t draw the code.');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('This browser can’t save the code.'));
        else resolve(blob);
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** The QR code `svg` draws as a file of its own (spec 0061, AC-6124): its colours written in, 1024 a side. */
export async function qrSvg(svg: SVGSVGElement, size = QR_PNG_SIZE): Promise<Blob> {
  return new Blob([await standalone(svg, size)], { type: 'image/svg+xml' });
}

/** Saves `blob` as `fileName` through the browser's own download. */
export function saveFile(blob: Blob, fileName: string): void {
  const address = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = address;
  link.download = fileName;
  link.click();
  // The download has its own copy once it starts; the address goes after.
  setTimeout(() => URL.revokeObjectURL(address), 1_000);
}
