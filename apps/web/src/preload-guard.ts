// A tab opened before a deploy asks for a chunk or stylesheet the new deploy no longer has, and Vite's preload
// helper raises `vite:preloadError` (31 Oct 2026: "Unable to preload CSS for /assets/EmptyState-….css" on
// timefix.com, right after a swap). Every browser entry (the app, the booking pages, the hosted form) installs this
// guard: a clean page reloads once, onto the new deploy; a page holding unsaved work is never reloaded under the
// person, it says a new version is ready and offers Reload instead. A stamp in sessionStorage keeps the reload to one
// per window, so a deploy that is really missing a file falls through to the page's own error screen, never a loop.

/** The sessionStorage key holding when this tab last reloaded for a preload error, in ms since the epoch. */
export const PRELOAD_RELOAD_KEY = 'crm.preload-reload';

/** A second preload error this soon after a reload is not a deploy swap: it falls through to the error screen. */
export const PRELOAD_RELOAD_WINDOW_MS = 10_000;

/** The words of the toast a page with unsaved work shows instead of reloading. */
export const preloadStrings = {
  newVersion: 'A new version is ready.',
  reload: 'Reload',
} as const;

/** The storage the stamp is kept in: sessionStorage, or anything shaped like it in a test. */
export interface PreloadStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

/** What the guard needs from its page, all passed in so it holds no state of its own beyond the one listener. */
export interface PreloadGuardDeps {
  /** Where `vite:preloadError` is raised: the window. */
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** The stamp's storage. Reading it may throw (blocked site data), and so may every call on it. */
  readonly storage: () => PreloadStorage | undefined;
  readonly now: () => number;
  /** Loads the page again, onto the deploy that is live now. */
  readonly reload: () => void;
  /** True while the page holds work a reload would lose (an editor's unsaved changes, a half filled form). */
  readonly isDirty: () => boolean;
  /**
   * Says a new version is ready, with a Reload action that stays until dismissed. Without one (the hosted form,
   * which draws no toasts), a page with unsaved work is left as it is and the error takes its own way.
   */
  readonly offerReload?: () => void;
}

/** What one preload error led to: a reload, the toast offered, or nothing (the error takes its normal way). */
export type PreloadOutcome = 'reloaded' | 'offered' | 'passed';

/** The last reload's stamp, or undefined when there is none or storage can't be read. */
function lastReload(deps: PreloadGuardDeps): number | undefined {
  try {
    const raw = deps.storage()?.getItem(PRELOAD_RELOAD_KEY);
    const stamp = raw === null || raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(stamp) ? stamp : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the stamp; false when it can't be kept, since a reload with no stamp could loop. */
function stampReload(deps: PreloadGuardDeps, at: number): boolean {
  try {
    const storage = deps.storage();
    if (storage === undefined) return false;
    storage.setItem(PRELOAD_RELOAD_KEY, String(at));
    return true;
  } catch {
    return false;
  }
}

/**
 * Answers one `vite:preloadError`. Unsaved work: the toast, never a reload. Otherwise one reload per window, kept
 * by the stamp; inside the window, or with no storage to keep a stamp in, the toast if the page has one, else the
 * error goes on to the page's error screen. Cancelling the event stops Vite throwing it.
 */
export function handlePreloadError(event: Event, deps: PreloadGuardDeps): PreloadOutcome {
  const offer = (): PreloadOutcome => {
    if (deps.offerReload === undefined) return 'passed';
    event.preventDefault();
    deps.offerReload();
    return 'offered';
  };
  if (deps.isDirty()) return offer();
  const at = deps.now();
  const last = lastReload(deps);
  if (last !== undefined && at - last >= 0 && at - last < PRELOAD_RELOAD_WINDOW_MS) return 'passed';
  if (!stampReload(deps, at)) return offer();
  event.preventDefault();
  deps.reload();
  return 'reloaded';
}

/** Listens for `vite:preloadError` on the page, offering the toast at most once; answers the listener's removal. */
export function guardPreloadErrors(deps: PreloadGuardDeps): () => void {
  let hasOffered = false;
  const { offerReload } = deps;
  const once: PreloadGuardDeps =
    offerReload === undefined
      ? deps
      : {
          ...deps,
          offerReload: () => {
            if (hasOffered) return;
            hasOffered = true;
            offerReload();
          },
        };
  const listener = (event: Event) => {
    handlePreloadError(event, once);
  };
  deps.target.addEventListener('vite:preloadError', listener);
  return () => {
    deps.target.removeEventListener('vite:preloadError', listener);
  };
}

/**
 * Whether a leave guard is up: the router's `useBlocker` with `enableBeforeUnload` (LeaveGuard, imports) and the
 * notes store's unsaved guard all cancel `beforeunload`, so a synthetic one asks them all without a registry of its
 * own. A synthetic event opens no prompt.
 */
export function blocksUnload(target: Pick<Window, 'dispatchEvent'>): boolean {
  const probe = new Event('beforeunload', { cancelable: true });
  target.dispatchEvent(probe);
  return probe.defaultPrevented;
}

/** The inputs that hold nothing a visitor typed. */
const UNTYPED = new Set([
  'hidden',
  'button',
  'submit',
  'reset',
  'image',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
]);

/**
 * Whether a public page holds a half filled form: any text field a visitor can type in that isn't empty. A page's
 * own prefill counts too, which only means a toast where a reload would have done.
 */
export function hasFilledField(root: Pick<ParentNode, 'querySelectorAll'>): boolean {
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (field.disabled || field.readOnly) continue;
    if (field instanceof HTMLInputElement && UNTYPED.has(field.type)) continue;
    if (field.value.trim() !== '') return true;
  }
  return false;
}

/** The tab's sessionStorage, or undefined where reading it throws. */
export function sessionStore(win: Pick<Window, 'sessionStorage'>): PreloadStorage | undefined {
  try {
    return win.sessionStorage;
  } catch {
    return undefined;
  }
}
