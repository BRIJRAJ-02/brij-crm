// Several link pages (spec 0064, slice 2, AC-6413 to AC-6416): a person keeps up to 5 link pages in one workspace,
// each with its own handle, private name, look, blocks and numbers, one of them the primary page (Home's card, the
// handle their booking pages live under). The pages live in schema auth, out of the app role's reach; these reach
// them through crm_handle's definers only (migration 0166), for the session's own person in the scope's workspace.
import {
  DEFAULT_PAGE_THEME,
  handleProblem,
  LINK_PAGES_FULL,
  linkPageNameProblem,
  PageTheme,
  type LinkPageSummary,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { ownUserId } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';

/** One page as `crm_profile_pages` answers it. */
interface PageRow extends Record<string, unknown> {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly is_primary: boolean;
  readonly shown: boolean;
  readonly theme: unknown;
  readonly bio: string;
  readonly indexable: boolean;
  readonly share_image_version: string | null;
}

/** One of the person's pages with what the profile read needs of it beyond the switcher's tile. */
export interface LinkPageRow extends LinkPageSummary {
  readonly indexable: boolean;
  /** The version of the page's share image (spec 0055, AC-5511), absent when it has none. */
  readonly shareImageVersion?: string;
}

/**
 * `userId`'s pages in `workspaceId`, the primary first, then in the order they were made (`crm_profile_pages`).
 * Empty when they have none there, are not an active member, or the transaction is another workspace's.
 */
export async function linkPagesOf(
  tx: WorkspaceTx,
  userId: string,
  workspaceId: string,
): Promise<readonly LinkPageRow[]> {
  const found = await tx.execute<PageRow>(
    sql`select id::text as id, handle, name, is_primary, shown, theme, bio, indexable, share_image_version
        from crm_profile_pages(${userId}::uuid, ${workspaceId}::uuid)`,
  );
  return found.rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    name: row.name,
    isPrimary: row.is_primary,
    isPublic: row.shown,
    bio: row.bio,
    theme: PageTheme.safeParse(row.theme).data ?? DEFAULT_PAGE_THEME,
    indexable: row.indexable,
    ...(typeof row.share_image_version === 'string' ? { shareImageVersion: row.share_image_version } : {}),
  }));
}

/** The tile's fields alone, as the contract answers them. */
function summaryOf(row: LinkPageRow): LinkPageSummary {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    isPrimary: row.isPrimary,
    isPublic: row.isPublic,
    bio: row.bio,
    theme: row.theme,
  };
}

/** The caller's pages in this workspace, for the switcher (AC-6414). */
export async function listLinkPages(scope: EngineScope): Promise<readonly LinkPageSummary[]> {
  const owner = ownUserId(scope);
  const rows = await inWorkspace(scope, (tx) => linkPagesOf(tx, owner, scope.workspaceId));
  return rows.map(summaryOf);
}

/** The sentence a page that isn't the caller's any more is refused with: deleted in another tab, or never theirs. */
const PAGE_GONE = 'That link page isn’t yours any more.';

/**
 * A new link page (AC-6413, AC-6414): a handle under spec 0056's rules (unique everywhere, at most 20 per person)
 * and a private name, live at once since its owner made it on purpose (spec 0058, AC-23). Idempotent on `id`. A sixth
 * page is `LIMIT_REACHED`; a handle held by anyone else, or used by another of their pages, `SLUG_TAKEN` on `handle`.
 * Answers the caller's pages as they now stand.
 */
export async function createLinkPage(
  scope: EngineScope,
  input: { readonly id: string; readonly handle: string; readonly name: string },
): Promise<readonly LinkPageSummary[]> {
  const owner = ownUserId(scope);
  if (!isUuid(input.id)) throw refuse('CONFIG_INVALID', 'That page can’t be made as it is.');
  const handle = input.handle.trim().toLowerCase();
  const wrong = handleProblem(handle);
  if (wrong !== undefined) throw refuseOn('CONFIG_INVALID', wrong, 'handle');
  const name = input.name.trim();
  const badName = linkPageNameProblem(name);
  if (badName !== undefined) throw refuseOn('CONFIG_INVALID', badName, 'name');
  return inWorkspace(scope, async (tx) => {
    try {
      await tx.execute(
        sql`select crm_create_profile_page(${owner}::uuid, ${scope.workspaceId}::uuid, ${input.id}::uuid, ${handle}, ${name})`,
      );
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '23505') throw refuseOn('SLUG_TAKEN', 'That handle is taken. Pick another.', 'handle');
      if (pg?.code === '54000' && pg.detail === 'pages') throw refuse('LIMIT_REACHED', LINK_PAGES_FULL);
      if (pg?.code === '54000') {
        throw refuseOn('LIMIT_REACHED', 'You hold 20 handles, the most one person can have.', 'handle');
      }
      if (pg?.code === '42501') throw refuse('FORBIDDEN', 'You’re not a member of this workspace.');
      throw error;
    }
    return (await linkPagesOf(tx, owner, scope.workspaceId)).map(summaryOf);
  });
}

