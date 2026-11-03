// Publish for link pages (spec 0068, AC-6810 to AC-6813). The editor's writes change the page's rows, which are its
// draft; guests read the published snapshot on the profile row (migration 0172), which only Publish writes. Each
// Publish keeps a version in `page_versions` (kind `link`, the page named by its owner's user id), the last 20; Discard
// puts the rows back to what guests see; Restore makes a version the draft. Every one acts on the caller's own page
// only (`ownUserId`): no input names whose. Pausing, the handle, the share picture and indexing stay instant.
import { PAGE_VERSIONS_KEPT, type LinkPagePublication, type PageVersionList } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ownUserId } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { writeAudit } from '../members/audit.ts';
import { keepVersion, publisherOf } from '../booking/versions.ts';
import { diffLinkPage, linkSnapshotOf, photoPathsOf } from './link-drafts.ts';

const { members, pageVersions } = schema;

/** The sentence a person with no page meets. */
const NO_PAGE = 'Pick a handle before you publish your link page.';

interface StateRow extends Record<string, unknown> {
  readonly draft: unknown;
  readonly published: unknown;
  readonly published_at: string | Date | null;
}

/** The draft and the published snapshot, or NOT_FOUND with no page here. */
async function stateOf(tx: WorkspaceTx, owner: string, workspace: string): Promise<StateRow> {
  const found = await tx.execute<StateRow>(
    sql`select draft, published, published_at from crm_link_page_state(${owner}::uuid, ${workspace}::uuid)`,
  );
  const [row] = found.rows;
  if (row === undefined || row.draft === null) throw refuse('NOT_FOUND', NO_PAGE);
  return row;
}

/** Where the page stands: each change guests don't see yet, and when it was last published. */
function publicationOf(row: StateRow): LinkPagePublication {
  const changes = diffLinkPage(linkSnapshotOf(row.published), linkSnapshotOf(row.draft));
  const at = row.published_at === null ? undefined : new Date(row.published_at);
  return { changes: [...changes], ...(at === undefined ? {} : { publishedAt: at.toISOString() }) };
}

/** A definer's refusal in the service's words. */
function refusalOf(error: unknown): never {
  const pg = postgresError(error);
  if (pg?.code === 'P0002' || pg?.code === '42501') throw refuse('NOT_FOUND', NO_PAGE);
  if (['23505', '23514', '22023', '22P02', '42704'].includes(pg?.code ?? '')) {
    throw refuse('CONFIG_INVALID', 'That version can’t be brought back as it is. Change the page by hand instead.');
  }
  throw error;
}

/** The member a link page audit row names: the caller, whose page it is. */
function auditTarget(scope: EngineScope): string {
  const member = publisherOf(scope);
  if (member === null) throw refuse('FORBIDDEN', 'Only a signed in person has a link page.');
  return member;
}

/** The photos that were in the store for `before` and are named by neither `after` nor the draft any more. */
function lettingGo(before: readonly unknown[], after: readonly unknown[]): readonly string[] {
  const kept = new Set(after.flatMap((one) => photoPathsOf(linkSnapshotOf(one))));
  return [...new Set(before.flatMap((one) => photoPathsOf(linkSnapshotOf(one))))].filter((path) => !kept.has(path));
}

/** Where the caller's own link page stands (AC-6811): the changes guests don't see yet. */
export async function readLinkPagePublication(scope: EngineScope): Promise<LinkPagePublication> {
  const owner = ownUserId(scope);
  return inWorkspace(scope, async (tx) => publicationOf(await stateOf(tx, owner, scope.workspaceId)));
}

/**
 * Publishes the caller's own link page (AC-6811, AC-6812): the draft becomes what guests see, kept as the next
 * version, with an audit row. With nothing to publish, the page answers as it is. `forget` names the photos no longer
 * on the page or in the draft, which the caller deletes from the store once this commits, after purging the page's
 * edge copies (AC-6816).
 */
