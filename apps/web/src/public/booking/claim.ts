// Where the offer on a free `/<handle>` sends the visitor (25 Oct 2026): the app's sign in page, which is also how
// a new person signs up (the server decides which an email is), carrying the handle so they do not have to type it
// again.
//
// Which origin it has to name: the public booking origin serves the public pages and nothing else
// (`apps/web/public-paths.ts`), so a relative `/sign-in` would be nothing there, and the link has to be absolute
// to the app. A deployment that serves the app and the public pages on one origin (a preview, a laptop) leaves
// `VITE_BOOKING_PUBLIC_ORIGIN` unset, and there the relative path is the right one: it stays on the host the
// visitor is already on. So the page is on the public booking origin exactly when that variable names it, and the
// app it then points at is `VITE_APP_ORIGIN`, which production need not set, since its value is the default.
import { signInPath, TIMEFIX_APP } from '@crm/contracts/brand';

/** The configured public booking origin, as an origin, or undefined when it is unset or malformed. */
function publicOrigin(configured: string | undefined): string | undefined {
  if (configured === undefined || configured === '') return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    // A malformed value reads as unset rather than breaking the link.
    return undefined;
  }
}

/** Where the two origins come from. */
export interface ClaimOrigins {
  /** The origin this page is on (`location.origin`). */
  readonly page: string;
  /** Where the public pages are served (`VITE_BOOKING_PUBLIC_ORIGIN`); unset means this one. */
  readonly booking: string | undefined;
  /** Where the app is served (`VITE_APP_ORIGIN`); unset means `TIMEFIX_APP`, so production needs no setting. */
  readonly app?: string | undefined;
}

/**
 * The sign in address for `handle`: absolute to the app when the page is on the public booking origin, else a path
 * on this same origin. `signInPath` keeps only an `https` origin, so a malformed or plain `http` app origin falls
 * back to the relative path rather than building a link to nowhere.
 */
export function claimHandlePath(handle: string, origins: ClaimOrigins): string {
  const booking = publicOrigin(origins.booking);
  const isPublicHost = booking !== undefined && booking === origins.page;
  const app = origins.app === undefined || origins.app === '' ? TIMEFIX_APP : origins.app;
  return signInPath({ handle, ...(isPublicHost ? { appOrigin: app } : {}) });
}

/** The sign in address for `handle` on this page, from the build's origins and the browser's own. */
export function claimHandleHref(handle: string): string {
  return claimHandlePath(handle, {
    page: globalThis.location.origin,
    booking: import.meta.env.VITE_BOOKING_PUBLIC_ORIGIN,
    app: import.meta.env.VITE_APP_ORIGIN,
  });
}
