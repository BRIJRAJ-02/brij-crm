// An API key's pure parts (parity #34): its shape, the hash its secret is stored as, and the hint the list shows.
// Nothing here reads the database or the network.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isUuid } from '../engine/ids.ts';

/** What every key starts with, so a leaked one is recognisable to secret scanners and to people. */
export const KEY_PREFIX = 'crm_';

const UUID_HEX = /^[0-9a-f]{32}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A uuid's 16 bytes. */
function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

/** 16 bytes as a lowercase, hyphenated uuid. */
function bytesUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A key's parts: the workspace and key it names (its public half) and its secret. */
export interface KeyParts {
  readonly workspaceId: string;
  readonly keyId: string;
  readonly secret: string;
}

/** 32 random bytes as base64url: a key's secret. */
export function newKeySecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A key's whole value: `crm_<public>_<secret>`, the public half the workspace and key ids (32 bytes, base64url, 43
 * characters), the secret 32 random bytes (43 characters). The public half lets the door open the right workspace
 * without any lookup across workspaces; it is no secret to whoever holds the key.
 */
export function keyToken(parts: KeyParts): string {
  const pub = Buffer.concat([uuidBytes(parts.workspaceId), uuidBytes(parts.keyId)]).toString('base64url');
  return `${KEY_PREFIX}${pub}_${parts.secret}`;
}

/** A key's parts, or undefined for anything that isn't one (checked before it reaches the database). */
export function parseKeyToken(token: string): KeyParts | undefined {
  if (token.length !== KEY_PREFIX.length + 43 + 1 + 43 || !token.startsWith(KEY_PREFIX)) return undefined;
  const body = token.slice(KEY_PREFIX.length);
  const pub = body.slice(0, 43);
  const secret = body.slice(44);
  if (body[43] !== '_' || !BASE64URL.test(pub) || !BASE64URL.test(secret)) return undefined;
  const bytes = Buffer.from(pub, 'base64url');
  // Only the one spelling of these bytes: base64url's spare bits in the last character would let four spell one key.
  if (bytes.length !== 32 || bytes.toString('base64url') !== pub) return undefined;
  const workspaceHex = bytes.subarray(0, 16).toString('hex');
  const keyHex = bytes.subarray(16).toString('hex');
  if (!UUID_HEX.test(workspaceHex) || !UUID_HEX.test(keyHex)) return undefined;
  const workspaceId = bytesUuid(bytes.subarray(0, 16));
  const keyId = bytesUuid(bytes.subarray(16));
  if (!isUuid(workspaceId) || !isUuid(keyId)) return undefined;
  return { workspaceId, keyId, secret };
}

/** What a key's secret is stored as: its SHA-256. A 256 bit random secret needs no slow hash. */
export function keySecretHash(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Whether `secret` is the one `stored` was made from, in constant time. */
export function keySecretMatches(secret: string, stored: Buffer): boolean {
  const hash = keySecretHash(secret);
  return stored.length === hash.length && timingSafeEqual(hash, stored);
}

/** What the list shows of a key: its secret's last four characters. */
export function keyHint(secret: string): string {
  return secret.slice(-4);
}
