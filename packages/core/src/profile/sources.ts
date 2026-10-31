// The four facts a counted link page view carries (spec 0061, AC-6116), and nothing else: the referring site's host,
// the `utm_source`, the country and a device class. The page sends the first two (from `document.referrer` and
// `location.search`), so both are read again here and anything outside their shape is dropped, never stored raw. The
// country comes from the edge's header and the device from the user agent at request time, which is then dropped:
// no address, no user agent and no cookie is ever kept.
import { PROFILE_DIRECT, PROFILE_REFERRER_MAX, PROFILE_SOURCE_MAX, type ProfileViewFact } from '@crm/contracts';

/** A device class (AC-6116). */
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

/** A host as the figures keep it: lowercased, `www.` and `m.` taken off, letters, digits, dots and dashes only. */
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * The referring site's host (AC-6116): the host only, at most 120 characters, `Direct` when there is none or it is
 * one of our own hosts. What the page sends may be a whole address or just a host; anything that won't read as a
 * web host (an `android-app:` referrer, an address, a word) is `Direct` too, since it names no site.
 */
export function referrerFact(sent: string | undefined, ownHosts: readonly string[]): string {
  const given = sent?.trim() ?? '';
  if (given === '' || given.length > 2048) return PROFILE_DIRECT;
  let host: string;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(given) ? given : `https://${given}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return PROFILE_DIRECT;
    host = url.hostname.toLowerCase();
  } catch {
    return PROFILE_DIRECT;
  }
  const own = ownHosts.map((each) => each.toLowerCase());
  if (own.includes(host)) return PROFILE_DIRECT;
  host = host.replace(/^(?:www|m)\./, '');
  if (own.includes(host) || host.length > PROFILE_REFERRER_MAX || !HOST.test(host)) return PROFILE_DIRECT;
  return host;
}

/** A `utm_source` as kept (AC-6116): lowercased, 1 to 60 of letters, digits, `_`, `-` and `.`, else undefined. */
export function sourceFact(sent: string | undefined): string | undefined {
  const given = sent?.trim().toLowerCase() ?? '';
  return given.length >= 1 && given.length <= PROFILE_SOURCE_MAX && /^[a-z0-9_.-]+$/.test(given) ? given : undefined;
}

/**
 * The visitor's country as the edge names it (`x-vercel-ip-country`): two capital letters, else undefined. `XX` and
 * `T1` (Tor), which name no country, are dropped too.
 */
export function countryFact(header: string | undefined): string | undefined {
  const given = header?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(given) && given !== 'XX' && given !== 'T1' ? given : undefined;
}

/**
 * A device class from a user agent (AC-6116): a tablet, a phone, or anything else as a desktop. The same rule spec
 * 0047's site visits use (`deviceOf` in the api's analytics reads this one).
 */
export function deviceFact(userAgent: string): DeviceClass {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/** The four facts of one view, each checked; a fact with nothing to say is absent. */
export type ViewFacts = Readonly<Partial<Record<ProfileViewFact, string>>>;

/** One view's facts from what the page sent and what the request carried (AC-6116). */
export function viewFacts(input: {
  readonly referrer?: string;
  readonly source?: string;
  readonly country?: string;
  readonly userAgent: string;
  readonly ownHosts: readonly string[];
}): ViewFacts {
  const source = sourceFact(input.source);
  const country = countryFact(input.country);
  return {
    referrer: referrerFact(input.referrer, input.ownHosts),
    ...(source === undefined ? {} : { source }),
    ...(country === undefined ? {} : { country }),
    device: deviceFact(input.userAgent),
  };
}
