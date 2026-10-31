// Page and rotation editors (spec 0037, AC-1331, AC-1332): Sharing on a booking page or a rotation. `listEditors`
// answers whoever may change the resource (`booking.admin`, its editors, and for a page its owner and Manage over
// them); `setEditors` replaces them and is `booking.admin`'s alone, since an editor changes everything on a resource
// except its editors. At most 20 per resource (409 `EDITOR_LIMIT`), each an active member who isn't a guest. Each
// change writes one `editors.changed` audit row, and each person added or removed by someone else is emailed.
// Editors are settings, as pages and rotations are: no outbox row; screens read them again.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  EDITORS_MAX,
  PERMISSIONS,
  type EditorResource,
  type EditorsView,
  type ListEditorsInput,
  type SetEditorsInput,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { pageForEditors } from '../booking/pages.ts';
import { queueEmail } from '../emails/queue.ts';
import { newId } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { mayChangeRotation } from '../rotation/rotations.ts';

const { members, rotations, schedulingEditors, workspaces } = schema;

const ROTATION_MISSING = 'That rotation doesn’t exist any more.';
const LIMIT_MESSAGE = `A page or rotation can have at most ${String(EDITORS_MAX)} editors.`;
const NOT_A_TEAMMATE = 'Pick active teammates who aren’t guests.';

/** The member the scope acts for, or undefined (a key, the system). */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

/**
 * The resource, live, as the reader may change it, by its name: a page through the page's own check (NOT_FOUND
 * otherwise), a rotation through `mayChangeRotation` (`booking.admin` or an editor; FORBIDDEN to a member in it).
 */
async function resourceOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  resourceType: EditorResource,
  resourceId: string,
  lock: boolean,
): Promise<{ readonly id: string; readonly name: string }> {
  if (resourceType === 'booking_page') {
    const page = await pageForEditors(tx, scope, resourceId, lock);
    return { id: page.id, name: page.title };
  }
  const query = tx
    .select({ id: rotations.id, name: rotations.name })
    .from(rotations)
    .where(and(eq(rotations.id, resourceId), isNull(rotations.deletedAt)));
  const [row] = lock ? await query.for('no key update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', ROTATION_MISSING);
  await mayChangeRotation(tx, scope, row.id);
  return row;
}

/** A resource's editors by name (members only until teams arrive), and whether the reader may change them. */
async function editorsOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  resourceType: EditorResource,
  resourceId: string,
): Promise<EditorsView> {
  const rows = await tx
    .select({ id: members.id, name: members.name })
    .from(schedulingEditors)
    .innerJoin(
      members,
      and(eq(members.workspaceId, schedulingEditors.workspaceId), eq(members.id, schedulingEditors.memberId)),
    )
    .where(and(eq(schedulingEditors.resourceType, resourceType), eq(schedulingEditors.resourceId, resourceId)))
    .orderBy(asc(members.name), asc(members.id));
  return { editors: rows, canChange: can(scope.access, 'booking.admin') };
}

/**
 * A page's or rotation's editors (AC-1331): for anyone who may change it; a resource they may not see answers as
 * absent (NOT_FOUND).
 */
export async function listEditors(
  scope: EngineScope,
  input: Pick<ListEditorsInput, 'resourceType' | 'resourceId'>,
): Promise<EditorsView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const resource = await resourceOf(tx, scope, input.resourceType, input.resourceId, false);
    return editorsOf(tx, scope, input.resourceType, resource.id);
  });
}

/**
 * Replaces a page's or rotation's editors (AC-1331): `booking.admin` only. Each named once, an active member who
 * isn't a guest (CONFIG_INVALID on `memberIds.<n>` otherwise), at most 20 (409 `EDITOR_LIMIT`). Under the
 * resource's row lock; one audit row naming who was added and removed when anything changed; each person added by
 * someone else is emailed.
 */
