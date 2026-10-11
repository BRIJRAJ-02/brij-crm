// How much of each limit a workspace uses (spec 0012, AC-243): the settings
// meters read it. The counts come from the one limits module, the same the
// checks make, filtered through the caller's access the way `listObjects` is:
// an object they can't see is absent with its count, a per object count
// counts only the attributes they can see, and the custom object total is
// answered only to `schema.manage`.
import { eq } from 'drizzle-orm';
import type { Usage } from '@crm/contracts';
import { schema } from '@crm/db';
import { countCustomObjects, limitsOf, objectAttributeRows } from '../engine/limits.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { can, objectLevel } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

const { objects } = schema;

/** The workspace's usage of its limits, as the caller may see it. */
export async function getUsage(scope: EngineScope): Promise<Usage> {
  const limits = limitsOf(scope);
  const canManage = can(scope.access, 'schema.manage');
  return inWorkspace(scope, async (tx) => {
    const workspaceObjects = await tx
      .select({ id: objects.id })
      .from(objects)
      .where(eq(objects.workspaceId, scope.workspaceId));
    const visible = workspaceObjects.filter((object) => objectLevel(scope.access, object.id) !== 'none');
    const counts = new Map(visible.map((object) => [object.id, 0]));
    for (const row of await objectAttributeRows(tx, scope)) {
      if (row.objectId === null) continue;
      const count = counts.get(row.objectId);
      if (count === undefined) continue;
      if (attributeVisible(scope.access, { id: row.id, objectId: row.objectId, listId: null })) {
        counts.set(row.objectId, count + 1);
      }
    }
    const customObjects = canManage ? await countCustomObjects(tx, scope) : undefined;
    return {
      ...(customObjects === undefined ? {} : { customObjects: { used: customObjects, limit: limits.customObjects } }),
      attributes: Object.fromEntries(
        [...counts].map(([objectId, used]) => [objectId, { used, limit: limits.attributesPerParent }]),
      ),
      optionsPerAttribute: limits.optionsPerAttribute,
    };
  });
}
