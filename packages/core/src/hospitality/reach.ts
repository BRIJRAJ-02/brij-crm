// A member's reach (spec 0065 H7, AC-6594 to AC-6597): which businesses (properties) and places they may work in, on
// top of their role. This is the one function every hospitality read and write resolves its business and places
// through: `reachOf` reads it in the call's own transaction (so a change applies on the member's next request), and
// `propertyInReach`, `requirePlaceInReach` and `placeReachSql` narrow by it. A place outside reach answers exactly as a
// place that doesn't exist (`NOT_FOUND`, the same sentence), and so does a business outside it. Hiding a screen is
// never the gate.
//
// No rows means every business. Owners and admins are always every business, whatever is stored. A member reached to
// a whole business reaches every place in it, including ones added later; one reached to some places of a business
// sees that business (its name in the switcher, its menus and services to read) and works only in those places: a
// change to the whole business (its menus, services, staff, page or settings) needs the whole business.
//
// Reach is a member's: the system and the public doors (a guest's page, a form, a booking page) are never narrowed
// here, since their own doors already name the one place or page they act for.
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { currentProperty, PROPERTY_NOT_FOUND, type CurrentProperty } from './property.ts';

const { properties } = schema;

/** The refusal for a place outside reach: word for word the one for a place that doesn't exist. */
export const PLACE_OUT_OF_REACH = 'That place doesn’t exist.';

/** The refusal for a change to a whole business by someone who works in only some of its places. */
export const WHOLE_BUSINESS_ONLY =
  'You work in some of this business’s places only. Ask an admin to change where you work.';

/** Where a member may work: everywhere, or the businesses and places their stored reach names. */
export type Reach =
  | { readonly all: true }
  | {
      readonly all: false;
      /** Businesses reached whole: every place in them, now and later. */
      readonly whole: ReadonlySet<string>;
      /** Businesses the member sees: the whole ones, and those of each place they reach. */
      readonly seen: ReadonlySet<string>;
      /** Every place they reach: the places of whole businesses, and the places named one by one. */
      readonly places: ReadonlySet<string>;
    };

/** Reach that limits nothing. */
export const ALL_REACH: Reach = Object.freeze({ all: true });

/** Reach that takes in nothing: for a principal that has no reach of its own. */
const NO_REACH: Reach = Object.freeze({
  all: false,
  whole: new Set<string>(),
  seen: new Set<string>(),
  places: new Set<string>(),
});

/**
 * Reads the acting member's reach in the call's transaction (AC-6595), in one statement: their stored rows, each
 * business row with its places and each place row with its business. Owners, admins, the system and the public
 * doors reach everything; a member with no rows does too.
 */
export async function reachOf(tx: WorkspaceTx, scope: EngineScope): Promise<Reach> {
  const { principal } = scope.access;
  switch (principal.kind) {
    // The system and the public doors (a form, a booking or reservation page) name their one place or page already.
    case 'system':
    case 'form':
    case 'booking':
      return ALL_REACH;
    // No business permission reaches these today (an API key can't hold one, a partner and an email link hold
    // none); should one ever, it reaches nothing until it is given a reach of its own: fail closed.
    case 'api_key':
    case 'partner':
    case 'email_link':
      return NO_REACH;
    case 'member':
      break;
    default: {
      const unknown: never = principal;
      return unknown;
    }
  }
  if (principal.role === 'owner' || principal.role === 'admin') return ALL_REACH;
  const result = await tx.execute<{
    property_id: string | null;
    place_id: string | null;
    place_property: string | null;
  }>(
    sql`
      select r.property_id::text, p.id::text as place_id, p.property_id::text as place_property
      from member_reach r
      left join places p on p.workspace_id = r.workspace_id
        and (p.id = r.place_id or p.property_id = r.property_id)
      where r.workspace_id = ${scope.workspaceId}::uuid and r.member_id = ${principal.memberId}::uuid`,
  );
  if (result.rows.length === 0) return ALL_REACH;
  const whole = new Set<string>();
  const seen = new Set<string>();
  const places = new Set<string>();
  for (const row of result.rows) {
    if (row.property_id !== null) {
      whole.add(row.property_id);
      seen.add(row.property_id);
    }
    if (row.place_id !== null) places.add(row.place_id);
    if (row.place_property !== null) seen.add(row.place_property);
  }
  return { all: false, whole, seen, places };
}

