// Which size set the document draws with (spec 0071). Tokens are written at full
// size under :root and at the app's density under `<html data-scale="app">`. The
// app's own HTML opts in; every public page leaves the attribute off. A few
// public screens live inside the app's HTML (a partner's embed, email
// preferences, the status page, a shared insights page), so the app's boot
// script and its router keep those at full size by path.

/** The two size sets: `app` (the app's density) and `full` (public pages, emails, the artifact). */
export type Scale = 'app' | 'full';

/**
 * Paths inside the app's own HTML that are public screens, drawn at full size. theme-boot.js holds the same pattern
 * as text (it can't import), and its test fails until the two match.
 */
export const PUBLIC_APP_PATHS = /^\/(?:embed\/|email-preferences(?:\/|$)|status(?:\/|$)|public\/)/;

/** The scale an app path draws at: full size for the public screens, the app's density for everything else. */
export function scaleForPath(path: string): Scale {
  return PUBLIC_APP_PATHS.test(path) ? 'full' : 'app';
}

/** The element whose `data-scale` and hold count this module reads and writes. */
export type ScaleRoot = Pick<HTMLElement, 'dataset'>;

/** The scale the document draws with now. */
export function currentScale(root: ScaleRoot): Scale {
  return root.dataset.scale === 'app' ? 'app' : 'full';
}

/**
 * Sets the scale for a path, unless a full screen guest view is holding the page at full size
 * (`holdPublicScale`): then the path's scale is applied when the last hold lets go.
 */
export function applyScaleForPath(root: ScaleRoot, path: string): void {
  root.dataset.scalePath = scaleForPath(path);
  if (Number(root.dataset.publicHolds ?? '0') > 0) return;
  setScale(root, scaleForPath(path));
}

/**
 * Holds the whole document at full size while a full screen guest view shows (spec 0071, AC-6). Holds nest: the
 * scale comes back only when the last one lets go. Returns the release. The count lives on the element, so the
 * module keeps no state of its own.
 */
export function holdPublicScale(root: ScaleRoot): () => void {
  root.dataset.publicHolds = String(Number(root.dataset.publicHolds ?? '0') + 1);
  setScale(root, 'full');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = Math.max(0, Number(root.dataset.publicHolds ?? '1') - 1);
    if (left > 0) {
      root.dataset.publicHolds = String(left);
      return;
    }
    delete root.dataset.publicHolds;
    setScale(root, root.dataset.scalePath === 'full' ? 'full' : 'app');
  };
}

function setScale(root: ScaleRoot, scale: Scale): void {
  if (scale === 'app') root.dataset.scale = 'app';
  else delete root.dataset.scale;
}
