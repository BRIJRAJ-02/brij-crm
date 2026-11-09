// A partner's pure parts (spec 0070, slice 2): its client id and secret, a connect's one time code, a connection's
// access token, and the PKCE check. Nothing here reads the database or the network. Secrets, codes and tokens are
// stored as their SHA-256 (`keySecretHash`, as API keys are) and compared in constant time (`keySecretMatches`).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PARTNER_CLIENT_ID } from '@crm/contracts';
import { keySecretHash, keySecretMatches, newKeySecret, pairToken, parsePairToken } from '../developer/tokens.ts';

/** What a partner's secret starts with, so a leaked one is recognisable. */
const SECRET_PREFIX = 'tfs_';
/** A connect's one time code. */
const CODE_PREFIX = 'tfc_';
/** A connection's access token. */
const TOKEN_PREFIX = 'tfa_';

const SECRET_SHAPE = /^tfs_[A-Za-z0-9_-]{43}$/;

/** A new public client id: `tfp_` and 16 random bytes as base64url. */
export function newClientId(): string {
  return `tfp_${randomBytes(16).toString('base64url')}`;
}

/** A new partner secret: `tfs_` and 32 random bytes as base64url. Shown once; only its hash is kept. */
export function newPartnerSecret(): string {
  return `${SECRET_PREFIX}${newKeySecret()}`;
}

/** Whether a string has a client id's shape (checked before any lookup). */
export function isClientId(value: string): boolean {
  return PARTNER_CLIENT_ID.test(value);
}

/** What a partner secret is stored as. */
export function partnerSecretHash(secret: string): Buffer {
  return keySecretHash(secret);
}

/** A hash no secret makes: what an unknown client id is compared against, so a miss takes as long as a wrong secret. */
const NO_PARTNER_HASH = createHash('sha256').update('no partner has this secret').digest();

/**
 * Whether `secret` is the partner's, in constant time. With no partner (`stored` undefined) it still compares, against
 * a hash no secret makes, so an unknown client id and a wrong secret take the same time and answer the same.
 */
export function partnerSecretMatches(secret: string, stored: Buffer | undefined): boolean {
  const shaped = SECRET_SHAPE.test(secret);
  const matches = keySecretMatches(shaped ? secret : '', stored ?? NO_PARTNER_HASH);
  return shaped && stored !== undefined && matches;
}

/** A secret's last four characters, so the console can tell secrets apart. */
export function partnerSecretHint(secret: string): string {
  return secret.slice(-4);
}

/** A one time code's or an access token's parts: the workspace and row its public half names, and its secret. */
export interface PartnerTokenParts {
  readonly workspaceId: string;
  readonly id: string;
  readonly secret: string;
}

/** A new code or token's secret half. */
export const newPartnerTokenSecret = newKeySecret;

/** What a code's or a token's secret half is stored as: its SHA-256. */
export function partnerTokenHash(secret: string): Buffer {
  return keySecretHash(secret);
}

/** Whether a code's or token's secret half is the one `stored` was made from, in constant time. */
export function partnerTokenMatches(secret: string, stored: Buffer): boolean {
  return keySecretMatches(secret, stored);
}

/** A connect's code: names its workspace and code row, so the exchange never looks across workspaces. */
export function partnerCode(parts: PartnerTokenParts): string {
  return pairToken(CODE_PREFIX, parts.workspaceId, parts.id, parts.secret);
}

/** A code's parts, or undefined for anything that isn't one. */
export function parsePartnerCode(code: string): PartnerTokenParts | undefined {
  return parsePairToken(CODE_PREFIX, code);
}

/** A connection's access token: names its workspace and connection. */
export function partnerAccessToken(parts: PartnerTokenParts): string {
  return pairToken(TOKEN_PREFIX, parts.workspaceId, parts.id, parts.secret);
}

/** An access token's parts, or undefined for anything that isn't one. */
export function parsePartnerAccessToken(token: string): PartnerTokenParts | undefined {
  return parsePairToken(TOKEN_PREFIX, token);
}

/** A PKCE S256 challenge, as base64url: 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** A PKCE verifier (RFC 7636): 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** Whether a challenge has S256's shape. */
export function isS256Challenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

/** The S256 challenge a verifier makes (RFC 7636, 4.2): base64url of its SHA-256, unpadded. */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Whether `verifier` makes `challenge` under S256, in constant time. Plain is never accepted. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  return timingSafeEqual(Buffer.from(s256Challenge(verifier)), Buffer.from(challenge));
}