/**
 * A statement's condition that the member row aliased `m` reaches `placeId` (AC-6596): an owner or admin, a member
 * with no stored reach, or one whose reach names the place or its business. For what goes to members by place without
 * a call of theirs (a new reservation's email), so a member narrowed away hears nothing of that place's guests.
 */
export function memberReachesPlaceSql(placeId: string): SQL {
  return sql`(
    m.role in ('owner', 'admin')
    or not exists (select 1 from member_reach r where r.workspace_id = m.workspace_id and r.member_id = m.id)
    or exists (
      select 1 from member_reach r
      join places p on p.workspace_id = r.workspace_id and p.id = ${placeId}::uuid
      where r.workspace_id = m.workspace_id and r.member_id = m.id
        and (r.place_id = p.id or r.property_id = p.property_id)
    )
  )`;
}

/** Whether `reach` takes in a place. */
export const reachesPlace = (reach: Reach, placeId: string): boolean => reach.all || reach.places.has(placeId);

/** Whether `reach` sees a business (`see`), or takes in all of it (`whole`). */
export const reachesProperty = (reach: Reach, propertyId: string, need: 'see' | 'whole' = 'see'): boolean =>
  reach.all || (need === 'whole' ? reach.whole : reach.seen).has(propertyId);

/** Keeps the ids `reach` takes in, in their order. */
export const placesInReach = <T extends string>(reach: Reach, ids: readonly T[]): T[] =>
  reach.all ? [...ids] : ids.filter((id) => reach.places.has(id));

/**
 * A statement's condition on a place id column: nothing when `reach` is everything, else the places it takes in (a
 * reach with none matches nothing). For lists, counts and joins, so what a member can't reach is never read.
 */
export function placeReachSql(reach: Reach, column: AnyColumn | SQL): SQL | undefined {
  if (reach.all) return undefined;
  if (reach.places.size === 0) return sql`false`;
  return inArray(sql`${column}`, [...reach.places]);
}

/** The same, on a business id column, for the businesses a member sees. */
export function propertyReachSql(reach: Reach, column: AnyColumn | SQL): SQL | undefined {
  if (reach.all) return undefined;
  if (reach.seen.size === 0) return sql`false`;
  return inArray(sql`${column}`, [...reach.seen]);
}

/**
 * Refuses `NOT_FOUND`, as for a place that doesn't exist, unless `reach` takes in `placeId` (AC-6595). Answers the
 * reach, so a call that goes on to list can narrow by it without reading it again.
 */
export async function requirePlaceInReach(tx: WorkspaceTx, scope: EngineScope, placeId: string): Promise<Reach> {
  const reach = await reachOf(tx, scope);
  if (!reachesPlace(reach, placeId)) throw refuse('NOT_FOUND', PLACE_OUT_OF_REACH);
  return reach;
}

/**
 * The business a member's hospitality call works in (AC-6595): `currentProperty` behind the reach. Named, one outside
 * reach answers `NOT_FOUND` as one that doesn't exist; left out, it is the first business the member sees. A change to
 * a whole business (`need: 'whole'`) by someone who works in only some of its places is `FORBIDDEN`: they see it.
 */
export async function propertyInReach(
  tx: WorkspaceTx,
  scope: EngineScope,
  propertyId?: string,
  need: 'see' | 'whole' = 'see',
  known?: Reach,
): Promise<CurrentProperty> {
  const reach = known ?? (await reachOf(tx, scope));
  if (reach.all) return currentProperty(tx, scope.workspaceId, propertyId);
  let id = propertyId === undefined ? undefined : checkId(propertyId, PROPERTY_NOT_FOUND);
  if (id === undefined) {
    const [first] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.workspaceId, scope.workspaceId), inArray(properties.id, [...reach.seen])))
      .orderBy(asc(properties.position), asc(properties.id))
      .limit(1);
    if (first === undefined) throw refuse('NOT_FOUND', PROPERTY_NOT_FOUND);
    id = first.id;
  }
  if (!reach.seen.has(id)) throw refuse('NOT_FOUND', PROPERTY_NOT_FOUND);
  if (need === 'whole' && !reach.whole.has(id)) throw refuse('FORBIDDEN', WHOLE_BUSINESS_ONLY);
  return currentProperty(tx, scope.workspaceId, id);
}
