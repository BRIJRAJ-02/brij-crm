// A webhook's secret and signature (spec 0064, AC-6420, AC-6421), in the Stripe shape receivers already handle:
// `Timefix-Signature: t=<unix seconds>,v1=<hex HMAC SHA256 of "<t>.<raw body>">`, with a second `v1` while a rotated
// secret overlaps. The secret is `whsec_` and 32 random bytes in base64url, shown once; at rest it is sealed with
// `WEBHOOK_SECRET_KEY` (AES-256-GCM, a fresh IV each time, bound to its workspace and endpoint as associated data, so
// a sealed value copied onto another endpoint never opens), the pattern of the calendar tokens' seal. The key comes in
// as an argument; nothing here reads the environment.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** The header a delivery is signed in. */
export const SIGNATURE_HEADER = 'Timefix-Signature';

/** A sealing key: 32 bytes for AES-256. Only `decodeWebhookKey` makes one. */
export type WebhookKey = Buffer & { readonly __webhookKey: true };

/**
 * `WEBHOOK_SECRET_KEY` as a key: base64 (or 64 hex characters) of exactly 32 bytes. A short key throws rather than
 * being padded.
 */
export function decodeWebhookKey(raw: string): WebhookKey {
  const text = raw.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `WEBHOOK_SECRET_KEY must decode to 32 bytes for AES-256, not ${String(bytes.length)}. Make one with: openssl rand -base64 32`,
    );
  }
  return bytes as WebhookKey;
}

/** A new signing secret: `whsec_` and 32 random bytes in base64url (AC-6420). */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** The last 4 characters, which is all the screen ever shows again. */
export function secretHint(secret: string): string {
  return secret.slice(-4);
}

/** What a sealed secret is bound to. */
export interface SecretBinding {
  readonly workspaceId: string;
  readonly endpointId: string;
}

const bindingOf = (binding: SecretBinding) =>
  Buffer.from(['webhook-secret', binding.workspaceId, binding.endpointId].join('\u0000'));

/** Seals a secret for storage. */
export function sealSecret(key: WebhookKey, secret: string, binding: SecretBinding): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(bindingOf(binding));
  const sealed = Buffer.concat([cipher.update(Buffer.from(secret, 'utf8')), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), sealed]);
}

/** Opens a sealed secret. Throws for another version, the wrong key, another endpoint, or tampering. */
export function openSecret(key: WebhookKey, stored: Uint8Array, binding: SecretBinding): string {
  const bytes = Buffer.from(stored);
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES + 1 || bytes[0] !== VERSION) {
    throw new Error('The stored webhook secret is not in a form this version can open.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 1 + IV_BYTES));
  decipher.setAAD(bindingOf(binding));
  decipher.setAuthTag(bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new Error('The stored webhook secret did not open: another key, another endpoint, or tampered with.');
  }
}

/** The hex HMAC SHA256 of `<t>.<body>` under one secret. */
export function signatureOf(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`, 'utf8')
    .digest('hex');
}

/**
 * The `Timefix-Signature` value (AC-6421): `t=<unix seconds>` then one `v1=` per secret, the current one first, so
 * during a rotation's 24 hours a receiver holding either secret verifies it (AC-6420).
 */
export function signatureHeader(secrets: readonly string[], timestamp: number, body: string): string {
  if (secrets.length === 0) throw new Error('A webhook is signed with at least one secret.');
  return [`t=${String(timestamp)}`, ...secrets.map((secret) => `v1=${signatureOf(secret, timestamp, body)}`)].join(',');
}

/**
 * What a receiver does with the header, as our documentation shows it: a `t` within `toleranceSeconds` of `now` and
 * any `v1` equal to the HMAC of `<t>.<body>` under its secret, compared in constant time.
 */
export function verifySignature(
  header: string,
  secret: string,
  body: string,
  now: number,
  toleranceSeconds = 300,
): boolean {
  const parts = header.split(',').map((part) => part.split('=', 2) as [string, string | undefined]);
  const t = Number(parts.find(([name]) => name === 't')?.[1]);
  if (!Number.isInteger(t) || Math.abs(now - t) > toleranceSeconds) return false;
  const expected = Buffer.from(signatureOf(secret, t, body), 'hex');
  return parts.some(([name, value]) => {
    if (name !== 'v1' || value === undefined || !/^[0-9a-f]{64}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value, 'hex'), expected);
  });
}
