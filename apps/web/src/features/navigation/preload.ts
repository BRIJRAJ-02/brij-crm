// Intent preloading for every way into a page, not only the router's own Link. The sidebar, ButtonLinks and
// breadcrumbs are React Aria links (`a[href]`, navigated through UiProvider), and tabs and list rows navigate on
// selection, carrying where they go as `data-href`; none of them reached the router's `defaultPreload: 'intent'`,
// so a page's code and data only started loading on the click. This listens on the document instead: a pointer
// resting on one for `delayMs`, a keyboard focus or a touch preloads its page (the route's chunk and its loader,
// which primes the data layer), so the click usually finds both ready.

/** How long a pointer rests on a link before its page preloads: the router's own default for its Link. */
export const PRELOAD_DELAY_MS = 50;

/** The attribute a non link element (a tab, a list row) names its destination with. */
export const PRELOAD_ATTRIBUTE = 'data-href';

/** What a preload target looks like: anything `closest` can be asked of. */
interface Closest {
  readonly closest: (selector: string) => {
    readonly getAttribute: (name: string) => string | null;
  } | null;
}

/**
 * The in app address an event's target leads to, when it is a link or names one with `data-href`: same origin,
 * not the API, not a new tab or a download. Undefined for anything else.
 */
export function intentHref(target: unknown, origin: string): string | undefined {
  if (typeof target !== 'object' || target === null || !('closest' in target)) return undefined;
  const element = (target as Closest).closest(`a[href], [${PRELOAD_ATTRIBUTE}]`);
  if (element === null) return undefined;
  if (element.getAttribute('target') === '_blank' || element.getAttribute('download') !== null) return undefined;
  const raw = element.getAttribute(PRELOAD_ATTRIBUTE) ?? element.getAttribute('href');
  if (raw === null || raw === '' || raw.startsWith('#')) return undefined;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What the preloader needs from the browser and the router. */
export interface IntentPreloadHost {
  /** Where the events are listened for (the document). */
  readonly target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** The app's origin; links elsewhere are left alone. */
  readonly origin: string;
  /** Preloads a page by its address (`router.preloadRoute({ href })`). */
  readonly preload: (href: string) => void;
  /** How long a pointer rests on a link before it counts as intent (the router's own default is 50 ms). */
  readonly delayMs: number;
  readonly setTimer: (run: () => void, ms: number) => number;
  readonly clearTimer: (timer: number) => void;
}

/**
 * Starts preloading pages on intent: a pointer resting on a link (or a `data-href` element) for `delayMs`, at once
 * on keyboard focus or a touch. Leaving it before the delay cancels it. Answers a function that stops listening.
 */
export function startIntentPreload({ target, origin, preload, delayMs, setTimer, clearTimer }: IntentPreloadHost) {
  let waiting: { readonly href: string; readonly timer: number } | undefined;
  const cancel = () => {
    if (waiting !== undefined) clearTimer(waiting.timer);
    waiting = undefined;
  };
  const onOver = (event: Event) => {
    const href = intentHref(event.target, origin);
    if (href === waiting?.href) return;
    cancel();
    if (href === undefined) return;
    waiting = {
      href,
      timer: setTimer(() => {
        waiting = undefined;
        preload(href);
      }, delayMs),
    };
  };
  const onOut = (event: Event) => {
    // Moving within the same link keeps it; leaving for anything else cancels.
    const related = (event as Event & { readonly relatedTarget?: unknown }).relatedTarget;
    if (waiting !== undefined && intentHref(related, origin) === waiting.href) return;
    cancel();
  };
  const now = (event: Event) => {
    const href = intentHref(event.target, origin);
    if (href === undefined) return;
    cancel();
    preload(href);
  };
  const listeners: readonly (readonly [string, (event: Event) => void, AddEventListenerOptions])[] = [
    ['pointerover', onOver, { passive: true }],
    ['pointerout', onOut, { passive: true }],
    ['focusin', now, { passive: true }],
    ['touchstart', now, { passive: true }],
  ];
  for (const [type, listener, options] of listeners) target.addEventListener(type, listener, options);
  return () => {
    cancel();
    for (const [type, listener, options] of listeners) target.removeEventListener(type, listener, options);
  };
}
