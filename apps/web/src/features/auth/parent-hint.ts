// The cross host cousin of hint.ts (the owner, 25 October 2026: "if I am
// already logged in and I go to timefix.com, it should just detect and take me
// to the dashboard"). The session cookie is host only on purpose, so it exists
// on the app's own host alone and `timefix.com` cannot see it. Nothing here
// changes that. Instead this writes a second cookie on the parent domain, so
// the edge, answering on the apex, can tell that this browser had a session and
// send the person to the app instead of the marketing site.
//
// What it may say is presence and an expiry, nothing else: the value is always
// `1`, and the browser drops it after no longer than a session can last. It
// carries no identity, no token, no email and no workspace, so a browser
// handing it to any host under the parent domain gives nothing away. It is a
// hint, never proof: the app's own `me.get` is the only thing that decides
// whether someone is signed in, and a stale cookie costs one extra hop to the
// app, which then asks for a sign in as it always would.
//
// It is readable by script, since the app sets it from the page, and that costs
// nothing because it holds nothing worth stealing. It is `Secure`, so it never
// travels over plain http, and `SameSite=Lax`, so a person typing the apex into
// the address bar does send it.

/**
 * The parent domain cookie that says only that this browser had a session.
 * `apps/web/public-paths.ts` reads it at the edge, and `apps/web/middleware.ts`
 * writes the same name out (it can't import); `middleware.test.ts` keeps them equal.
 */
export const SESSION_HINT_COOKIE = 'tf_signed_in';

/** The only value the cookie ever holds: presence, with the expiry in its own attributes. */
export const SESSION_HINT_PRESENT = '1';

/** As long as the cookie may last, never longer than a session can (apps/api `expiresIn`: 30 days). */
const HINT_LASTS_SECONDS = 30 * 24 * 60 * 60;

/** A name a cookie's Domain may be: at least two labels of letters, digits and hyphens, the last not a number. */
const DOMAIN_NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * The parent domain both the app's host and the public booking host sit under,
 * or undefined when there is none to use: one host serving both (a preview and
 * local development), a host carrying a port or an address rather than a name,
 * or a page that isn't https. Undefined means no cookie is written at all,
 * which is what every environment but production wants.
 *
 * The one shape this writes on is the booking host itself, which is the apex
 * the app's host sits under (`app.timefix.com` under `timefix.com`). A pair
 * that only happens to share a parent gets nothing, so the cookie can never
 * land on a domain other deployments share, a public suffix among them
 * (`vercel.app`), whatever either setting is changed to later.
 */
export function hintCookieDomain(
  appHost: string | undefined,
  publicHost: string | undefined,
  protocol: string,
): string | undefined {
  if (protocol !== 'https:') return undefined;
  const app = (appHost ?? '').toLowerCase();
  const other = (publicHost ?? '').toLowerCase();
  if (app === other || !DOMAIN_NAME.test(app) || !DOMAIN_NAME.test(other)) return undefined;
  const lastLabel = other.slice(other.lastIndexOf('.') + 1);
  if (/^[0-9]+$/.test(lastLabel)) return undefined;
  // The app's host must be a name under the booking host, and nothing else counts: the two labels, the
  // shared parent and the app sitting below it then all follow, and no other pair writes a cookie at all.
  return app.endsWith(`.${other}`) ? other : undefined;
}

/** The booking origin's host as the build baked it in, or undefined when it has none of its own. */
export function bookingHost(bookingOrigin: string | undefined): string | undefined {
  if (bookingOrigin === undefined || bookingOrigin === '' || !URL.canParse(bookingOrigin)) return undefined;
  return new URL(bookingOrigin).host;
}

/** The cookie to write: presence with an expiry while signed in, and the same cookie expired at once while not. */
export function hintCookie(domain: string, isSignedIn: boolean): string {
  const value = isSignedIn ? `${SESSION_HINT_PRESENT}; Max-Age=${String(HINT_LASTS_SECONDS)}` : '; Max-Age=0';
  return `${SESSION_HINT_COOKIE}=${value}; Domain=${domain}; Path=/; Secure; SameSite=Lax`;
}

/** What `writeParentSessionHint` needs of the page: where it is, and a way into the cookie jar. */
export type HintPage = {
  readonly host: string;
  readonly protocol: string;
  readonly writeCookie: (cookie: string) => void;
};

/** This browser's page, for `writeParentSessionHint`. */
export function hintPage(win: Window): HintPage {
  return {
    host: win.location.host,
    protocol: win.location.protocol,
    writeCookie: (cookie) => {
      win.document.cookie = cookie;
    },
  };
}

/**
 * Says what the data layer just learned for certain, so the apex can send a
 * signed in person to the app. Writes nothing without a parent domain to write
 * it on, and never throws: a browser refusing cookies simply leaves the apex
 * on the marketing site, which is where it goes today.
 */
export function writeParentSessionHint(
  page: HintPage | undefined,
  bookingOrigin: string | undefined,
  isSignedIn: boolean,
): void {
  if (page === undefined) return;
  const domain = hintCookieDomain(page.host, bookingHost(bookingOrigin), page.protocol);
  if (domain === undefined) return;
  try {
    page.writeCookie(hintCookie(domain, isSignedIn));
  } catch {
    // Without the cookie the apex goes to the marketing site, as it did before this existed.
  }
}
