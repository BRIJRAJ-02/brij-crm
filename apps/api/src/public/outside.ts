// The one fetch of an address somebody typed (spec 0055, AC-5520, AC-5531). Everything this product ever reads
// from a link on a person's page goes through here: the Linktree import, a site's icon, and in time anything
// else. The rule about where a request may go is `isRefusedAddress` in core, which is pure and tested as a
// table; this is the half that touches the network.
//
// Five bounds, all of them here rather than at each caller. https only, and a host name rather than a literal
// address (`isFetchableUrl`). Every address the name resolves to is checked before the connection and again
// after every redirect, so a name that points inward is refused and so is a redirect to one. At most two
// redirects. Three seconds for the whole thing, and a cap on bytes the caller sets. No cookie, no credential,
// no Referer, and a named agent string so a site we read can see who it was.
//
// What it does not do, said plainly: the addresses are resolved by us and then resolved again by `fetch` when it
// connects, so a name that answers differently between the two could still be reached (DNS rebinding). Closing
// that needs a connection pinned to the address we checked, which means our own agent. The allow list the
// import narrows to (seven link in bio hosts) is what covers it meanwhile, and anything added here that is not
// behind such a list should close it first.
import { promises as dns } from 'node:dns';
import { isFetchableUrl, isRefusedAddress } from '@crm/core/public';

/** The longest an outside read may take, its redirects included. */
export const OUTSIDE_TIMEOUT_MS = 3000;
/** The most it will read: an icon is a few kilobytes, a page of links a few hundred. */
export const OUTSIDE_MAX_BYTES = 256 * 1024;
/** The most redirects followed, each checked again before it is opened. */
export const OUTSIDE_REDIRECTS = 2;
/** Who we say we are. A site we read can recognise us, and nothing about a visitor is ever in it. */
export const OUTSIDE_AGENT = 'TimefixBot/1.0 (+https://www.timefix.com)';

/** Why nothing was read, for the log. Never the address, which came from a person. */
export type OutsideMiss = 'url' | 'address' | 'redirect' | 'status' | 'type' | 'size' | 'timeout' | 'network';

/** What came back, or why nothing did. */
export type Fetched =
  | { readonly ok: true; readonly type: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: OutsideMiss };

/** What a caller may narrow: what it will accept, and how much of it. */
export interface OutsideOptions {
  /** The media types asked for and allowed back. Anything else is a `type` miss. */
  readonly accept?: readonly string[];
  /** A smaller cap than `OUTSIDE_MAX_BYTES`. */
  readonly maxBytes?: number;
  /** A further rule the address must pass, before and after every redirect: the import's host allow list. */
  readonly allow?: (url: URL) => boolean;
}

/** Reads one outside address under every bound above. Never throws. */
export type OutsideFetch = (url: URL, options?: OutsideOptions) => Promise<Fetched>;

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const miss = (reason: OutsideMiss): Fetched => ({ ok: false, reason });

/** The media type of a `content-type` header, lowercased and without its parameters. */
function mediaType(header: string | null): string {
  return header?.split(';')[0]?.trim().toLowerCase() ?? '';
}

/** The body, or undefined once it passes `max` bytes: the rest is never read. */
async function readCapped(response: Response, max: number): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const read: { readonly done: boolean; readonly value?: unknown } = await reader.read();
    if (read.done) break;
    const value = read.value instanceof Uint8Array ? read.value : undefined;
    size += value?.byteLength ?? max + 1;
    if (value === undefined || size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

/** What a host resolves to. Injected so the rule can be tested without a resolver. */
export type Lookup = (hostname: string) => Promise<readonly string[]>;

const resolveAll: Lookup = async (hostname) => {
  const found = await dns.lookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
};

/**
 * Builds the outside fetch. `fetch` and `lookup` are the platform's unless a test passes its own.
 *
 * A host that resolves to no address at all is refused, and so is one where **any** answer is refused rather
 * than all of them: a name that round robins between a public address and 127.0.0.1 is an attack, not a
 * misconfiguration, and taking the public answer would be taking the attacker's word for which one we get.
 */
export function createOutsideFetch(
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly lookup?: Lookup;
    readonly timeoutMs?: number;
    readonly maxBytes?: number;
  } = {},
): OutsideFetch {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const lookup = options.lookup ?? resolveAll;
  const timeoutMs = options.timeoutMs ?? OUTSIDE_TIMEOUT_MS;
  const ceiling = options.maxBytes ?? OUTSIDE_MAX_BYTES;

  const reachable = async (url: URL, allow: ((url: URL) => boolean) | undefined): Promise<boolean> => {
    if (!isFetchableUrl(url)) return false;
    if (allow !== undefined && !allow(url)) return false;
    const addresses = await lookup(url.hostname).catch(() => []);
    return addresses.length > 0 && !addresses.some((address) => isRefusedAddress(address));
  };

  return async (start, wanted = {}) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const maxBytes = Math.min(wanted.maxBytes ?? ceiling, ceiling);
    const accept = wanted.accept ?? [];
    try {
      let url = start;
      for (let hop = 0; hop <= OUTSIDE_REDIRECTS; hop += 1) {
        if (!(await reachable(url, wanted.allow))) return miss(hop === 0 ? 'url' : 'redirect');
        const response = await send(url, {
          redirect: 'manual',
          signal,
          // No cookie and no credential: a plain GET of something public.
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: {
            'user-agent': OUTSIDE_AGENT,
            ...(accept.length === 0 ? {} : { accept: accept.join(',') }),
          },
        });
        if (REDIRECTS.has(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (location === null || !URL.canParse(location, url.href)) return miss('redirect');
          url = new URL(location, url);
          continue;
        }
        if (response.status !== 200) {
          await response.body?.cancel();
          return miss('status');
        }
        const type = mediaType(response.headers.get('content-type'));
        const declared = Number(response.headers.get('content-length') ?? '0');
        if ((accept.length > 0 && !accept.includes(type)) || declared > maxBytes) {
          await response.body?.cancel();
          return miss(declared > maxBytes ? 'size' : 'type');
        }
        const bytes = await readCapped(response, maxBytes);
        return bytes === undefined ? miss('size') : { ok: true, type, bytes };
      }
      return miss('redirect');
    } catch {
      return miss(signal.aborted ? 'timeout' : 'network');
    }
  };
}
