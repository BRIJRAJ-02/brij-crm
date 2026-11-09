// Setting where a member may work (spec 0065 H7, AC-6594, AC-6597): the member panel's picker reads and writes
// `member_reach` here. `workspace.manage` only, and only by someone who reaches every business, so nobody widens their
// own reach or hands out what they can't see. Owners and admins are always every business: their reach is never
// stored. A change applies on the member's next request (the reach is read in each call's own transaction) and is
// written to History as `member.reach_changed`, counted, never named.
import type { MemberReach, MemberReachView } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit } from '../members/audit.ts';
import { hospitalityMember, requireAnyApp } from './gate.ts';
import { reachOf } from './reach.ts';

const { memberReach, members, places, properties } = schema;

const MEMBER_NOT_FOUND = 'That member doesn’t exist.';

/** Every business, as stored for a member with no rows. */
const EVERYWHERE: MemberReach = { all: true, properties: [], places: [] };

/** The member a reach is about: active, in this workspace, else NOT_FOUND. */
async function targetOf(tx: WorkspaceTx, workspaceId: string, memberId: string) {
  const [row] = await tx
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
  if (row === undefined) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
  return row;
}

/** A member's stored reach: every business with no rows. */
async function storedReach(tx: WorkspaceTx, workspaceId: string, memberId: string): Promise<MemberReach> {
  const rows = await tx
    .select({ propertyId: memberReach.propertyId, placeId: memberReach.placeId })
    .from(memberReach)
    .where(and(eq(memberReach.workspaceId, workspaceId), eq(memberReach.memberId, memberId)))
    .orderBy(asc(memberReach.createdAt), asc(memberReach.id));
  if (rows.length === 0) return EVERYWHERE;
  return {
    all: false,
    properties: rows.flatMap((row) => (row.propertyId === null ? [] : [row.propertyId])),
    places: rows.flatMap((row) => (row.placeId === null ? [] : [row.placeId])),
  };
}

/** The set up businesses in order, each with its places in order: what the picker offers. */
async function businessesOf(tx: WorkspaceTx, workspaceId: string): Promise<MemberReachView['businesses']> {
  const rows = await tx
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(and(eq(properties.workspaceId, workspaceId), isNotNull(properties.name)))
    .orderBy(asc(properties.position), asc(properties.id));
  const placeRows = await tx
    .select({ id: places.id, name: places.name, propertyId: places.propertyId })
    .from(places)
    .where(eq(places.workspaceId, workspaceId))
    .orderBy(asc(places.position), asc(places.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? '',
    places: placeRows.filter((place) => place.propertyId === row.id).map(({ id, name }) => ({ id, name })),
  }));
}

/** The panel's view of one member's reach, in the caller's transaction. */
async function viewOf(tx: WorkspaceTx, workspaceId: string, memberId: string): Promise<MemberReachView> {
  const target = await targetOf(tx, workspaceId, memberId);
  const fixed = target.role === 'owner' || target.role === 'admin';
  return {
    memberId,
    reach: fixed ? EVERYWHERE : await storedReach(tx, workspaceId, memberId),
    fixed,
    businesses: await businessesOf(tx, workspaceId),
  };
}

/** Refuses a reader or writer who doesn't reach every business: they'd see or hand out what they can't reach. */
async function requireEverywhere(tx: WorkspaceTx, scope: EngineScope): Promise<void> {
  if (!(await reachOf(tx, scope)).all) {
    throw refuse('FORBIDDEN', 'Only someone who works in every business can change where others work.');
  }
}

/** One member's reach for their panel (AC-6594): `workspace.manage`, while a business app is on. */
export async function getMemberReach(
  scope: EngineScope,
  input: { readonly memberId: string },
): Promise<MemberReachView> {
  requirePermission(scope, 'workspace.manage');
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await requireEverywhere(tx, scope);
    return viewOf(tx, scope.workspaceId, memberId);
  });
}

