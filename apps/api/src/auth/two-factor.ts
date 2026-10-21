// Two factor sign in (spec 0033, milestone 2), the parts of Better Auth's
// `twoFactor` plugin this app adds to: holding back the session on the email
// code and Google routes (the plugin's own hook covers only password sign
// ins), app codes checked for a step up, backup codes used up for one, and
// session tokens kept off the wire. Only `auth.ts` imports this.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The plugin's routes the API serves (AUTH_ROUTES): setup, turning off, new backup codes, and the second step. */
export const TWO_FACTOR_ROUTES = [
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/generate-backup-codes',
] as const;

/**
 * The plugin's routes this app never serves: the email second factor (email
 * is already the first step), reading the secret again after setup (AC-886),
 * and its server only reads.
 */
export const TWO_FACTOR_DISABLED_PATHS = [
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
  '/two-factor/get-totp-uri',
] as const;

/** How long a pending second step lasts (AC-882): 5 minutes. */
export const SECOND_STEP_SECONDS = 5 * 60;
/** Remember this device (AC-884): 30 days. */
export const TRUST_DEVICE_SECONDS = 30 * 24 * 60 * 60;
/** Wrong second step codes per account before it locks for `SECOND_STEP_LOCK_SECONDS` (AC-882). */
export const SECOND_STEP_FAILURES = 15;
/** How long too many wrong codes lock the account's second step (AC-882): 15 minutes. */
export const SECOND_STEP_LOCK_SECONDS = 15 * 60;
/** Backup codes made at a time (AC-881). */
export const BACKUP_CODE_COUNT = 10;

/** The plugin's cookie names: a pending second step, and a remembered device. */
export const PENDING_COOKIE = 'two_factor';
/** The plugin's remembered device cookie. */
export const TRUST_DEVICE_COOKIE = 'trust_device';

/** A remembered device's token, signed as the plugin signs it (HMAC SHA-256, base64url without padding). */
export function trustToken(secret: string, userId: string, trustId: string): string {
  return createHmac('sha256', secret).update(`${userId}!${trustId}`).digest('base64url');
}

/** Where a sign in held back for its second step goes in the app. */
export const SECOND_STEP_PATH = '/two-factor';

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

/** One HOTP value (RFC 4226) for `counter`, keyed by the secret's text as the plugin keys it. */
function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The app's code for `secret` at `now` (tests make codes with it). */
export function totpCode(secret: string, now = Date.now()): string {
  return hotp(secret, Math.floor(now / 1000 / TOTP_PERIOD_SECONDS));
}

/**
 * Whether `code` is the app's code for `secret` now, or one period either
 * side (clock drift), as the plugin's own check allows. Constant time.
 */
export function totpMatches(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  let matched = false;
  for (const step of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secret, counter + step));
    matched = timingSafeEqual(expected, Buffer.from(code)) || matched;
  }
  return matched;
}

/** A JSON answer's body without any session token: no token leaves the server (AC-891). */
export function withoutTokens(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const { token: _token, session, ...rest } = body as Record<string, unknown>;
  if (typeof session === 'object' && session !== null && !Array.isArray(session)) {
    const { token: _sessionToken, ...kept } = session as Record<string, unknown>;
    return { ...rest, session: kept };
  }
  return session === undefined ? rest : { ...rest, session };
}

/** A successful JSON answer with its tokens taken out; anything else passes through. */
export async function stripTokens(response: Response): Promise<Response> {
  if (response.status >= 300 || !(response.headers.get('content-type') ?? '').includes('application/json')) {
    return response;
  }
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (body === undefined) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(withoutTokens(body)), { status: response.status, headers });
}