export async function publishLinkPage(
  scope: EngineScope,
  now: Date = new Date(),
): Promise<{ readonly publication: LinkPagePublication; readonly forget: readonly string[] }> {
  const owner = ownUserId(scope);
  const member = auditTarget(scope);
  return inWorkspace(scope, async (tx) => {
    const before = await stateOf(tx, owner, scope.workspaceId);
    if (before.published !== null && publicationOf(before).changes.length === 0) {
      return { publication: publicationOf(before), forget: [] };
    }
    let snapshot: unknown;
    try {
      const done = await tx.execute<{ snapshot: unknown }>(
        sql`select crm_publish_link_page(${owner}::uuid, ${scope.workspaceId}::uuid) as snapshot`,
      );
      snapshot = done.rows[0]?.snapshot;
    } catch (error) {
      refusalOf(error);
    }
    if (typeof snapshot !== 'object' || snapshot === null) throw refuse('NOT_FOUND', NO_PAGE);
    const version = await keepVersion(tx, scope, owner, snapshot, now, 'link');
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'link_page.published',
      targetType: 'member',
      targetId: member,
      after: { version },
    });
    const after = await stateOf(tx, owner, scope.workspaceId);
    return { publication: publicationOf(after), forget: lettingGo([before.published], [after.published]) };
  });
}

/**
 * Drops the caller's draft (AC-6811): the page's rows go back to what guests see. A block added since is archived,
 * never deleted. The editor asks first. `forget` names the draft's own photos, now on nothing.
 */
export async function discardLinkDraft(
  scope: EngineScope,
): Promise<{ readonly publication: LinkPagePublication; readonly forget: readonly string[] }> {
  const owner = ownUserId(scope);
  const member = auditTarget(scope);
  return inWorkspace(scope, async (tx) => {
    const before = await stateOf(tx, owner, scope.workspaceId);
    if (before.published === null) throw refuse('NOT_FOUND', 'This page hasn’t been published yet.');
    if (publicationOf(before).changes.length === 0) return { publication: publicationOf(before), forget: [] };
    try {
      await tx.execute(sql`select crm_discard_link_draft(${owner}::uuid, ${scope.workspaceId}::uuid)`);
    } catch (error) {
      refusalOf(error);
    }
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'link_page.draft_discarded',
      targetType: 'member',
      targetId: member,
      before: { changed: publicationOf(before).changes.length },
    });
    const after = await stateOf(tx, owner, scope.workspaceId);
    return { publication: publicationOf(after), forget: lettingGo([before.draft], [after.draft, after.published]) };
  });
}

/** The caller's link page versions, newest first, at most 20, each named by who published it while a member. */
export async function listLinkPageVersions(scope: EngineScope): Promise<PageVersionList> {
  const owner = ownUserId(scope);
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select({ version: pageVersions.version, publishedAt: pageVersions.publishedAt, name: members.name })
      .from(pageVersions)
      .leftJoin(
        members,
        and(
          eq(members.workspaceId, pageVersions.workspaceId),
          eq(members.id, pageVersions.publishedByMemberId),
          sql`${members.status} = 'active'`,
        ),
      )
      .where(and(eq(pageVersions.pageKind, 'link'), eq(pageVersions.pageId, owner)))
      .orderBy(desc(pageVersions.version))
      .limit(PAGE_VERSIONS_KEPT);
    return {
      versions: rows.map((row, index) => ({
        version: row.version,
        publishedAt: row.publishedAt.toISOString(),
        ...(row.name === null ? {} : { publishedBy: row.name }),
        isCurrent: index === 0,
      })),
    };
  });
}

/**
 * Makes one of the caller's versions their draft (AC-6812): the page's rows go back to it, each block checked as a
 * save checks it, and Publish puts it live. A block deleted since stays gone, and a photo the store no longer holds
 * isn't brought back. A version past the last 20 is NOT_FOUND.
 */
export async function restoreLinkPageVersion(
  scope: EngineScope,
  version: number,
): Promise<{ readonly publication: LinkPagePublication; readonly forget: readonly string[] }> {
  const owner = ownUserId(scope);
  const member = auditTarget(scope);
  return inWorkspace(scope, async (tx) => {
    const before = await stateOf(tx, owner, scope.workspaceId);
    const [row] = await tx
      .select({ snapshot: pageVersions.snapshot })
      .from(pageVersions)
      .where(and(eq(pageVersions.pageKind, 'link'), eq(pageVersions.pageId, owner), eq(pageVersions.version, version)));
    if (row === undefined) throw refuseOn('NOT_FOUND', 'That version isn’t kept any more.', 'version');
    try {
      await tx.execute(
        sql`select crm_restore_link_page(${owner}::uuid, ${scope.workspaceId}::uuid, ${JSON.stringify(row.snapshot)}::jsonb)`,
      );
    } catch (error) {
      refusalOf(error);
    }
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'link_page.version_restored',
      targetType: 'member',
      targetId: member,
      after: { version },
    });
    const after = await stateOf(tx, owner, scope.workspaceId);
    return { publication: publicationOf(after), forget: lettingGo([before.draft], [after.draft, after.published]) };
  });
}
