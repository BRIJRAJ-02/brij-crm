// The links an email may carry. Every link is either on the app's own origin
// (an app path joined to it) or the "Powered by Timefix" link, built here
// from fixed words only, so no email can link anywhere else and no link
// carries a workspace, a person or an id.

/** The marketing site the footer's logo links to. */
export const TIMEFIX_SITE = 'https://timefix.ai';

/**
 * Every footer link's `utm_medium`, one per family of email: a closed list,
 * so nothing but these words (never a workspace or a person) can ride in it.
 */
export const EMAIL_MEDIUMS = [
  'email_sign_in',
  'email_sign_in_alert',
  'email_invite',
  'email_form_notice',
  'email_form_confirmation',
  'email_calendar_alert',
  'email_booking',
  'email_reminder',
  'email_import',
  'email_mention',
] as const;
/** A footer link's `utm_medium`. */
export type EmailMedium = (typeof EMAIL_MEDIUMS)[number];

/**
 * "Powered by Timefix": timefix.ai tagged `utm_source=timefix`,
 * `utm_medium=email_<kind>`, `utm_campaign=powered_by` and
 * `utm_content=footer_logo`, the same scheme as the guest pages' footer.
 * Nothing else goes in: no workspace, person or id.
 *
 * TODO(brandlinks): swap for the shared builder (`poweredByUrl` in
 * `@crm/contracts/brand`, wip/brandlinks, or the booking pages' `poweredByHref`
 * once it moves to a shared package) when it lands on landing2, keeping the
 * email surfaces and leaving out its workspace `ref`.
 */
export function poweredByUrl(medium: EmailMedium): string {
  if (!(EMAIL_MEDIUMS as readonly string[]).includes(medium)) throw new Error('That isn’t an email medium.');
  const url = new URL(TIMEFIX_SITE);
  url.searchParams.set('utm_source', 'timefix');
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', 'powered_by');
  url.searchParams.set('utm_content', 'footer_logo');
  return url.toString();
}

/** A path inside the app: one leading slash, never `//` or a backslash. */
const APP_PATH = /^\/(?![/\\])[^\s\\]*$/;

/** A `.` or `..` segment, plain or percent encoded: resolved after the check, it could turn a path into `//host`. */
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:[/?#]|$)/i;

/** The hosts an app origin may use plain http on: a laptop's. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The app's origin as links use it: https, or plain http on a laptop's own
 * host only, so a deployed email never links over plain http. Anything else
 * throws.
 */
export function appOrigin(origin: string): string {
  const url = new URL(origin);
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('The app origin must be https (or http on localhost).');
  return url.origin;
}

/**
 * An app path joined to the app's origin (`https://app.example.com` and
 * `/w/acme/bookings` make `https://app.example.com/w/acme/bookings`). A path
 * that could leave the origin or start with `//` once resolved throws.
 */
export function appUrl(origin: string, path: string): string {
  if (!APP_PATH.test(path) || DOT_SEGMENT.test(path)) throw new Error('An email link must be a path inside the app.');
  const base = appOrigin(origin);
  const joined = new URL(path, base);
  if (joined.origin !== base || joined.pathname.startsWith('//')) {
    throw new Error('An email link must stay on the app origin.');
  }
  return joined.href;
}

/**
 * A link as an email writes it: parsed, and only when it is on the app's
 * origin, so a button, a row or the preferences link can never point at
 * another site, whatever a template passes. Answers the parsed address.
 */
export function onAppOrigin(link: string, origin: string): string {
  const base = appOrigin(origin);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('An email link must be an address on the app origin.');
  }
  if (url.origin !== base || url.username !== '' || url.password !== '' || url.pathname.startsWith('//')) {
    throw new Error('An email link must be an address on the app origin.');
  }
  return url.href;
}

/** The footer logo's files on the app's origin: muted ink for the light theme, and for the dark one. */
export function wordmarkUrls(origin: string): { readonly light: string; readonly dark: string } {
  return {
    light: appUrl(origin, '/brand/email/timefix-wordmark-light.png'),
    dark: appUrl(origin, '/brand/email/timefix-wordmark-dark.png'),
  };
}
