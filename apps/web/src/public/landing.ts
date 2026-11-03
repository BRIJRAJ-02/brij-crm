// The landing address's parameters a public page's visit count carries (spec 0067, AC-6703): the UTM tags, each
// cut to 100 characters, and whether a Google or Meta click id was there (never the id). Without the contracts'
// Zod, so the public pages stay small; the server parses it again and keeps only what it allows.

/** The landing parameters, as the beacons send them. */
export interface LandingParams {
  readonly utm_source?: string;
  readonly utm_medium?: string;
  readonly utm_campaign?: string;
  readonly utm_term?: true;
  readonly utm_content?: true;
  readonly gclid?: true;
  readonly fbclid?: true;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
/** Kept only as being there: a term or content tag may carry an address, and a click id identifies a click. */
const PRESENCE_KEYS = ['utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

/** The landing parameters of `address`, or undefined when it carries none. */
export function landingOf(address: string): LandingParams | undefined {
  let params: URLSearchParams;
  try {
    params = new URL(address).searchParams;
  } catch {
    return undefined;
  }
  const landing: Record<string, string | true> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value !== undefined && value !== '') landing[key] = value.slice(0, 100);
  }
  for (const key of PRESENCE_KEYS) if ((params.get(key) ?? '') !== '') landing[key] = true;
  return Object.keys(landing).length === 0 ? undefined : landing;
}
