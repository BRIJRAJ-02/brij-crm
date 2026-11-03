// Insights share links (spec 0067, AC-6720): a read only page of numbers for a client or a partner, signed in as
// no one. A member makes one over the pages they may see now; the link names exactly those pages from then on (a
// page made later never joins it, and a page they could see then stays in it), with its range, and an optional
// expiry. Only its maker or an admin (`workspace.manage`) revokes it. Making and revoking each write an audit row.
//
// The token is the workspace's id and the share's id, then 32 random bytes as base64url. Only the SHA-256 of the
// random part is stored, so a stolen row opens nothing; the public read finds the share by that hash inside the
// workspace the token names, under row level security, and answers NOT_FOUND alike for a wrong secret, a revoked
// link, an expired one and a deleted workspace.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  INSIGHT_SHARE_TOKEN,
  INSIGHT_SHARES_MAX,
  type InsightPages,
  type InsightRange,
  type InsightShare,
  type InsightShareCreated,
  type InsightSource,
  type PageKind,
  type SharedInsights,
} from '@crm/contracts';
import { schema, type Database } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { writeAudit, writeAudits, type AuditSource } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { insightNumbers, resolvePeriod, type CoveredPage } from './numbers.ts';
import { pickPages, visiblePages } from './read.ts';

const { insightShares, members, workspaces } = schema;

type Row = typeof insightShares.$inferSelect;

const UNKNOWN_SHARE = 'That link does not exist.';

/** The member the caller is, or a refusal: a share is always somebody's. */
function me(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member can share Insights.');
  return principal.memberId;
}

/** The SHA-256 of a token's secret, as stored. */
function secretHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** A uuid as its 32 hex digits, and back. */
const compact = (id: string) => id.replaceAll('-', '');
const expand = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The pages a stored row names, read back defensively. */
function pagesOf(stored: unknown): CoveredPage[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((each: unknown) => {
    if (typeof each !== 'object' || each === null) return [];
    const { kind, id } = each as { kind?: unknown; id?: unknown };
    return typeof kind === 'string' && typeof id === 'string' && isUuid(id) ? [{ kind: kind as PageKind, id }] : [];
  });
}

/** A row as the list shows it: never the hash. */
function toView(row: Row, memberId: string): InsightShare {
  return {
    id: row.id,
    label: row.label,
    ...(row.pageKind === null ? {} : { pageKind: row.pageKind as PageKind }),
    ...(row.pageId === null ? {} : { pageId: row.pageId }),
    range: row.range as InsightRange,
    pageCount: pagesOf(row.pages).length,
    ...(row.expiresAt === null ? {} : { expiresAt: new Date(row.expiresAt).toISOString() }),
    ...(row.revokedAt === null ? {} : { revokedAt: new Date(row.revokedAt).toISOString() }),
    createdAt: new Date(row.createdAt).toISOString(),
    isMine: row.createdByMemberId === memberId,
  };
}

/** Whether the reader sees every link (an admin) or only their own. */
const seesAll = (scope: EngineScope) => can(scope.access, 'workspace.manage');

/** The fewest visits a source, medium and campaign needs before a share link names it. */
export const SHARED_SOURCE_MIN = 5;

/**
 * A share link's sources (AC-6720): a source, medium and campaign only once it has `SHARED_SOURCE_MIN` visits in
 * the range; the rest fold into one Other row. UTM words are a visitor's own text, so a handful of visits can't
 * put words of their choosing on a page a workspace hands to a client.
 */
export function sharedSources(sources: readonly InsightSource[]): InsightSource[] {
  const shown = sources.filter((row) => row.visits >= SHARED_SOURCE_MIN);
  const folded = sources.filter((row) => row.visits < SHARED_SOURCE_MIN);
  if (folded.length === 0) return shown;
  const other = folded.reduce(
    (sum, row) => ({ ...sum, visits: sum.visits + row.visits, finishes: sum.finishes + row.finishes }),
    { source: 'other', medium: '', campaign: '', visits: 0, finishes: 0 },
  );
  return [...shown, other];
}

