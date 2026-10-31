// The tab's icon inside a workspace (spec 0060): the workspace's logo when it has one, from its member route
// (`/api/brand/logo?workspace=&v=`, our own origin, its type checked again on the way out), as Slack and Linear wear
// a workspace's icon. Leaving the workspace, or a logo removed, puts the product's icons back exactly as they were.
//
// A tab's icon is square, and a logo may be a wide wordmark. Browsers differ on a picture that isn't square (some
// squash it), so a logo that isn't square is drawn again whole inside a square on a light rounded plate, the way the
// sidebar's head holds it: every letter kept, smaller, rather than the middle cropped out, and dark ink still
// readable on a dark tab strip.
import { useEffect } from 'react';

/** What the page's icon links held before a workspace's logo replaced them. */
interface Kept {
  readonly link: HTMLLinkElement;
  readonly href: string;
  readonly type: string | null;
  readonly sizes: string | null;
}

/** The icon links pointed at a logo: `point` moves them to another address for it, `restore` puts them back. */
export interface WornFavicon {
  readonly point: (href: string) => void;
  readonly restore: () => void;
}

/** Points every icon link at `src`, and answers how to point them elsewhere and how to put them back. */
export function wearFavicon(document: Pick<Document, 'querySelectorAll'>, src: string): WornFavicon {
  const kept: Kept[] = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((link) => ({
    link,
    href: link.getAttribute('href') ?? '',
    type: link.getAttribute('type'),
    sizes: link.getAttribute('sizes'),
  }));
  const point = (href: string) => {
    for (const { link } of kept) {
      link.removeAttribute('type');
      link.setAttribute('sizes', 'any');
      link.setAttribute('href', href);
    }
  };
  point(src);
  return {
    point,
    restore: () => {
      for (const { link, href, type, sizes } of kept) {
        link.setAttribute('href', href);
        if (type === null) link.removeAttribute('type');
        else link.setAttribute('type', type);
        if (sizes === null) link.removeAttribute('sizes');
        else link.setAttribute('sizes', sizes);
      }
    },
  };
}

/** Where a `width` by `height` picture sits, whole and centred, inside a `side` square. */
export function containBox(
  width: number,
  height: number,
  side: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const scale = side / Math.max(width, height, 1);
  const [w, h] = [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
  return { x: Math.round((side - w) / 2), y: Math.round((side - h) / 2), width: w, height: h };
}

/** The square a tab's icon is drawn in: sharp on a 2x screen's 32px tab icon, with room to spare. */
const ICON_SIDE = 64;

/** The plate's margin round the logo and its corner, in the icon's own pixels. */
const ICON_PAD = 4;
const ICON_CORNER = 12;

/** The plate's colour when the page has no tokens to read (a canvas takes no `var()`): `on-accent`'s near white. */
const PLATE_FALLBACK = '#fcfdff';

/** The plate: the same token the sidebar's head draws a logo's plate with, read off the page. */
function plateColour(): string {
  const token = getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim();
  return token === '' ? PLATE_FALLBACK : token;
}

/** What the tab's icon becomes: the route's own address (a square logo), a squared copy, or nothing (it failed). */
type Icon =
  { readonly kind: 'route' } | { readonly kind: 'squared'; readonly href: string } | { readonly kind: 'failed' };

/**
 * The logo at `src` made ready for the tab: decoded first, so the tab never shows a squashed or broken picture on
 * the way. A square one is worn from its route; one that isn't is drawn whole inside a square on the plate.
 */
async function iconFor(src: string): Promise<Icon> {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width === 0 || height === 0) return { kind: 'failed' };
    if (width === height) return { kind: 'route' };
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIDE;
    canvas.height = ICON_SIDE;
    const context = canvas.getContext('2d');
    // No canvas here: the route's picture is still better than none, squashed or not.
    if (context === null) return { kind: 'route' };
    context.fillStyle = plateColour();
    context.beginPath();
    context.roundRect(0, 0, ICON_SIDE, ICON_SIDE, ICON_CORNER);
    context.fill();
    const box = containBox(width, height, ICON_SIDE - 2 * ICON_PAD);
    context.drawImage(image, box.x + ICON_PAD, box.y + ICON_PAD, box.width, box.height);
    return { kind: 'squared', href: canvas.toDataURL('image/png') };
  } catch {
    // Gone (removed in another tab), refused or not a picture: the product's icons stay.
    return { kind: 'failed' };
  }
}

/** The workspace's logo as the tab's icon while `src` is set; the product's icons otherwise. */
export function useWorkspaceFavicon(src: string | undefined): void {
  useEffect(() => {
    if (src === undefined) return undefined;
    let isCurrent = true;
    let worn: WornFavicon | undefined;
    void iconFor(src).then((icon) => {
      if (!isCurrent || icon.kind === 'failed') return;
      worn = wearFavicon(document, icon.kind === 'squared' ? icon.href : src);
    });
    return () => {
      isCurrent = false;
      worn?.restore();
    };
  }, [src]);
}
