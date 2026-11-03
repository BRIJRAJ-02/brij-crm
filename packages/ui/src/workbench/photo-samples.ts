// Photos for the cropper's stories, drawn as SVG `data:` images (every policy here takes `data:`), so a story needs
// no file and no network. Sized like real photos, so the cropper's arithmetic runs on real numbers. Stories only.

/** An SVG as a `data:` address. */
function svg(width: number, height: number, body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`,
  )}`;
}

/** A head and shoulders against a warm wall, upright, as a phone takes a face: 900 by 1200. */
export const PORTRAIT = svg(
  900,
  1200,
  '<rect width="900" height="1200" fill="#e9d5c0"/><rect x="0" y="0" width="900" height="420" fill="#d9b99b"/>' +
    '<ellipse cx="450" cy="1180" rx="380" ry="330" fill="#3b5b8c"/><rect x="395" y="640" width="110" height="140" fill="#c58f6b"/>' +
    '<ellipse cx="450" cy="520" rx="170" ry="210" fill="#d9a07a"/><path d="M280 470q20-230 170-230t170 230q-40-110-170-110t-170 110z" fill="#3a2a20"/>' +
    '<circle cx="390" cy="520" r="14" fill="#2b2b2b"/><circle cx="510" cy="520" r="14" fill="#2b2b2b"/><path d="M400 620q50 34 100 0" stroke="#8a4b3a" stroke-width="10" fill="none"/>',
);

/** Hills under a sky with the sun on the right, landscape: 1600 by 1067, as a camera takes one. */
export const LANDSCAPE = svg(
  1600,
  1067,
  '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6aa5e8"/><stop offset="1" stop-color="#cfe3f7"/></linearGradient></defs>' +
    '<rect width="1600" height="1067" fill="url(#s)"/><circle cx="1220" cy="300" r="110" fill="#ffd166"/>' +
    '<path d="M0 760q300-220 620-60t560-40 420 60v347H0z" fill="#5b8c5a"/><path d="M0 900q400-160 820-40t780 10v197H0z" fill="#3e6b3f"/>' +
    '<rect x="300" y="700" width="40" height="120" fill="#5a3d2b"/><circle cx="320" cy="680" r="70" fill="#2f5d34"/>',
);

/** A plate seen from above on a table, square: 1200 by 1200. */
export const DISH = svg(
  1200,
  1200,
  '<rect width="1200" height="1200" fill="#8b5e3c"/><circle cx="600" cy="600" r="430" fill="#f4f1ea"/><circle cx="600" cy="600" r="330" fill="#e9e3d6"/>' +
    '<circle cx="540" cy="560" r="120" fill="#d1495b"/><circle cx="690" cy="640" r="90" fill="#edae49"/><circle cx="600" cy="720" r="70" fill="#66a182"/>',
);