/**
 * A removed member's share links stop at once (spec 0067): each is revoked in the removal's own transaction, with
 * its `insights.share_revoked` audit row, so nobody holds a live link to numbers they can no longer see.
 */
export const insightSharesRemoval: RemovalEffect = {
  feature: 'insight shares',
  constraints: ['insight_shares_creator'],
  run: async ({ tx, scope }, memberId, source) => {
    const revoked = await tx
      .update(insightShares)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(insightShares.createdByMemberId, memberId), isNull(insightShares.revokedAt)))
      .returning({ id: insightShares.id, label: insightShares.label });
    await writeAudits(
      tx,
      scope.workspaceId,
      scope.actor,
      revoked.map((row) => ({
        action: 'insights.share_revoked' as const,
        targetType: 'workspace' as const,
        targetId: scope.workspaceId,
        after: { shareId: row.id, label: row.label, reason: 'member_removed' },
      })),
      source,
    );
  },
};

/** The share links the reader may see, newest first: their own, or every one for an admin. */
export async function listInsightShares(scope: EngineScope): Promise<{ readonly shares: readonly InsightShare[] }> {
  const caller = me(scope);
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select()
      .from(insightShares)
      .where(seesAll(scope) ? undefined : eq(insightShares.createdByMemberId, caller))
      // Live links first, so a long tail of revoked ones never hides a live link from the admin who'd revoke it.
      .orderBy(sql`${insightShares.revokedAt} is not null`, desc(insightShares.createdAt))
      .limit(INSIGHT_SHARES_MAX),
  );
  return { shares: rows.map((row) => toView(row, caller)) };
}

/**
 * Makes a share link over the pages the caller may see now that `pages` picks, and answers its token once. At most
 * `INSIGHT_SHARES_MAX` live links a workspace (`LIMIT_REACHED`). One `insights.share_created` audit row.
 */
