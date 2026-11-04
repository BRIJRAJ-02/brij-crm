// The edge cache tags a business's public answers are filed under (spec 0066, Public routes): one for the business,
// one per place. The business's tag never carries its workspace's id, which the public answer would otherwise show
// to anybody (the page's JSON lists its tags for the handle shell to file itself under): it is an opaque id instead,
// the first 128 bits of SHA-256 over a fixed label and the workspace's id. Stable, so every writer purges the same tag
// the reader filed, and one way, so the tag says nothing about which workspace it is. Place ids are already public.
import { createHash } from 'node:crypto';
import { isUuid } from '../engine/ids.ts';

/** The opaque id standing for a workspace's business in its public cache tags: 32 hex digits. */
export function businessCacheId(workspaceId: string): string {
  return createHash('sha256').update(`timefix:business-cache:${workspaceId.toLowerCase()}`).digest('hex').slice(0, 32);
}

/**
 * The edge cache tags of a business's public answers: `business:<opaque id>` (every answer of the business, so a
 * purge of it reaches every place's) and `place:<id>` for each place given. Anything not an id is left out.
 */
export function businessCacheTags(workspaceId: string, placeIds: readonly string[] = []): readonly string[] {
  return [
    ...(isUuid(workspaceId) ? [`business:${businessCacheId(workspaceId)}`] : []),
    ...[...new Set(placeIds)].filter((id) => isUuid(id)).map((id) => `place:${id}`),
  ];
}
