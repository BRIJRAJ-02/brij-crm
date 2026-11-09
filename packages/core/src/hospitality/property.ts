// Properties (spec 0065 H7): the one place a workspace's properties are resolved, listed, added and removed. Every
// workspace has at least one (a trigger on `workspaces` makes the first), and a hospitality call that names none works
// in the first, so a workspace with one property never names it. A property nobody has set up has no name, which is
// what "no business yet" reads as (AC-6512). Adding and removing one is `workspace.manage`'s (AC-6516, AC-6590).
import { HOSPITALITY_LIMITS, type PropertiesView, type PropertySummary } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { auditSetup, hospitalityMember, requireAnyApp } from './gate.ts';

const { businessPages, properties, workspaces } = schema;

/** The refusal for a property that isn't there, or is another workspace's: the same answer either way. */
export const PROPERTY_NOT_FOUND = 'That business doesn’t exist.';

/**
 * The id of the workspace's first property, as part of a statement: by position. A subquery, so filtering or stamping
 * a row by it costs no round trip of its own.
 */
export const currentPropertyRef = (workspaceId: string): SQL =>
  sql`(select p.id from properties p where p.workspace_id = ${workspaceId}::uuid order by p.position, p.id limit 1)`;

/** A property's facts, for the reads that show them. */
export interface CurrentProperty {
  readonly id: string;
  readonly name: string | null;
  readonly kind: string | null;
  readonly description: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly links: unknown;
  readonly look: unknown;
  readonly currency: string | null;
  readonly position: number;
}

const PROPERTY_COLUMNS = {
  id: properties.id,
  name: properties.name,
  kind: properties.kind,
  description: properties.description,
  phone: properties.phone,
  email: properties.email,
  website: properties.website,
  links: properties.links,
  look: properties.look,
  currency: properties.currency,
  position: properties.position,
} as const;

/**
 * Reads the property a call works in: `propertyId` when it names one of this workspace's, else `NOT_FOUND` (another
 * workspace's reads the same as none); left out, the first. Every workspace has a first, so none is a broken database
 * and throws rather than reading as "no business".
 */
export async function currentProperty(
  tx: WorkspaceTx,
  workspaceId: string,
  propertyId?: string,
): Promise<CurrentProperty> {
  if (propertyId !== undefined) {
    const id = checkId(propertyId, PROPERTY_NOT_FOUND);
    const [named] = await tx
      .select(PROPERTY_COLUMNS)
      .from(properties)
      .where(and(eq(properties.workspaceId, workspaceId), eq(properties.id, id)));
    if (named === undefined) throw refuse('NOT_FOUND', PROPERTY_NOT_FOUND);
    return named;
  }
  const [row] = await tx
    .select(PROPERTY_COLUMNS)
    .from(properties)
    .where(eq(properties.workspaceId, workspaceId))
    .orderBy(asc(properties.position), asc(properties.id))
    .limit(1);
  if (row === undefined) throw new Error('The workspace has no property.');
  return row;
}

/**
 * What each of the workspace's properties holds that ties it down (AC-6590): its places, menus, service categories,
 * services and business photos, in one grouped statement however many properties there are.
 */
async function holdsByProperty(tx: WorkspaceTx, workspaceId: string): Promise<ReadonlyMap<string, number>> {
  const result = await tx.execute<{ property_id: string; n: number }>(sql`
    select property_id::text, count(*)::int as n from (
      select property_id from places where workspace_id = ${workspaceId}::uuid
      union all select property_id from menus where workspace_id = ${workspaceId}::uuid
      union all select property_id from service_categories where workspace_id = ${workspaceId}::uuid
      union all select property_id from services where workspace_id = ${workspaceId}::uuid
      union all select property_id from business_photos where workspace_id = ${workspaceId}::uuid
    ) held
    group by property_id`);
  return new Map(result.rows.map((row) => [row.property_id, row.n]));
}

/**
 * Whether a property has a price that a currency change would misread (AC-6519). A dish counts for the property whose
 * menu places it; a dish no menu places yet counts for the first property, as every dish did before there were two.
 */