/** Renames one of the caller's pages (AC-6413): a private name, empty for none. NOT_FOUND for a page not theirs here. */
export async function renameLinkPage(
  scope: EngineScope,
  input: { readonly profileId: string; readonly name: string },
): Promise<readonly LinkPageSummary[]> {
  const owner = ownUserId(scope);
  const name = input.name.trim();
  const badName = linkPageNameProblem(name);
  if (badName !== undefined) throw refuseOn('CONFIG_INVALID', badName, 'name');
  if (!isUuid(input.profileId)) throw refuse('NOT_FOUND', PAGE_GONE);
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<{ done: boolean }>(
      sql`select crm_rename_profile_page(${owner}::uuid, ${scope.workspaceId}::uuid, ${input.profileId}::uuid, ${name}) as done`,
    );
    if (found.rows[0]?.done !== true) throw refuse('NOT_FOUND', PAGE_GONE);
    return (await linkPagesOf(tx, owner, scope.workspaceId)).map(summaryOf);
  });
}

/**
 * Makes one of the caller's pages their primary page (AC-6415): Home's card shows it and their booking pages live
 * under its handle from now on. NOT_FOUND for a page not theirs here.
 */
export async function setPrimaryLinkPage(scope: EngineScope, profileId: string): Promise<readonly LinkPageSummary[]> {
  const owner = ownUserId(scope);
  if (!isUuid(profileId)) throw refuse('NOT_FOUND', PAGE_GONE);
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<{ done: boolean }>(
      sql`select crm_set_primary_profile_page(${owner}::uuid, ${scope.workspaceId}::uuid, ${profileId}::uuid) as done`,
    );
    if (found.rows[0]?.done !== true) throw refuse('NOT_FOUND', PAGE_GONE);
    return (await linkPagesOf(tx, owner, scope.workspaceId)).map(summaryOf);
  });
}

/**
 * Deletes one of the caller's pages for good (AC-6416; the screen asks first), its blocks and numbers with it. Its
 * handles stay reserved to them (spec 0056) and find their primary page. The only page there is `CONFIG_INVALID`;
 * deleting the primary page makes the next one primary. Answers the pages left and the deleted page's handle, so the
 * caller can drop the edge's copies of it.
 */
export async function deleteLinkPage(
  scope: EngineScope,
  profileId: string,
): Promise<{
  readonly pages: readonly LinkPageSummary[];
  readonly handle: string;
  /** The store paths of its cover and photo ground, which the caller deletes once this has committed. */
  readonly photos: readonly string[];
}> {
  const owner = ownUserId(scope);
  if (!isUuid(profileId)) throw refuse('NOT_FOUND', PAGE_GONE);
  return inWorkspace(scope, async (tx) => {
    let gone: { handle: string; cover_path: string | null; ground_path: string | null } | undefined;
    try {
      const found = await tx.execute<{ handle: string; cover_path: string | null; ground_path: string | null }>(
        sql`select handle, cover_path, ground_path from crm_delete_profile_page(${owner}::uuid, ${scope.workspaceId}::uuid, ${profileId}::uuid)`,
      );
      gone = found.rows[0];
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '55000') throw refuse('CONFIG_INVALID', 'Keep at least one link page.');
      throw error;
    }
    if (gone === undefined) throw refuse('NOT_FOUND', PAGE_GONE);
    return {
      pages: (await linkPagesOf(tx, owner, scope.workspaceId)).map(summaryOf),
      handle: gone.handle,
      photos: [gone.cover_path, gone.ground_path].filter((path): path is string => path !== null),
    };
  });
}
