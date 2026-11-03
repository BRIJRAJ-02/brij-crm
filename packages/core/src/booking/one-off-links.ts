// One off links (spec 0062, AC-6204): a link a host makes from the page editor that books its page a set number of
// times (1 by default, up to 50), optionally until a day up to a year ahead, then answers "This link has been used".
//
// The token is 32 random bytes, base64url, shown once when the link is made; only its SHA-256 is stored, and every
// comparison is by that hash. The address carries it in the fragment (`/b/<key>#o=<token>`), so it never reaches a
// server log or a Referer: the page asks for the link's state by the hash, and books with the token in the body.
//
// A use is counted when the booking commits, inside the booking's own transaction and under the link row's lock, so
// two visitors racing the last use can't both book (AC-6204, the concurrency case in the spec's tests).
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  ONE_OFF_EXPIRY_DAYS_MAX,
  ONE_OFF_LINKS_MAX,
  type CreatedOneOffLink,
  type CreateOneOffLinkInput,
  type ListOneOffLinksInput,
  type OneOffLinkView,
  type OneOffState,
  type RevokeOneOffLinkInput,
} from '@crm/contracts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { writeAudit } from '../members/audit.ts';
import { editablePage } from './pages.ts';

const { bookingPageLinks } = schema;

/** The member behind a scope, or undefined for anyone else. */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

/** What a visitor sees for a link with nothing left to book (AC-6204). */
export const LINK_USED_MESSAGE = 'This link has been used.';

type LinkRow = typeof bookingPageLinks.$inferSelect;

/** A token's stored form: its SHA-256, in hex. */
export function oneOffTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Where a link stands at `now`. */
function stateOf(row: LinkRow, now: Date): OneOffState {
  if (row.revokedAt !== null) return 'revoked';
  if (row.uses >= row.maxUses) return 'used';
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'open';
}

/** A link as its page's editor lists it. */
function viewOf(row: LinkRow, now: Date): OneOffLinkView {
  return {
    id: row.id,
    ...(row.label === null ? {} : { label: row.label }),
    maxUses: row.maxUses,
    uses: row.uses,
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt.toISOString() }),
    state: stateOf(row, now),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The page's link for this hash, or undefined: a hash of another page's link is no link here. */
