// The guest page's token (spec 0025, AC-638): the only key to a booking for
// its guest, with no account. The database keeps only its SHA-256, so a copy
// of the database alone opens nothing. The token itself is an HMAC of the
// booking's id under a server key the api and the worker share, so whoever
// sends a booking's email (the worker, days later, for a reminder) can write
// the same link again without the token ever being stored. A booking made
// before this scheme kept a random token's hash (`manage_token_derived` is
// false); the first link written for it moves it to the derived token once
// (its old link stops working). A derived row is never written again here, so
// two processes holding different keys can't keep overwriting each other.
import { createHash, createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';

const { bookings } = schema;

/** The key manage tokens are derived with: 32 bytes the api and the worker share, passed in, never read here. */
export type ManageLinkKey = Uint8Array;

/** A token's stored form: its SHA-256, hex. */
export function manageTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A booking's manage token (32 URL safe characters, 192 bits) and the hash its row keeps. */
export function manageTokenFor(
  key: ManageLinkKey,
  bookingId: string,
): { readonly token: string; readonly hash: string } {
  const token = createHmac('sha256', key).update(`booking-manage:${bookingId}`).digest('base64url').slice(0, 32);
  return { token, hash: manageTokenHash(token) };
}

/**
 * The booking's token, its row moved to the derived token first when it still
 * keeps an older random one's hash. Runs inside the caller's transaction.
 */
export async function ensureManageToken(
  tx: WorkspaceTx,
  key: ManageLinkKey,
  row: { readonly id: string; readonly manageTokenDerived: boolean },
): Promise<string> {
  const { token, hash } = manageTokenFor(key, row.id);
  if (!row.manageTokenDerived) {
    await tx
      .update(bookings)
      .set({ manageTokenHash: hash, manageTokenDerived: true })
      .where(and(eq(bookings.id, row.id), eq(bookings.manageTokenDerived, false)));
  }
  return token;
}

/** The guest page's path for a booking: `/b/<publicKey>/manage?t=<token>`, on the app's origin. */
export function managePath(publicKey: string, token: string): string {
  return `/b/${encodeURIComponent(publicKey)}/manage?${new URLSearchParams({ t: token }).toString()}`;
}
