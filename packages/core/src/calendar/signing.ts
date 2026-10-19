// Signed, expiring values (spec 0024): the OAuth `state` that carries a
// member through the provider's consent screen and back. Adapted from an
// earlier scheduling build's token signer: the wire format is
// `<version>.<base64url JSON payload>.<base64url HMAC-SHA256>`, the MAC covers
// `<version>.<payload>` (so a value made under one version never reads as
// another), the expiry rides inside the payload, and the MAC is compared in
// constant time. Server only, so it uses `node:crypto` rather than Web Crypto.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** What every signed payload carries: when it stops being valid, in Unix seconds. */
interface Envelope {
  readonly e: number;
}

const mac = (secret: Uint8Array, message: string) => createHmac('sha256', secret).update(message).digest();

/**
 * Signs `payload` under `version` for `maxAgeSeconds` from `now`. The secret
 * is bytes the caller derived for this one purpose (`deriveKey`).
 */
export function signValue(
  secret: Uint8Array,
  version: string,
  payload: Readonly<Record<string, unknown>>,
  maxAgeSeconds: number,
  now: Date = new Date(),
): string {
  if (!/^[a-z0-9]+$/.test(version)) throw new Error('A signed value’s version is lower case letters and digits.');
  const body = Buffer.from(
    JSON.stringify({ ...payload, e: Math.floor(now.getTime() / 1000) + maxAgeSeconds } satisfies Envelope),
  ).toString('base64url');
  return `${version}.${body}.${mac(secret, `${version}.${body}`).toString('base64url')}`;
}

/**
 * The payload of a value signed under `version` with `secret`, or undefined
 * for anything not ours, made under another version, malformed or expired.
 * Never throws: a missing value and a forged one take the same path.
 */
export function verifyValue(
  secret: Uint8Array,
  version: string,
  value: string | undefined,
  now: Date = new Date(),
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value.length > 4096) return undefined;
  const parts = value.split('.');
  if (parts.length !== 3) return undefined;
  const [given, body, signature] = parts as [string, string, string];
  if (given !== version) return undefined;
  const expected = mac(secret, `${given}.${body}`);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
    const expiry = (payload as Partial<Envelope>).e;
    if (typeof expiry !== 'number' || expiry * 1000 <= now.getTime()) return undefined;
    return payload as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

/**
 * A secret for one purpose, derived from a key held for another (HMAC of the
 * purpose's name): the OAuth state is signed with a key derived from
 * `CALENDAR_TOKEN_KEY`, so leaking one never forges the other.
 */
export function deriveKey(key: Uint8Array, purpose: string): Buffer {
  return createHmac('sha256', key).update(`crm:${purpose}`).digest();
}