async function isPriced(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<boolean> {
  const result = await tx.execute<{ priced: boolean }>(sql`
    with own_items as (
      select i.id from menu_items i
      where i.workspace_id = ${workspaceId}::uuid
        and (
          exists (
            select 1 from menu_placements pl
            join menu_sections s on s.workspace_id = pl.workspace_id and s.id = pl.section_id
            join menus m on m.workspace_id = s.workspace_id and m.id = s.menu_id
            where pl.workspace_id = i.workspace_id and pl.item_id = i.id and m.property_id = ${propertyId}::uuid
          )
          or (
            not exists (select 1 from menu_placements pl where pl.workspace_id = i.workspace_id and pl.item_id = i.id)
            and ${propertyId}::uuid = ${currentPropertyRef(workspaceId)}
          )
        )
    )
    select
      exists (
        select 1 from menu_items i join own_items o on o.id = i.id
        where i.workspace_id = ${workspaceId}::uuid and i.price_minor is not null
      ) or exists (
        select 1 from menu_item_sizes z join own_items o on o.id = z.item_id
        where z.workspace_id = ${workspaceId}::uuid
      ) or exists (
        select 1 from service_variants v
        join services s on s.workspace_id = v.workspace_id and s.id = v.service_id
        where v.workspace_id = ${workspaceId}::uuid and s.property_id = ${propertyId}::uuid
          and v.price_type in ('fixed', 'from') and v.price_minor > 0
      ) as priced`);
  return result.rows[0]?.priced ?? false;
}

/**
 * Refuses `IN_USE` when a property's currency would change while it has a priced dish or service (AC-6519): nothing
 * ever converts a price, so a price kept in one currency must never be read in another.
 */
export async function requireCurrencyFree(
  tx: WorkspaceTx,
  workspaceId: string,
  property: CurrentProperty,
  currency: string,
): Promise<void> {
  if ((property.currency ?? 'USD') === currency) return;
  // Both editors' locks, so no dish or service gets a price between this check and the change.
  await lockKey(tx, `menu:${workspaceId}`);
  await lockKey(tx, `services:${workspaceId}`);
  if (await isPriced(tx, workspaceId, property.id)) {
    throw refuseOn(
      'IN_USE',
      'Prices are set in this business’s currency. Remove them first, or keep the currency.',
      'currency',
    );
  }
}

/** The workspace's properties in order, each with what it holds, in the caller's transaction. */
async function readProperties(tx: WorkspaceTx, scope: EngineScope): Promise<PropertiesView> {
  const rows = await tx
    .select(PROPERTY_COLUMNS)
    .from(properties)
    .where(eq(properties.workspaceId, scope.workspaceId))
    .orderBy(asc(properties.position), asc(properties.id));
  const holds = await holdsByProperty(tx, scope.workspaceId);
  const listed: PropertySummary[] = [];
  for (const row of rows) {
    listed.push({
      id: row.id,
      ...(row.name === null ? {} : { name: row.name }),
      ...(row.kind === null ? {} : { kind: row.kind as NonNullable<PropertySummary['kind']> }),
      ...(row.currency === null ? {} : { currency: row.currency }),
      position: row.position,
      holds: holds.get(row.id) ?? 0,
    });
  }
  return { properties: listed, canManage: can(scope.access, 'workspace.manage') };
}

/**
 * The workspace's properties (AC-6516, AC-6517), for the switcher and Settings › Business. Any member reads them while
 * a business app is on: the names are what the sidebar shows, and nothing a guest typed.
 */
export async function listProperties(scope: EngineScope): Promise<PropertiesView> {
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    return readProperties(tx, scope);
  });
}

/** Tells every member's open sidebar that the properties changed: the switcher shows from two (AC-6517). */
async function recordNav(context: WriteContext): Promise<void> {
  const { tx, scope } = context;
  const rows = await tx.execute<{ id: string }>(
    sql`select id from members where workspace_id = ${scope.workspaceId}::uuid and status = 'active'`,
  );
  context.record({ nav: rows.rows.map((row) => row.id) });
}

/**
 * Adds a property (AC-6516): `workspace.manage`, once the first is set up, up to 20 (`LIMIT_REACHED`, AC-6518). `id`
 * is the caller's own, so a retry answers the list with the one property. It starts with no places: the admin adds
 * them on its Business page. Its country is the workspace's.
 */
