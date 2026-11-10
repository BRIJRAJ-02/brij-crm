// The edge cache tags a business's public answers are filed under (spec 0066, Public routes): one for the business,
// one per place. The business's tag never carries its workspace's id, which the public answer would otherwise show
// to anybody (the page's JSON lists its tags for the handle shell to file itself under): it is an opaque id instead,
// the first 128 bits of SHA-256 over a fixed label, the workspace's id and the business's (property's) id. Stable, so
// every writer purges the same tag the reader filed, and one way, so the tag says nothing about which workspace it is.
//
// Per business, never per workspace (owner decision, 10 Nov 2026): two businesses of one workspace are separate brands,
// and a tag they shared would tell anyone reading two public answers that they belong together. A change that reaches
// every business of a workspace (its apps, its brand kit, its deletion) purges each business's tag, read by
// `businessEdgeTags` (`edge-tags.ts`). Place ids are already public and name one place each.
import { createHash } from 'node:crypto';
import { menuWorkspaceTags } from '@crm/contracts';
import { isUuid } from '../engine/ids.ts';

/** The opaque id standing for one business (property) of a workspace in its public cache tags: 32 hex digits. */
export function businessCacheId(workspaceId: string, propertyId: string): string {
  return createHash('sha256')
    .update(`timefix:business-cache:${workspaceId.toLowerCase()}:${propertyId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * The edge cache tags of one business's public answers: `business:<opaque id>` (every answer of the business, so a
 * purge of it reaches every place's) and `place:<id>` for each place given. Anything not an id is left out.
 */
export function businessCacheTags(
  workspaceId: string,
  propertyId: string,
  placeIds: readonly string[] = [],
): readonly string[] {
  return [
    ...(isUuid(workspaceId) && isUuid(propertyId) ? [`business:${businessCacheId(workspaceId, propertyId)}`] : []),
    ...[...new Set(placeIds)].filter((id) => isUuid(id)).map((id) => `place:${id}`),
  ];
}

/**
 * The edge cache tag every guest menu answer of one business carries: `menu-ws:<opaque id>`, the business's own opaque
 * id, so the menu's JSON and HTML never show the workspace's id nor tie two businesses together. The reader files
 * under it and every purge (deleting the workspace, the operator closing its business apps) forgets it.
 */
export function menuBusinessCacheTags(workspaceId: string, propertyId: string): readonly string[] {
  return isUuid(workspaceId) && isUuid(propertyId) ? menuWorkspaceTags(businessCacheId(workspaceId, propertyId)) : [];
}

/**
 * The workspace wide tags answers were filed under before each business had its own (until 10 November 2026):
 * `business:<old opaque id>` and, with `menus`, `menu-ws:<old opaque id>`. Purged beside the new ones until 24 November
 * 2026, when no copy filed under them can still be at the edge (a menu keeps a day at most); then this goes. Never
 * filed, so no public answer shows them again.
 */
export function legacyWorkspaceCacheTags(workspaceId: string, menus: boolean): readonly string[] {
  if (!isUuid(workspaceId)) return [];
  const old = createHash('sha256')
    .update(`timefix:business-cache:${workspaceId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
  return [`business:${old}`, ...(menus ? menuWorkspaceTags(old) : [])];
}
