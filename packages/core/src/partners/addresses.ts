// A partner's addresses and logo (spec 0070, AC-7010, AC-7012), pure. A redirect address is kept exactly as it will
// be compared: a connect's `redirect_uri` must equal one character for character, so only an address already in its
// one canonical spelling is taken. https only, except a loopback host over http (RFC 8252), for a partner's own
// laptop and our sample partner page.
import {
  PARTNER_LOGO_MAX_BYTES,
  PARTNER_WALLET_LOGO_MAX_BYTES,
  type PartnerLogoUpload,
  type PartnerWalletLogoUpload,
} from '@crm/contracts';
import { cleanPassLogo } from '../profile/pass-brand.ts';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a parsed address is https, or http on a loopback host. */
function isSecureOrLoopback(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
}

/** Why a redirect address can't be registered, or undefined when it can. */
export function redirectUriProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${value} isn’t a web address. Write it in full, like https://hub.example.com/timefix/callback.`;
  }
  if (!isSecureOrLoopback(url)) return `${value} must start with https://.`;
  if (url.username !== '' || url.password !== '') return `${value} can’t carry a user name or password.`;
  if (value.includes('#')) return `${value} can’t have a # part.`;
  if (url.href !== value) return `Write ${value} as ${url.href}, exactly as the app will send it.`;
  return undefined;
}

/** Why a frame origin can't be registered, or undefined when it can. */
export function frameOriginProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${value} isn’t a web address. Write the site’s origin, like https://hub.example.com.`;
  }
  if (!isSecureOrLoopback(url)) return `${value} must start with https://.`;
  if (url.origin !== value) return `Write ${value} as its origin only, like ${url.origin}.`;
  return undefined;
}

/** The first bytes each logo type starts with. */
function sniff(bytes: Buffer): PartnerLogoUpload['type'] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

/** A logo's bytes when they are what they say (a PNG, JPEG or WebP under 200 KB), or the reason they aren't. */
export function readPartnerLogo(
  upload: PartnerLogoUpload,
): { readonly bytes: Buffer; readonly type: string } | { readonly problem: string } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(upload.data)) return { problem: 'That logo couldn’t be read. Try another file.' };
  const bytes = Buffer.from(upload.data, 'base64');
  if (bytes.length === 0 || bytes.length > PARTNER_LOGO_MAX_BYTES) return { problem: 'Use a logo under 200 KB.' };
  if (sniff(bytes) !== upload.type) return { problem: 'Use a PNG, JPEG or WebP logo.' };
  return { bytes, type: upload.type };
}

/** Our own address for a partner's logo; its version in the query, so a new logo is a new address. */
export function partnerLogoPath(clientId: string, version: number): string {
  return `/api/public/partners/${clientId}/logo?v=${String(version)}`;
}

/** Our own address for a partner's Wallet logo, for the console's preview; its version in the query. */
export function partnerWalletLogoPath(clientId: string, version: number): string {
  return `/api/public/partners/${clientId}/wallet-logo?v=${String(version)}`;
}

/**
 * A Wallet logo's three files when each is what a pass can carry (a still PNG no larger than Wallet's logo at its
 * scale, under 100 KB), each with its text and anything after its end left behind, or the reason they aren't. The console's browser draws them, so a refusal here means a file that
 * did not come from the console's own form.
 */
export function readPartnerWalletLogo(
  upload: PartnerWalletLogoUpload,
): { readonly x1: Buffer; readonly x2: Buffer; readonly x3: Buffer } | { readonly problem: string } {
  const unreadable = { problem: 'That logo couldn’t be read. Try another PNG.' };
  const files: Buffer[] = [];
  for (const [data, scale] of [
    [upload.x1, 1],
    [upload.x2, 2],
    [upload.x3, 3],
  ] as const) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return unreadable;
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > PARTNER_WALLET_LOGO_MAX_BYTES) return { problem: 'Use a smaller logo.' };
    const clean = cleanPassLogo(bytes, scale);
    if (clean === undefined) return unreadable;
    files.push(Buffer.from(clean));
  }
  const [x1, x2, x3] = files;
  if (x1 === undefined || x2 === undefined || x3 === undefined) return unreadable;
  return { x1, x2, x3 };
}