export async function createInsightShare(
  scope: EngineScope,
  input: {
    readonly label: string;
    readonly pages: InsightPages;
    readonly range: InsightRange;
    readonly expiresAt?: string;
  },
  source: AuditSource = {},
  now: Date = new Date(),
): Promise<InsightShareCreated> {
  const caller = me(scope);
  const label = input.label.trim();
  if (label.length === 0 || label.length > 80) throw inputInvalid('label', 'Give the link a name.');
  if (input.expiresAt !== undefined) {
    const at = Date.parse(input.expiresAt);
    if (Number.isNaN(at) || at <= now.getTime()) throw inputInvalid('expiresAt', 'Pick a time in the future.');
    if (at > now.getTime() + 366 * 86_400_000) throw inputInvalid('expiresAt', 'Pick a time within a year.');
  }
  const picked = pickPages(await visiblePages(scope), input.pages);
  if (picked.length === 0) throw refuse('NOT_FOUND', 'There are no pages to share yet.');
  const pages = picked.slice(0, 500).map((page) => ({ kind: page.kind, id: page.id }));
  const secret = randomBytes(32).toString('base64url');
  const share = await inWorkspace(scope, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`insight_shares:${scope.workspaceId}`}, 0))`);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(insightShares)
      .where(isNull(insightShares.revokedAt));
    if ((count?.n ?? 0) >= INSIGHT_SHARES_MAX) {
      throw refuse('LIMIT_REACHED', `A workspace holds at most ${String(INSIGHT_SHARES_MAX)} share links.`);
    }
    const [row] = await tx
      .insert(insightShares)
      .values({
        workspaceId: scope.workspaceId,
        tokenHash: secretHash(secret),
        label,
        pageKind: input.pages.kind ?? null,
        pageId: input.pages.pageId ?? null,
        pages,
        range: input.range,
        expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt),
        createdByMemberId: caller,
      })
      .returning();
    if (row === undefined) throw new Error('A share link just made could not be read back.');
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'insights.share_created',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { shareId: row.id, label, range: input.range, pages: pages.length, expires: input.expiresAt ?? null },
      },
      source,
    );
    return toView(row, caller);
  });
  return { share, token: `${compact(scope.workspaceId)}${compact(share.id)}${secret}` };
}

/** Revokes a link: it stops opening at once. Its maker or an admin only; one already revoked answers as it is. */
export async function revokeInsightShare(
  scope: EngineScope,
  input: { readonly shareId: string },
  source: AuditSource = {},
): Promise<InsightShare> {
  const caller = me(scope);
  if (!isUuid(input.shareId)) throw refuse('NOT_FOUND', UNKNOWN_SHARE);
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(insightShares).where(eq(insightShares.id, input.shareId)).for('update');
    // Someone else's link is absent to a member who isn't an admin, as it is in their list.
    if (row === undefined || (row.createdByMemberId !== caller && !seesAll(scope))) {
      throw refuse('NOT_FOUND', UNKNOWN_SHARE);
    }
    if (row.revokedAt !== null) return toView(row, caller);
    const [revoked] = await tx
      .update(insightShares)
      .set({ revokedAt: sql`now()`, revokedByMemberId: caller })
      .where(eq(insightShares.id, row.id))
      .returning();
    if (revoked === undefined) throw new Error('A share link just revoked could not be read back.');
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'insights.share_revoked',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { shareId: row.id, label: row.label },
      },
      source,
    );
    return toView(revoked, caller);
  });
}

/**
 * What a share link opens (AC-6720), for the public route: the numbers only, over the pages and range the link
 * holds, read inside the workspace its token names. NOT_FOUND for a malformed, wrong, revoked or expired token, and
 * for a deleted workspace, all alike. Never a session, a name, an email, a host under Other or a free text answer.
 */
export async function readInsightShare(
  deps: { readonly db: Database },
  token: string,
  now: Date = new Date(),
): Promise<SharedInsights> {
  const missing = () => refuse('NOT_FOUND', 'This link doesn’t open anything. Ask for a new one.');
  if (!INSIGHT_SHARE_TOKEN.test(token)) throw missing();
  const workspaceId = expand(token.slice(0, 32));
  const shareId = expand(token.slice(32, 64));
  const hash = secretHash(token.slice(64));
  return deps.db.withWorkspace(workspaceId, async (tx) => {
    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
    if (workspace === undefined) throw missing();
    const [row] = await tx
      .select()
      .from(insightShares)
      .where(and(eq(insightShares.workspaceId, workspaceId), eq(insightShares.tokenHash, hash)));
    if (
      row === undefined ||
      !timingSafeEqual(Buffer.from(compact(row.id)), Buffer.from(compact(shareId))) ||
      row.revokedAt !== null ||
      (row.expiresAt !== null && new Date(row.expiresAt).getTime() <= now.getTime())
    ) {
      throw missing();
    }
    // A link lives only while its maker is an active member: a removed person's links stop opening with them.
    const [maker] = await tx
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, row.createdByMemberId));
    if (maker?.status !== 'active') throw missing();
    const pages = pagesOf(row.pages);
    const range = row.range as InsightRange;
    const period = await resolvePeriod(tx, workspaceId, pages, { range }, now);
    const { others: _others, ...numbers } = await insightNumbers(tx, workspaceId, pages, period, {
      previous: period.compare,
    });
    // The pages by name: only what the link already names, read under the workspace's own row security.
    const names = await tx.execute<{ name: string }>(sql`
      select f.name from forms f where f.status <> 'archived' and f.id = any(${`{${pages
        .filter((p) => p.kind === 'form')
        .map((p) => p.id)
        .join(',')}}`}::uuid[])
      union all
      select b.title from booking_pages b where b.deleted_at is null and b.id = any(${`{${pages
        .filter((p) => p.kind === 'booking')
        .map((p) => p.id)
        .join(',')}}`}::uuid[])
      limit 50
    `);
    return {
      label: row.label,
      workspaceName: workspace.name,
      pageNames: names.rows.map((each) => each.name),
      range,
      numbers: { ...numbers, buckets: [...numbers.buckets], sources: sharedSources(numbers.sources) },
    };
  });
}
