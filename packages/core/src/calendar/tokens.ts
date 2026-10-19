// Calendar tokens at rest (spec 0024, AC-600), adapted from an earlier
// scheduling build's encryption: AES-256-GCM, a fresh 12 byte IV for every
// seal (reusing one under a key is the one mistake that breaks GCM
// completely), and the authentication tag checked on every open, so a
// tampered row refuses to open rather than hand the provider rubbish as a
// refresh token. Two changes from that build: the key comes in as an argument
// (`CALENDAR_TOKEN_KEY`, read by the api and the worker, never here), and
// there is no plaintext pass through: a sealed value without its key is an
// error, never a token. Each seal also binds the connection it belongs to as
// associated data, so a sealed row copied onto another connection won't open.
//
// The stored form is bytes: a version byte (1), the IV, the tag, then the
// ciphertext of the tokens' JSON. The version is there so a later scheme can
// tell which one wrote a row.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CalendarTokens } from './provider.ts';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** A token key: 32 bytes for AES-256. Only `decodeTokenKey` makes one. */
export type TokenKey = Buffer & { readonly __tokenKey: true };

/**
 * `CALENDAR_TOKEN_KEY` as a key: base64 (or 64 hex characters) of exactly 32
 * bytes. A short key throws rather than being padded: a padded key is a
 * weaker cipher that looks like a working one.
 */
export function decodeTokenKey(raw: string): TokenKey {
  const text = raw.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `CALENDAR_TOKEN_KEY must decode to 32 bytes for AES-256, not ${String(bytes.length)}. Make one with: openssl rand -base64 32`,
    );
  }
  return bytes as TokenKey;
}

/**
 * What a sealed value is bound to: one member's account with one provider in
 * one workspace (the connection's unique key, which stays the same when the
 * member reconnects).
 */
export interface TokenBinding {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly provider: string;
  readonly accountEmail: string;
}

const bindingOf = (binding: TokenBinding) =>
  Buffer.from(
    ['calendar-tokens', binding.workspaceId, binding.memberId, binding.provider, binding.accountEmail].join('\u0000'),
  );

/** Seals a connection's tokens for storage. */
export function sealTokens(key: TokenKey, tokens: CalendarTokens, binding: TokenBinding): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(bindingOf(binding));
  const plain = Buffer.from(
    JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }),
  );
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), sealed]);
}

/**
 * Opens sealed tokens. Throws for another version, a malformed value, the
 * wrong key, another connection's binding, or any tampering: never a token
 * it can't vouch for. The message never quotes the value.
 */
export function openTokens(key: TokenKey, stored: Uint8Array, binding: TokenBinding): CalendarTokens {
  const bytes = Buffer.from(stored);
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES + 1 || bytes[0] !== VERSION) {
    throw new Error('The stored calendar tokens are not in a form this version can open.');
  }
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const sealed = bytes.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(bindingOf(binding));
  decipher.setAuthTag(tag);
  let plain: string;
  try {
    plain = Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('The stored calendar tokens did not open: another key, another connection, or tampered with.');
  }
  const parsed: unknown = JSON.parse(plain);
  const field = (name: string): string => {
    const value = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[name] : undefined;
    if (typeof value !== 'string') throw new Error('The stored calendar tokens opened, but are not tokens.');
    return value;
  };
  return { accessToken: field('accessToken'), refreshToken: field('refreshToken'), expiresAt: field('expiresAt') };
}