/**
 * Sets a member's reach (AC-6594, AC-6597): every business, or the businesses and places chosen (a place whose
 * business is also chosen is dropped, since the business takes it in). `workspace.manage`, by someone who reaches every
 * business. An owner or an admin can't be narrowed (`CONFLICT`). A business or place that isn't there is `NOT_FOUND` on
 * its field. A change is one `member.reach_changed` audit row and one `nav` change event for that member, whose open
 * sidebar reads its businesses again; a repeat writes nothing.
 */
export async function setMemberReach(
  scope: EngineScope,
  input: { readonly memberId: string; readonly reach: MemberReach },
  hooks: readonly AfterWrite[] = [],
): Promise<MemberReachView> {
  requirePermission(scope, 'workspace.manage');
  const by = hospitalityMember(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  const wanted = input.reach;
  const propertyIds = [...new Set(wanted.properties.map((id) => checkId(id, 'That business doesn’t exist.')))];
  const placeIds = [...new Set(wanted.places.map((id) => checkId(id, 'That place doesn’t exist.')))];
  if (!wanted.all && propertyIds.length === 0 && placeIds.length === 0) {
    throw inputInvalid('reach', 'Pick at least one business or place.');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const ws = scope.workspaceId;
      await requireAnyApp(tx, ws);
      await requireEverywhere(tx, scope);
      // The properties lock first, as removing a business takes it, so a business can't go while a reach names it.
      await lockKey(tx, `properties:${ws}`);
      await lockKey(tx, `reach:${ws}:${memberId}`);
      const target = await targetOf(tx, ws, memberId);
      if (!wanted.all && (target.role === 'owner' || target.role === 'admin')) {
        throw refuse('CONFLICT', 'Owners and admins work in every business.');
      }
      const businesses = await businessesOf(tx, ws);
      const known = new Set(businesses.map((business) => business.id));
      if (propertyIds.some((id) => !known.has(id))) {
        throw refuseOn('NOT_FOUND', 'That business doesn’t exist.', 'reach');
      }
      const placeOwner = new Map(
        businesses.flatMap((business) => business.places.map((place) => [place.id, business.id] as const)),
      );
      if (placeIds.some((id) => !placeOwner.has(id))) throw refuseOn('NOT_FOUND', 'That place doesn’t exist.', 'reach');
      const whole = new Set(propertyIds);
      const next: MemberReach = wanted.all
        ? EVERYWHERE
        : {
            all: false,
            properties: propertyIds,
            places: placeIds.filter((id) => !whole.has(placeOwner.get(id) ?? '')),
          };
      const before = await storedReach(tx, ws, memberId);
      const same =
        before.all === next.all &&
        new Set(before.properties).size === next.properties.length &&
        next.properties.every((id) => before.properties.includes(id)) &&
        before.places.length === next.places.length &&
        next.places.every((id) => before.places.includes(id));
      if (same) return viewOf(tx, ws, memberId);
      await tx.delete(memberReach).where(and(eq(memberReach.workspaceId, ws), eq(memberReach.memberId, memberId)));
      const rows = [
        ...next.properties.map((propertyId) => ({ workspaceId: ws, memberId, propertyId, createdByMemberId: by })),
        ...next.places.map((placeId) => ({ workspaceId: ws, memberId, placeId, createdByMemberId: by })),
      ];
      if (rows.length > 0) await tx.insert(memberReach).values(rows);
      await writeAudit(tx, ws, scope.actor, {
        action: 'member.reach_changed',
        targetType: 'member',
        targetId: memberId,
        before: { all: before.all, properties: before.properties, places: before.places },
        after: { all: next.all, properties: next.properties, places: next.places },
      });
      // Their sidebar's switcher and ⌘K list read the businesses again; every call reads the reach anew anyway.
      context.record({ nav: [memberId] });
      return viewOf(tx, ws, memberId);
    },
    hooks,
  );
  return result;
}