async function linkOf(tx: WorkspaceTx, pageId: string, hash: string, lock: boolean): Promise<LinkRow | undefined> {
  const query = tx
    .select()
    .from(bookingPageLinks)
    .where(and(eq(bookingPageLinks.tokenHash, hash), eq(bookingPageLinks.pageId, pageId)));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** Where the link behind a hash stands, for the public page (an unknown one reads as used: nothing to book). */
export async function oneOffStateOf(tx: WorkspaceTx, pageId: string, hash: string, now: Date): Promise<OneOffState> {
  const row = await linkOf(tx, pageId, hash, false);
  return row === undefined ? 'used' : stateOf(row, now);
}

/** Refuses LINK_USED unless the link may still book, before any calendar is read. */
export async function checkOneOffLink(tx: WorkspaceTx, pageId: string, hash: string, now: Date): Promise<void> {
  if ((await oneOffStateOf(tx, pageId, hash, now)) !== 'open') throw refuse('LINK_USED', LINK_USED_MESSAGE);
}

/**
 * Counts one use of the link inside the booking's transaction, under the link row's lock, and answers its id for the
 * booking to keep. Refuses LINK_USED when another booking took the last use meanwhile, which rolls the booking back.
 */
export async function useOneOffLink(tx: WorkspaceTx, pageId: string, hash: string, now: Date): Promise<string> {
  const row = await linkOf(tx, pageId, hash, true);
  if (row === undefined || stateOf(row, now) !== 'open') throw refuse('LINK_USED', LINK_USED_MESSAGE);
  await tx
    .update(bookingPageLinks)
    .set({ uses: sql`${bookingPageLinks.uses} + 1` })
    .where(eq(bookingPageLinks.id, row.id));
  return row.id;
}

/** A page's links, newest first, for its editor. */
export async function listOneOffLinks(
  scope: EngineScope,
  input: Pick<ListOneOffLinksInput, 'pageId'>,
  now: Date = new Date(),
): Promise<OneOffLinkView[]> {
  return inWorkspace(scope, async (tx) => {
    const page = await editablePage(tx, scope, input.pageId);
    const rows = await tx
      .select()
      .from(bookingPageLinks)
      .where(eq(bookingPageLinks.pageId, page.id))
      .orderBy(desc(bookingPageLinks.createdAt), desc(bookingPageLinks.id))
      .limit(ONE_OFF_LINKS_MAX);
    return rows.map((row) => viewOf(row, now));
  });
}

/** Makes a link and answers it with its token, the only time the token is ever sent (AC-6204). */
export async function createOneOffLink(
  scope: EngineScope,
  input: Pick<CreateOneOffLinkInput, 'pageId' | 'label' | 'maxUses' | 'expiresAt' | 'mutationId'>,
  now: Date = new Date(),
): Promise<CreatedOneOffLink> {
  const member = memberOf(scope);
  if (member === undefined) throw refuse('FORBIDDEN', 'Only a member makes a link.');
  const expires = input.expiresAt === undefined ? undefined : new Date(input.expiresAt);
  if (expires !== undefined) {
    const latest = now.getTime() + ONE_OFF_EXPIRY_DAYS_MAX * 86_400_000;
    if (expires.getTime() <= now.getTime() || expires.getTime() > latest) {
      throw refuseOn('CONFIG_INVALID', 'Pick a day in the next year.', 'expiresAt');
    }
  }
  return inWorkspace(scope, async (tx) => {
    const page = await editablePage(tx, scope, input.pageId, true);
    const token = randomBytes(32).toString('base64url');
    // A retry of the same New link (its mutation id) answers that link, not a second one. Its token is only ever
    // stored as a hash, so the retry gets a new one in its place: the first answer never arrived, so nobody holds it.
    const [again] = await tx
      .select()
      .from(bookingPageLinks)
      .where(and(eq(bookingPageLinks.mutationId, input.mutationId), eq(bookingPageLinks.pageId, page.id)))
      .for('update');
    if (again !== undefined) {
      const [renewed] = await tx
        .update(bookingPageLinks)
        .set({ tokenHash: oneOffTokenHash(token) })
        .where(and(eq(bookingPageLinks.id, again.id), eq(bookingPageLinks.uses, 0)))
        .returning();
      if (renewed === undefined) throw refuse('LIMIT_REACHED', 'That link was already used. Make a new one.');
      return { link: viewOf(renewed, now), token };
    }
    const [count] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingPageLinks)
      .where(eq(bookingPageLinks.pageId, page.id));
    if ((count?.count ?? 0) >= ONE_OFF_LINKS_MAX) {
      throw refuse(
        'LIMIT_REACHED',
        `A page keeps at most ${String(ONE_OFF_LINKS_MAX)} links. Revoke an old one first.`,
      );
    }
    const [row] = await tx
      .insert(bookingPageLinks)
      .values({
        workspaceId: scope.workspaceId,
        pageId: page.id,
        label: input.label ?? null,
        tokenHash: oneOffTokenHash(token),
        maxUses: input.maxUses ?? 1,
        expiresAt: expires ?? null,
        createdByMemberId: member,
        mutationId: input.mutationId,
      })
      .returning();
    if (row === undefined) throw new Error('The link was not stored.');
    await auditLink(tx, scope, 'booking_page.link_created', row);
    return { link: viewOf(row, now), token };
  });
}

/** Revokes a link: it books nothing more. Revoking again changes nothing. */
export async function revokeOneOffLink(
  scope: EngineScope,
  input: Pick<RevokeOneOffLinkInput, 'pageId' | 'linkId'>,
  now: Date = new Date(),
): Promise<OneOffLinkView> {
  return inWorkspace(scope, async (tx) => {
    const page = await editablePage(tx, scope, input.pageId);
    const [row] = await tx
      .update(bookingPageLinks)
      .set({ revokedAt: sql`coalesce(${bookingPageLinks.revokedAt}, now())` })
      .where(and(eq(bookingPageLinks.id, input.linkId), eq(bookingPageLinks.pageId, page.id)))
      .returning();
    if (row === undefined) throw refuse('NOT_FOUND', 'That link doesn’t exist.');
    await auditLink(tx, scope, 'booking_page.link_revoked', row);
    return viewOf(row, now);
  });
}

/**
 * One use given back (AC-6204): a request it booked was declined or ran out of time, so the link may book again.
 * Under the link row's lock, as a use is counted.
 */
export async function giveBackUse(tx: WorkspaceTx, linkId: string): Promise<void> {
  const [row] = await tx.select().from(bookingPageLinks).where(eq(bookingPageLinks.id, linkId)).for('update');
  if (row === undefined || row.uses === 0) return;
  await tx
    .update(bookingPageLinks)
    .set({ uses: row.uses - 1 })
    .where(eq(bookingPageLinks.id, linkId));
}

/** A link made or revoked, on its page's history: its id, uses and expiry, never its token or its hash. */
async function auditLink(
  tx: WorkspaceTx,
  scope: EngineScope,
  action: 'booking_page.link_created' | 'booking_page.link_revoked',
  row: LinkRow,
): Promise<void> {
  await writeAudit(tx, scope.workspaceId, scope.actor, {
    action,
    targetType: 'booking_page',
    targetId: row.pageId,
    after: { linkId: row.id, maxUses: row.maxUses, expiresAt: row.expiresAt?.toISOString() ?? null },
  });
}
