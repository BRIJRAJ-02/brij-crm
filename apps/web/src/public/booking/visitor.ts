// The visitor's trip to Google and back (spec 0028, AC-721): what the page
// puts in the return address before Connect calendar (the length, the day and
// the zone), what it reads back on its return (those, and `?calendar=`, what
// happened), and the address it then tidies to, so a reload never says it
// again. Pure, for the page and its tests.

/** What a page chose before leaving for Google. */
export interface Chosen {
  readonly duration?: number;
  /** `yyyy-mm-dd` in `zone`. */
  readonly day?: string;
  readonly zone?: string;
}

/** What a guest connect answered. */
export type ConnectResult = 'connected' | 'denied' | 'scope' | 'off' | 'failed';

const RESULTS: readonly ConnectResult[] = ['connected', 'denied', 'scope', 'off', 'failed'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;

/**
 * The page's own address with what was chosen, for the connect leg to come back to. A form's hand off never rides
 * along (it would reach Google's sign in): the tab's session storage keeps it (prefill.ts).
 */
export function returnPath(publicKey: string, chosen: Chosen): string {
  const query = new URLSearchParams();
  if (chosen.duration !== undefined) query.set('d', String(chosen.duration));
  if (chosen.day !== undefined) query.set('day', chosen.day);
  if (chosen.zone !== undefined) query.set('tz', chosen.zone);
  const text = query.toString();
  return `/b/${encodeURIComponent(publicKey)}${text === '' ? '' : `?${text}`}`;
}

/** What an address carries back: the choices (each only when well formed) and the connect's result. */
export function readReturn(address: URL): { readonly chosen: Chosen; readonly result?: ConnectResult } {
  const params = address.searchParams;
  const duration = Number(params.get('d'));
  const day = params.get('day') ?? '';
  const zone = params.get('tz') ?? '';
  const result = RESULTS.find((each) => each === params.get('calendar'));
  return {
    chosen: {
      ...(Number.isInteger(duration) && duration > 0 ? { duration } : {}),
      ...(DAY.test(day) ? { day } : {}),
      ...(ZONE.test(zone) ? { zone } : {}),
    },
    ...(result === undefined ? {} : { result }),
  };
}

/** The address without what the return carried, so a reload starts clean; undefined when there is nothing to tidy. */
export function tidiedAddress(address: URL): string | undefined {
  const next = new URL(address.href);
  for (const key of ['d', 'day', 'tz', 'calendar', 'p']) next.searchParams.delete(key);
  if (next.href === address.href) return undefined;
  return `${next.pathname}${next.search}${next.hash}`;
}
