// The host rules of a custom domain (spec 0064, AC-6401): what an owner typed becomes one lowercase, punycode host
// with no scheme, port, path or trailing dot, or is refused in one line. Our own hosts are never anyone's custom
// domain: the brand's apexes and everything under them, the app's and the public origins' hosts, Vercel's own
// `vercel.app` and `vercel.com`, and any host a deployment names as its own. Pure, so the api, the job and the
// tests all read the same answer.
import { domainToASCII } from 'node:url';

/** The brand's own apexes (24 Oct 2026, timefix.com everywhere and timefix.ai redirecting), and Vercel's. */
export const OWN_APEXES: readonly string[] = ['timefix.com', 'timefix.ai', 'vercel.app', 'vercel.com', 'vercel.dev'];

/**
 * Two label suffixes under which a registered domain is three labels, so `janedoe.co.uk` is an apex and
 * `book.janedoe.co.uk` a subdomain. Not the whole public suffix list: an apex under a suffix missing here reads as a
 * subdomain, which only means it gets a CNAME and no `www` beside it.
 */
export const SECOND_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'org.nz',
  'co.in',
  'net.in',
  'org.in',
  'firm.in',
  'gen.in',
  'ind.in',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'net.br',
  'com.mx',
  'com.sg',
  'com.my',
  'com.hk',
  'com.tw',
  'com.cn',
  'co.za',
  'co.kr',
  'com.tr',
  'com.ar',
  'com.co',
  'com.ph',
  'co.id',
  'co.il',
  'com.pk',
  'com.ng',
  'com.eg',
  'com.sa',
  'co.th',
  'com.vn',
  'com.ua',
  'com.pl',
  'co.at',
  'or.at',
]);

/** Top level names that never reach the public internet. */
const PRIVATE_TLDS: ReadonlySet<string> = new Set(['localhost', 'local', 'internal', 'lan', 'home', 'arpa', 'invalid']);

/** Why a host was refused, each with its one line (AC-6401). */
export type HostRefusal = 'malformed' | 'ip' | 'private' | 'ours';

/** The one line each refusal shows under the field. */
export const HOST_REFUSALS: Readonly<Record<HostRefusal, string>> = {
  malformed: 'That isn’t a domain. Try one like book.yourname.com.',
  ip: 'Use a domain name, not an IP address.',
  private: 'Use a domain that works on the public internet.',
  ours: 'That domain belongs to us. Use one of your own.',
};

/** A host that passed: its normal form, whether it is an apex, and the apex it sits under. */
export interface NormalHost {
  readonly host: string;
  readonly kind: 'apex' | 'subdomain';
  readonly apex: string;
}

/** A host's normal form, or why it was refused. */
export type HostCheck =
  ({ readonly ok: true } & NormalHost) | { readonly ok: false; readonly reason: HostRefusal; readonly message: string };

const refused = (reason: HostRefusal): HostCheck => ({ ok: false, reason, message: HOST_REFUSALS[reason] });

/** One DNS label: letters, digits and inner hyphens, 1 to 63 characters (punycode's `xn--` fits). */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** An IPv4 address, dotted. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The apex a host sits under: its last two labels, or three under a two label suffix. */
export function apexOf(host: string): string {
  const labels = host.split('.');
  const two = labels.slice(-2).join('.');
  return SECOND_LEVEL_SUFFIXES.has(two) ? labels.slice(-3).join('.') : two;
}

/** Whether `host` is one of `own` or under one of them. */
function isUnder(host: string, own: readonly string[]): boolean {
  return own.some((name) => name !== '' && (host === name || host.endsWith(`.${name}`)));
}

/**
 * What the owner typed, as one host (AC-6401). A pasted address keeps only its host (`https://Book.JaneDoe.com/x`
 * is `book.janedoe.com`), Unicode becomes punycode, and a trailing dot goes. Refused: anything that isn't a host of
 * at least two labels, an IP address (v4 or v6), a name that never reaches the internet, and our own hosts: the
 * brand's and Vercel's (`OWN_APEXES`) and every host in `ownHosts` (the app's, the public origins'), each with
 * everything under it.
 */
export function normaliseHost(typed: string, ownHosts: readonly string[] = []): HostCheck {
  let text = typed.trim().toLowerCase();
  if (text === '' || text.length > 300) return refused('malformed');
  // A pasted address: keep what sits between the scheme and the first slash, question mark or hash.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  text = text.split(/[/?#]/, 1)[0] ?? '';
  if (text.includes('@')) return refused('malformed');
  if (text.startsWith('[')) return refused('ip');
  // A port goes; anything else after a colon is an IPv6 address or not a host at all.
  const colon = text.indexOf(':');
  if (colon >= 0) {
    if (!/^:\d{1,5}$/.test(text.slice(colon))) return text.split(':').length > 2 ? refused('ip') : refused('malformed');
    text = text.slice(0, colon);
  }
  text = text.replace(/\.$/, '');
  if (IPV4.test(text)) return refused('ip');
  const ascii = domainToASCII(text);
  if (ascii === '' || ascii.length > 253) return refused('malformed');
  const labels = ascii.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return refused('malformed');
  const tld = labels.at(-1) ?? '';
  if (/^\d+$/.test(tld)) return refused('ip');
  if (PRIVATE_TLDS.has(tld)) return refused('private');
  const own = [...OWN_APEXES, ...ownHosts.map((host) => host.trim().toLowerCase().replace(/\.$/, ''))];
  if (isUnder(ascii, own)) return refused('ours');
  const apex = apexOf(ascii);
  // A bare two label suffix (`co.uk`) is nobody's domain.
  if (SECOND_LEVEL_SUFFIXES.has(ascii)) return refused('malformed');
  return { ok: true, host: ascii, kind: ascii === apex ? 'apex' : 'subdomain', apex };
}

/** The `www` host beside an apex (AC-6405). */
export function wwwOf(apex: string): string {
  return `www.${apex}`;
}

/** The name of the ownership TXT record (AC-6402). */
export function ownershipName(host: string): string {
  return `_timefix.${host}`;
}

/** The value of the ownership TXT record: the token, tagged so a DNS listing says what it is. */
export function ownershipValue(token: string): string {
  return `timefix-verify=${token}`;
}
