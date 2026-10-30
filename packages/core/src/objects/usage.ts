// How much of each limit a workspace uses (spec 0012, AC-243): the settings
// meters read it. The counts come from the one limits module, the same the
// checks make, filtered through the caller's access the way `listObjects` is:
// an object they can't see is absent with its count, a per object count
// counts only the attributes they can see, and the custom object total is
// answered only to `schema.manage`.
import { eq, sql } from 'drizzle-orm';
import type { Usage } from '@crm/contracts';
import { schema } from '@crm/db';
import { countAttributesByObject, countCustomObjects, limitsOf, objectAttributeRows } from '../engine/limits.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { can, isOpen, objectLevel, recordRule } from '../access/policy.ts';
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
    // Every attribute visible (the open policy): Postgres counts them. Under field rules, row by row.
    if (isOpen(scope.access)) {
      for (const [objectId, used] of await countAttributesByObject(tx, scope)) {
        if (counts.has(objectId)) counts.set(objectId, used);
      }
    } else {
      for (const row of await objectAttributeRows(tx, scope)) {
        if (row.objectId === null) continue;
        const count = counts.get(row.objectId);
        if (count === undefined) continue;
        if (attributeVisible(scope.access, { id: row.id, objectId: row.objectId, listId: null })) {
          counts.set(row.objectId, count + 1);
        }
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

/**
 * How many live records each object the caller can see holds, in one grouped, index only count (`records_live`)
 * rather than one `records.count` per object: Settings › Objects' Records column (flow pass, 30 October 2026). An
 * object under a record rule is left out, since the stored rows count records the caller may not see (its own
 * `records.count` counts those through the capped path), and so is one the caller can't see at all. Bounded at 3
 * seconds; a read only, it writes nothing.
 */
export async function countRecordsByObject(scope: EngineScope): Promise<Readonly<Record<string, number>>> {
  return inWorkspace(scope, async (tx) => {
    await tx.execute(sql`set local statement_timeout = '3s'`);
    const rows = await tx.execute<{ object_id: string; n: number }>(sql`
      select object_id::text as object_id, count(*)::int as n
      from records
      where workspace_id = ${scope.workspaceId} and deleted_at is null
      group by object_id
    `);
    const workspaceObjects = await tx
      .select({ id: objects.id })
      .from(objects)
      .where(eq(objects.workspaceId, scope.workspaceId));
    const counted = new Map(rows.rows.map((row) => [row.object_id, row.n]));
    return Object.fromEntries(
      workspaceObjects
        .filter(
          (object) =>
            objectLevel(scope.access, object.id) !== 'none' && recordRule(scope.access, object.id) === undefined,
        )
        .map((object) => [object.id, counted.get(object.id) ?? 0]),
    );
  });
}