export async function createProperty(
  scope: EngineScope,
  input: { readonly id: string; readonly name: string; readonly kind: string; readonly currency: string },
  hooks: readonly AfterWrite[] = [],
): Promise<PropertiesView> {
  requirePermission(scope, 'workspace.manage');
  const by = hospitalityMember(scope);
  const id = checkId(input.id, PROPERTY_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await requireAnyApp(tx, scope.workspaceId);
      await lockKey(tx, `properties:${scope.workspaceId}`);
      const rows = await tx
        .select({ id: properties.id, name: properties.name, position: properties.position })
        .from(properties)
        .where(eq(properties.workspaceId, scope.workspaceId))
        .orderBy(asc(properties.position));
      if (rows.some((row) => row.id === id)) return readProperties(tx, scope);
      if (rows[0]?.name === null) throw refuse('CONFLICT', 'Set up your business first.');
      if (rows.length >= HOSPITALITY_LIMITS.properties) {
        throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(HOSPITALITY_LIMITS.properties)} businesses.`);
      }
      // The first free position: a removed property's slot is used again, so twenty always fit.
      const taken = new Set(rows.map((row) => row.position));
      let position = 0;
      while (taken.has(position)) position += 1;
      await tx.insert(properties).values({
        workspaceId: scope.workspaceId,
        id,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        country: sql`(select w.country from ${workspaces} w where w.id = ${scope.workspaceId}::uuid)`,
        position,
        createdByMemberId: by,
        updatedByMemberId: by,
      });
      await auditSetup(tx, scope, 'property.created', { propertyId: id });
      await recordNav(context);
      return readProperties(tx, scope);
    },
    hooks,
  );
  return result;
}

/**
 * Removes a property (AC-6590): `workspace.manage`, only while it holds no place, menu or service, and never the first
 * one left (`IN_USE` for either). A business page it never published goes with it.
 */
export async function removeProperty(
  scope: EngineScope,
  input: { readonly propertyId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<PropertiesView> {
  requirePermission(scope, 'workspace.manage');
  hospitalityMember(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await requireAnyApp(tx, scope.workspaceId);
      await lockKey(tx, `properties:${scope.workspaceId}`);
      const property = await currentProperty(tx, scope.workspaceId, input.propertyId);
      const first = await currentProperty(tx, scope.workspaceId);
      if (first.id === property.id) throw refuse('IN_USE', 'The first business can’t be removed.');
      if (((await holdsByProperty(tx, scope.workspaceId)).get(property.id) ?? 0) > 0) {
        throw refuse('IN_USE', 'Remove this business’s places, menus and services first.');
      }
      const [page] = await tx
        .select({ handle: businessPages.handle })
        .from(businessPages)
        .where(and(eq(businessPages.workspaceId, scope.workspaceId), eq(businessPages.propertyId, property.id)));
      if (page?.handle !== null && page?.handle !== undefined) {
        throw refuse('IN_USE', 'This business has a page address. Remove its page first.');
      }
      await tx
        .delete(businessPages)
        .where(and(eq(businessPages.workspaceId, scope.workspaceId), eq(businessPages.propertyId, property.id)));
      await tx
        .delete(properties)
        .where(and(eq(properties.workspaceId, scope.workspaceId), eq(properties.id, property.id)));
      await auditSetup(tx, scope, 'property.removed', { propertyId: property.id });
      await recordNav(context);
      return readProperties(tx, scope);
    },
    hooks,
  );
  return result;
}

/**
 * Sets the first property's currency when the workspace's changes, while it has no price (AC-6519): until a business
 * sets its own in Settings › Business, its prices follow Settings › Workspace as they always did.
 */
export async function followWorkspaceCurrency(
  tx: WorkspaceTx,
  workspaceId: string,
  currency: string | null,
): Promise<void> {
  if (currency === null) return;
  const first = await currentProperty(tx, workspaceId);
  if ((first.currency ?? 'USD') === currency) return;
  if (await isPriced(tx, workspaceId, first.id)) return;
  await tx
    .update(properties)
    .set({ currency })
    .where(and(eq(properties.workspaceId, workspaceId), eq(properties.id, first.id)));
}
