// A workspace's objects for the app's navigation (spec 0005): the sidebar's
// Records section and the object pages read this list. Read only, through the
// scope the access door made.
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { ObjectSummary } from '@crm/contracts';
import { HUES, OBJECT_ICONS, type Hue, type ObjectIcon } from '@crm/contracts/values';
import { schema } from '@crm/db';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { objectLevel } from '../access/policy.ts';

const { objects } = schema;

const isIcon = (icon: string): icon is ObjectIcon => (OBJECT_ICONS as readonly string[]).includes(icon);
const isHue = (hue: string): hue is Hue => (HUES as readonly string[]).includes(hue);

/**
 * The workspace's live (unarchived) objects, in the order they were made, so
 * the standard ones come in template order (People first), each with what the
 * caller may do with its records (spec 0009, AC-140): an object they can't
 * see is left out. The engine checks
 * an object's icon and hue when it is written; a row that fails them here is
 * a broken invariant and throws.
 */
export async function listObjects(scope: EngineScope): Promise<ObjectSummary[]> {
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select({
        id: objects.id,
        apiSlug: objects.apiSlug,
        singularName: objects.singularName,
        pluralName: objects.pluralName,
        icon: objects.icon,
        hue: objects.hue,
        standardKey: objects.standardKey,
        primaryAttributeId: objects.primaryAttributeId,
      })
      .from(objects)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(and(eq(objects.workspaceId, scope.workspaceId), isNull(objects.archivedAt)))
      .orderBy(asc(objects.createdAt), asc(objects.id)),
  );
  return rows.flatMap(({ icon, hue, standardKey, primaryAttributeId, ...row }) => {
    const access = objectLevel(scope.access, row.id);
    if (access === 'none') return [];
    if (!isIcon(icon) || !isHue(hue)) throw new Error(`Object ${row.id} has an icon or hue outside the curated sets.`);
    return {
      ...row,
      access,
      icon,
      hue,
      ...(standardKey === null ? {} : { standardKey }),
      ...(primaryAttributeId === null ? {} : { primaryAttributeId }),
    };
  });
}
