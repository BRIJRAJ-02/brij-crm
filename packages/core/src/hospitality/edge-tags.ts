// Which edge cache tags a write makes stale (owner decision, 10 Nov 2026: separate businesses stay unlinkable). Each
// business has its own opaque tags (`cache-tags.ts`), so a writer names what it changed (a business, some places, or
// every business of the workspace) and this reads which businesses those are. Called by the member who made the write,
// in their own workspace, after it committed (or, for a workspace's deletion, just before); it reads ids only and
// writes nothing.
import { menuCacheTags } from '@crm/contracts';
import { schema } from '@crm/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { businessCacheTags, legacyWorkspaceCacheTags, menuBusinessCacheTags } from './cache-tags.ts';
import { hospitalityMember } from './gate.ts';
import { currentProperty } from './property.ts';

const { places, properties } = schema;

/** What a write changed, for the tags it purges. */
export interface EdgeTarget {
  /** Businesses it changed; `undefined` in the list stands for the first (a call that named none worked there). */
  readonly properties?: readonly (string | undefined)[];
  /** Places it changed: each place's tag, and its business's. */
  readonly places?: readonly string[];
  /** Every business of the workspace (its apps, its brand kit, its deletion or restore). */
  readonly every?: boolean;
  /**
   * Each named business's guest menu tag too (`menu-ws:`), for a change every menu answer of it shows; with `every`,
   * each place's own menu tag as well, so nothing of the workspace's menus is left at the edge.
   */
  readonly menus?: boolean;
}

/**
 * The edge cache tags to purge for `target`, each business's own and never one a public answer shows for two of them.
 * Ids that aren't ids, and businesses or places that aren't this workspace's, are left out. Any member: it only names
 * tags, which never leave the server.
 */
export async function businessEdgeTags(scope: EngineScope, target: EdgeTarget = {}): Promise<readonly string[]> {
  hospitalityMember(scope);
  const workspaceId = scope.workspaceId;
  return inWorkspace(scope, async (tx) => {
    const ids = new Set<string>();
    const placeIds = new Set<string>();
    if (target.every === true) {
      const rows = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.workspaceId, workspaceId));
      for (const row of rows) ids.add(row.id);
      if (target.menus === true) {
        const all = await tx.select({ id: places.id }).from(places).where(eq(places.workspaceId, workspaceId));
        for (const row of all) placeIds.add(row.id);
      }
    }
    const named = target.properties ?? [];
    if (named.includes(undefined)) ids.add((await currentProperty(tx, workspaceId)).id);
    const given = named.filter((id): id is string => id !== undefined && isUuid(id));
    if (given.length > 0) {
      const rows = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.workspaceId, workspaceId), inArray(properties.id, given)));
      for (const row of rows) ids.add(row.id);
    }
    const asked = [...new Set(target.places ?? [])].filter((id) => isUuid(id));
    if (asked.length > 0) {
      const rows = await tx
        .select({ id: places.id, propertyId: places.propertyId })
        .from(places)
        .where(and(eq(places.workspaceId, workspaceId), inArray(places.id, asked)));
      for (const row of rows) {
        ids.add(row.propertyId);
        placeIds.add(row.id);
      }
    }
    return [
      ...[...ids].flatMap((id) => [
        ...businessCacheTags(workspaceId, id),
        ...(target.menus === true ? menuBusinessCacheTags(workspaceId, id) : []),
      ]),
      ...[...placeIds].map((id) => `place:${id}`),
      ...(target.every === true && target.menus === true ? menuCacheTags(...placeIds) : []),
      // Copies filed under the old workspace wide tags before this change (until 24 November 2026, when every one of
      // them has outlived its day at the edge): purged with anything that changed a business.
      ...(ids.size > 0 ? legacyWorkspaceCacheTags(workspaceId, target.menus === true) : []),
    ];
  });
}