export async function setEditors(
  scope: EngineScope,
  input: Pick<SetEditorsInput, 'resourceType' | 'resourceId' | 'memberIds'>,
): Promise<EditorsView> {
  requirePermission(scope, 'booking.admin');
  const actor = memberOf(scope);
  if (actor === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.admin'].message);
  const wanted = [...new Set(input.memberIds)];
  if (wanted.length !== input.memberIds.length) {
    throw refuseOn('CONFIG_INVALID', 'Add each person once.', 'memberIds');
  }
  if (wanted.length > EDITORS_MAX) throw refuse('EDITOR_LIMIT', LIMIT_MESSAGE);
  return inWorkspace(scope, async (tx) => {
    const resource = await resourceOf(tx, scope, input.resourceType, input.resourceId, true);
    const before = await tx
      .select({ memberId: schedulingEditors.memberId })
      .from(schedulingEditors)
      .where(
        and(eq(schedulingEditors.resourceType, input.resourceType), eq(schedulingEditors.resourceId, resource.id)),
      );
    const held = new Set(before.flatMap((row) => (row.memberId === null ? [] : [row.memberId])));
    const added = wanted.filter((memberId) => !held.has(memberId));
    const removed = [...held].filter((memberId) => !wanted.includes(memberId));
    if (added.length > 0) {
      const found = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(inArray(members.id, added), eq(members.status, 'active'), sql`${members.role}::text <> 'guest'`));
      const ok = new Set(found.map((row) => row.id));
      const index = input.memberIds.findIndex((memberId) => added.includes(memberId) && !ok.has(memberId));
      if (index >= 0) throw refuseOn('CONFIG_INVALID', NOT_A_TEAMMATE, `memberIds.${String(index)}`);
    }
    if (removed.length > 0) {
      await tx
        .delete(schedulingEditors)
        .where(
          and(
            eq(schedulingEditors.resourceType, input.resourceType),
            eq(schedulingEditors.resourceId, resource.id),
            inArray(schedulingEditors.memberId, removed),
          ),
        );
    }
    if (added.length > 0) {
      const by = actorRow(scope.actor);
      await tx.insert(schedulingEditors).values(
        added.map((memberId) => ({
          workspaceId: scope.workspaceId,
          resourceType: input.resourceType,
          resourceId: resource.id,
          memberId,
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })),
      );
    }
    if (added.length > 0 || removed.length > 0) {
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'editors.changed',
        targetType: input.resourceType,
        targetId: resource.id,
        before: { name: resource.name },
        after: { name: resource.name, added, removed },
      });
      await tellChanged(tx, scope, input.resourceType, resource, actor, { added, removed });
    }
    return editorsOf(tx, scope, input.resourceType, resource.id);
  });
}

/**
 * "You can now edit <name>" to each person added, and "You can no longer edit <name>" to each person removed, but the
 * one who changed it (AC-1331). Ids only in the key.
 */
async function tellChanged(
  tx: WorkspaceTx,
  scope: EngineScope,
  resourceType: EditorResource,
  resource: { readonly id: string; readonly name: string },
  actor: string,
  changed: { readonly added: readonly string[]; readonly removed: readonly string[] },
): Promise<void> {
  const told = [
    ...changed.added.map((memberId) => ({ memberId, removed: false })),
    ...changed.removed.map((memberId) => ({ memberId, removed: true })),
  ].filter((each) => each.memberId !== actor);
  if (told.length === 0) return;
  const [place] = await tx
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, scope.workspaceId));
  const [by] = await tx.select({ name: members.name }).from(members).where(eq(members.id, actor));
  if (place === undefined || by === undefined) return;
  const path =
    resourceType === 'rotation'
      ? `/w/${place.slug}/bookings/round-robin`
      : `/w/${place.slug}/captures/links/${resource.id}`;
  for (const each of told) {
    await queueEmail(tx, {
      kind: 'editor_added',
      ids: [resource.id, each.memberId, newId()],
      to: { memberId: each.memberId },
      params: {
        resourceType,
        resourceName: resource.name,
        byName: by.name,
        path,
        ...(each.removed ? { removed: true } : {}),
      },
    });
  }
}

/** A removed member edits nothing any more (spec 0031, AC-814 widened): their editor rows go with them. */
export const editorsRemoval: RemovalEffect = {
  feature: 'page and rotation editors',
  constraints: ['scheduling_editors_member'],
  run: async (context, memberId) => {
    await context.tx
      .delete(schedulingEditors)
      .where(
        and(eq(schedulingEditors.workspaceId, context.scope.workspaceId), eq(schedulingEditors.memberId, memberId)),
      );
  },
};
