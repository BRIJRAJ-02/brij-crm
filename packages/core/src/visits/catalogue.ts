// Settings › Services (spec 0066 B1, AC-6610, AC-6613): the catalogue a salon or clinic books from. Categories in
// order, services in order inside each, each service whole with its variants (length, price and how it reads, time
// before), the places that offer it, who does it, what it needs, its time after and whether it books online.
// `services.manage` only, checked before any input is read, and only while Appointments is installed. Changes are
// instant (the catalogue is not a public page: 0068 drafts pages, not settings) and audited; each stores one `visits`
// change event naming the places it touched, so an open catalogue, team or day reads again, and purges those places'
// offered times. Table seating's own "Table" service (capacity `party`) is that app's, never listed here.
import {
  CATALOGUE_LIMITS,
  serviceSlug,
  type CatalogueService,
  type CatalogueView,
  type PlaceHours,
  type ServiceFields,
  type ServiceNeed,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId, newId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { auditSetup, hospitalityMember, requireApp } from '../hospitality/gate.ts';
import type { SlotCache } from './book.ts';
import { appointmentsSetup } from './readiness.ts';
import { currentProperty, currentPropertyRef } from '../hospitality/property.ts';

/** The refusal for a service that isn't there (or is Table seating's). */
export const SERVICE_MISSING = 'That service doesn’t exist.';
/** The refusal for a category that isn't there. */
export const CATEGORY_MISSING = 'That category doesn’t exist.';

/** What a catalogue write takes besides its input: the offered times cache it purges. */
export interface CatalogueDeps {
  readonly slotCache?: SlotCache | undefined;
}

const L = CATALOGUE_LIMITS;

/** Every place of the workspace, in order, as the catalogue and the team name them. */
export async function readServicePlaces(tx: WorkspaceTx): Promise<CatalogueView['places']> {
  const rows = (
    await tx.execute<{ id: string; name: string; time_zone: string; hours: PlaceHours }>(sql`
      select id::text, name, time_zone, hours from places order by position, id
    `)
  ).rows;
  return rows.map((row) => ({ id: row.id, name: row.name, timeZone: row.time_zone, hours: row.hours }));
}

/** The catalogue as the screen shows it, read in the caller's transaction. */
export async function readCatalogue(tx: WorkspaceTx): Promise<CatalogueView> {
  const categories = (
    await tx.execute<{ id: string; name: string }>(sql`
      select id::text, name from service_categories order by position, id
    `)
  ).rows;
  const services = (
    await tx.execute<{
      id: string;
      name: string;
      description: string | null;
      category_id: string | null;
      buffer_after_min: number;
      online: boolean;
      staff_rule: 'all' | 'chosen';
      cancel_note: string | null;
      archived: boolean;
    }>(sql`
      select id::text, name, description, category_id::text, buffer_after_min, online, staff_rule, cancel_note,
        archived_at is not null as archived
      from services where capacity_mode = 'one' and staff_rule <> 'none'
      order by position, id
    `)
  ).rows;
  const variants = (
    await tx.execute<{
      id: string;
      service_id: string;
      name: string;
      minutes: number;
      price_minor: string | number;
      price_type: CatalogueService['variants'][number]['priceType'];
      buffer_before_min: number;
    }>(sql`
      select id::text, service_id::text, name, minutes, price_minor, price_type, buffer_before_min
      from service_variants where archived_at is null order by position, id
    `)
  ).rows;
  const offered = (
    await tx.execute<{ service_id: string; place_id: string }>(sql`
      select service_id::text, place_id::text from service_places
    `)
  ).rows;
  const chosen = (
    await tx.execute<{ service_id: string; staff_id: string }>(sql`
      select service_id::text, staff_id::text from service_staff
    `)
  ).rows;
  const needs = (
    await tx.execute<{ service_id: string; kind: string | null; count: number; resource_id: string | null }>(sql`
      select service_id::text, kind, count, resource_id::text from service_resources order by id
    `)
  ).rows;
  const places = await readServicePlaces(tx);
  const staff = (
    await tx.execute<{ id: string; name: string; place_ids: string[] | null }>(sql`
      select st.id::text, st.name,
        array(select sp.place_id::text from staff_places sp where sp.workspace_id = st.workspace_id and sp.staff_id = st.id)
          as place_ids
      from staff st where st.archived_at is null order by st.position, st.id
    `)
  ).rows;
  const resources = (
    await tx.execute<{ id: string; place_id: string; label: string; kind: CatalogueView['resources'][number]['kind'] }>(
      sql`select id::text, place_id::text, label, kind from resources where archived_at is null order by position, id`,
    )
  ).rows;
  const [facts] = (
    await tx.execute<{ currency: string | null; kind: string | null }>(sql`
      select currency, kind from properties order by position, id limit 1
    `)
  ).rows;
  const group = <Row extends { service_id: string }>(rows: readonly Row[]) => {
    const map = new Map<string, Row[]>();
    for (const row of rows) map.set(row.service_id, [...(map.get(row.service_id) ?? []), row]);
    return map;
  };
  const variantsOf = group(variants);
  const placesOf = group(offered);
  const staffOf = group(chosen);
  const needsOf = group(needs);
  return {
    categories,
    services: services.map((row): CatalogueService => ({
      id: row.id,
      name: row.name,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.category_id === null ? {} : { categoryId: row.category_id }),
      bufferAfterMin: row.buffer_after_min,
      online: row.online,
      staffRule: row.staff_rule,
      staffIds: row.staff_rule === 'chosen' ? (staffOf.get(row.id) ?? []).map((each) => each.staff_id) : [],
      placeIds: (placesOf.get(row.id) ?? []).map((each) => each.place_id),
      needs: (needsOf.get(row.id) ?? []).map((each): ServiceNeed =>
        each.resource_id === null
          ? { kind: each.kind as Extract<ServiceNeed, { kind: unknown }>['kind'], count: each.count }
          : { resourceId: each.resource_id },
      ),
      variants: (variantsOf.get(row.id) ?? []).map((each) => ({
        id: each.id,
        name: each.name,
        minutes: each.minutes,
        priceMinor: Number(each.price_minor),
        priceType: each.price_type,
        bufferBeforeMin: each.buffer_before_min,
      })),
      ...(row.cancel_note === null ? {} : { cancelNote: row.cancel_note }),
      archived: row.archived,
    })),
    places,
    staff: staff.map((row) => ({ id: row.id, name: row.name, placeIds: row.place_ids ?? [] })),
    resources: resources.map((row) => ({ id: row.id, placeId: row.place_id, label: row.label, kind: row.kind })),
    ...(facts?.currency === null || facts?.currency === undefined ? {} : { currency: facts.currency }),
    ...(facts?.kind === null || facts?.kind === undefined ? {} : { businessKind: facts.kind }),
    setup: await appointmentsSetup(tx, places),
  };
}

/** The ids of every place, for a write that touches them all (a category's name shows wherever its services do). */
async function allPlaceIds(tx: WorkspaceTx): Promise<string[]> {
  return (await tx.execute<{ id: string }>(sql`select id::text from places`)).rows.map((row) => row.id);
}

/** The places that offer these services now. */
async function placesOfServices(tx: WorkspaceTx, serviceIds: readonly string[]): Promise<string[]> {
  if (serviceIds.length === 0) return [];
  return (
    await tx.execute<{ place_id: string }>(sql`
      select distinct place_id::text from service_places
      where service_id = any(${`{${serviceIds.join(',')}}`}::uuid[])
    `)
  ).rows.map((row) => row.place_id);
}

/**
 * Runs one catalogue write: the permission, the member, the app, the work, its audit line, one `visits` event naming
 * the places it touched, and their offered times purged once it commits. Answers the catalogue as it now stands.
 */
async function catalogueWrite(
  scope: EngineScope,
  deps: CatalogueDeps,
  hooks: readonly AfterWrite[],
  what: string,
  work: (
    context: WriteContext,
    by: string,
  ) => Promise<{ readonly places: readonly string[]; readonly ids?: Record<string, string> }>,
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const by = hospitalityMember(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await requireApp(tx, scope.workspaceId, 'appointments');
      await lockKey(tx, `services:${scope.workspaceId}`);
      const done = await work(context, by);
      await auditSetup(tx, scope, what, done.ids ?? {});
      if (done.places.length > 0) context.record({ visits: [...done.places] });
      return { view: await readCatalogue(tx), places: done.places };
    },
    hooks,
  );
  for (const placeId of result.places) deps.slotCache?.purge(placeId);
  return result.view;
}

/** Settings › Services: the catalogue, for `services.manage` while Appointments is installed. */
export async function getCatalogue(scope: EngineScope): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'appointments');
    return readCatalogue(tx);
  });
}

/** Adds a category (up to 50, `LIMIT_REACHED` past it) or renames one; `id` is the caller's, so a retry makes one. */
export async function saveServiceCategory(
  scope: EngineScope,
  input: { readonly id: string; readonly name: string },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.id, CATEGORY_MISSING);
  const name = input.name.trim();
  if (name === '' || name.length > L.categoryNameMax) throw inputInvalid('name', 'Name the category.');
  return catalogueWrite(scope, deps, hooks, 'service_category.saved', async ({ tx }, by) => {
    const renamed = await tx.execute(sql`
      update service_categories set name = ${name}, updated_at = now(), updated_by_member_id = ${by}::uuid
      where id = ${id}::uuid
    `);
    if ((renamed.rowCount ?? 0) === 0) {
      const [counted] = (
        await tx.execute<{ n: number; next: number }>(sql`
          select count(*)::int as n, coalesce(max(position) + 1, 0)::int as next from service_categories
        `)
      ).rows;
      if ((counted?.n ?? 0) >= L.categories) {
        throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.categories)} categories.`);
      }
      await tx.execute(sql`
        insert into service_categories (workspace_id, id, property_id, name, position, created_by_member_id,
          updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${currentPropertyRef(scope.workspaceId)}, ${name}, ${counted?.next ?? 0}, ${by}::uuid, ${by}::uuid)
      `);
    }
    return { places: await allPlaceIds(tx), ids: { categoryId: id } };
  });
}

/** Deletes a category; its services stay, at the end of the services with no category. */
export async function deleteServiceCategory(
  scope: EngineScope,
  input: { readonly categoryId: string },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.categoryId, CATEGORY_MISSING);
  return catalogueWrite(scope, deps, hooks, 'service_category.deleted', async ({ tx }) => {
    const [next] = (
      await tx.execute<{ next: number }>(sql`
        select coalesce(max(position) + 1, 0)::int as next from services where category_id is null
      `)
    ).rows;
    await tx.execute(sql`
      with moving as (
        select id, row_number() over (order by position, id) - 1 as at from services where category_id = ${id}::uuid
      )
      update services s set category_id = null, position = ${next?.next ?? 0} + moving.at, updated_at = now()
      from moving where s.id = moving.id
    `);
    const gone = await tx.execute(sql`delete from service_categories where id = ${id}::uuid`);
    if ((gone.rowCount ?? 0) === 0) throw refuse('NOT_FOUND', CATEGORY_MISSING);
    return { places: await allPlaceIds(tx), ids: { categoryId: id } };
  });
}

/** Moves a category to `toIndex` among the categories (drag, or Move up and down). */
export async function moveServiceCategory(
  scope: EngineScope,
  input: { readonly categoryId: string; readonly toIndex: number },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.categoryId, CATEGORY_MISSING);
  return catalogueWrite(scope, deps, hooks, 'service_category.moved', async ({ tx }) => {
    const order = (
      await tx.execute<{ id: string }>(sql`select id::text from service_categories order by position, id`)
    ).rows.map((row) => row.id);
    if (!order.includes(id)) throw refuse('NOT_FOUND', CATEGORY_MISSING);
    await renumber(tx, 'service_categories', placeAt(order, id, input.toIndex));
    return { places: await allPlaceIds(tx), ids: { categoryId: id } };
  });
}

/** `order` with `id` taken out and put back at `toIndex` (clamped). */
function placeAt(order: readonly string[], id: string, toIndex: number): string[] {
  const rest = order.filter((each) => each !== id);
  rest.splice(Math.min(Math.max(toIndex, 0), rest.length), 0, id);
  return rest;
}

/** Writes positions 0, 1, 2… in `order`, in one statement. */
async function renumber(
  tx: WorkspaceTx,
  table: 'service_categories' | 'services' | 'staff',
  order: readonly string[],
): Promise<void> {
  if (order.length === 0) return;
  await tx.execute(sql`
    update ${sql.identifier(table)} t set position = o.at - 1
    from unnest(${`{${order.join(',')}}`}::uuid[]) with ordinality as o(id, at)
    where t.id = o.id and t.position is distinct from (o.at - 1)::int
  `);
}

/** A free slug from the name among live services ("haircut", then "haircut-2"). */
async function freeSlug(tx: WorkspaceTx, name: string, except: string): Promise<string> {
  const base = serviceSlug(name);
  const taken = new Set(
    (
      await tx.execute<{ slug: string }>(sql`
        select slug from services where archived_at is null and id <> ${except}::uuid
          and (slug = ${base} or slug like ${`${base}-%`})
      `)
    ).rows.map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const slug = `${base}-${String(n)}`;
    if (!taken.has(slug)) return slug;
  }
}

/** Refuses any id in `ids` that isn't a live row of `table` here, naming `field`. */
async function requireRows(
  tx: WorkspaceTx,
  table: 'places' | 'staff' | 'resources',
  ids: readonly string[],
  field: string,
  message: string,
  /** Places only: the business they must belong to (spec 0065 H7). */
  propertyId?: string,
): Promise<void> {
  if (ids.length === 0) return;
  const live =
    table === 'places'
      ? propertyId === undefined
        ? sql`true`
        : sql`property_id = ${propertyId}::uuid`
      : sql`archived_at is null`;
  const [row] = (
    await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from ${sql.identifier(table)}
      where id = any(${`{${[...new Set(ids)].join(',')}}`}::uuid[]) and ${live}
    `)
  ).rows;
  if ((row?.n ?? 0) !== new Set(ids).size) throw inputInvalid(field, message);
}

/**
 * Adds a service or changes one, whole (AC-6610). Variants left out are archived, never deleted (a visit names them);
 * a new service gets a slug from its name, kept when it is renamed later so a shared booking link still works. A new
 * service goes at the end of its category; a service moved to another category goes to its end too.
 */
export async function saveService(
  scope: EngineScope,
  input: { readonly id: string; readonly service: ServiceFields },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.id, SERVICE_MISSING);
  const fields = input.service;
  const categoryId = fields.categoryId === null ? null : checkId(fields.categoryId, CATEGORY_MISSING);
  const placeIds = [...new Set(fields.placeIds.map((each) => checkId(each, 'That place doesn’t exist.')))];
  const staffIds =
    fields.staffRule === 'chosen'
      ? [...new Set(fields.staffIds.map((each) => checkId(each, 'That staff member doesn’t exist.')))]
      : [];
  const variantIds = fields.variants.flatMap((each) =>
    each.id === undefined ? [] : [checkId(each.id, 'That option doesn’t exist.')],
  );
  if (new Set(variantIds).size !== variantIds.length) throw inputInvalid('variants', 'Each option appears once.');
  return catalogueWrite(scope, deps, hooks, 'service.saved', async ({ tx }, by) => {
    const [found] = (
      await tx.execute<{
        capacity_mode: string;
        category_id: string | null;
        archived: boolean;
        property_id: string;
      }>(sql`
        select capacity_mode, category_id::text, archived_at is not null as archived, property_id::text from services
        where id = ${id}::uuid for update
      `)
    ).rows;
    if (found !== undefined && (found.capacity_mode !== 'one' || found.archived)) {
      throw refuse('NOT_FOUND', SERVICE_MISSING);
    }
    // A service serves only its own business's places, under its own business's category (spec 0065 H7, AC-6514): an
    // existing service keeps its business; a new one takes its first place's, else its category's, else the first
    // business's. A place or category of another business reads as none.
    const firstPlace =
      placeIds[0] === undefined
        ? undefined
        : (
            await tx.execute<{ property_id: string }>(
              sql`select property_id::text from places where id = ${placeIds[0]}::uuid`,
            )
          ).rows[0]?.property_id;
    const [category] =
      categoryId === null
        ? []
        : (
            await tx.execute<{ property_id: string }>(
              sql`select property_id::text from service_categories where id = ${categoryId}::uuid`,
            )
          ).rows;
    if (categoryId !== null && category === undefined) throw inputInvalid('categoryId', CATEGORY_MISSING);
    const propertyId =
      found?.property_id ?? firstPlace ?? category?.property_id ?? (await currentProperty(tx, scope.workspaceId)).id;
    if (category !== undefined && category.property_id !== propertyId) {
      throw inputInvalid('categoryId', CATEGORY_MISSING);
    }
    await requireRows(tx, 'places', placeIds, 'placeIds', 'One of those places doesn’t exist.', propertyId);
    await requireRows(tx, 'staff', staffIds, 'staffIds', 'One of those staff members doesn’t exist.');
    const named = fields.needs.flatMap((need) =>
      'resourceId' in need ? [checkId(need.resourceId, 'That room or chair doesn’t exist.')] : [],
    );
    await requireRows(tx, 'resources', named, 'needs', 'One of those rooms or chairs doesn’t exist.');
    const before = found === undefined ? [] : await placesOfServices(tx, [id]);
    const moved = found === undefined || found.category_id !== categoryId;
    const [end] = moved
      ? (
          await tx.execute<{ next: number }>(sql`
            select coalesce(max(position) + 1, 0)::int as next from services
            where category_id is not distinct from ${categoryId}::uuid
          `)
        ).rows
      : [];
    const description = fields.description?.trim() === '' ? null : (fields.description?.trim() ?? null);
    const cancelNote = fields.cancelNote?.trim() === '' ? null : (fields.cancelNote?.trim() ?? null);
    if (found === undefined) {
      const [counted] = (
        await tx.execute<{ n: number }>(sql`select count(*)::int as n from services where archived_at is null`)
      ).rows;
      if ((counted?.n ?? 0) >= L.services) {
        throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.services)} services.`);
      }
      await tx.execute(sql`
        insert into services (workspace_id, id, property_id, category_id, name, description, slug, buffer_after_min, online,
          capacity_mode, staff_rule, cancel_note, position, created_by_member_id, updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${propertyId}::uuid, ${categoryId}::uuid, ${fields.name.trim()}, ${description},
          ${await freeSlug(tx, fields.name, id)}, ${fields.bufferAfterMin}, ${fields.online}, 'one', ${fields.staffRule},
          ${cancelNote}, ${end?.next ?? 0}, ${by}::uuid, ${by}::uuid)
      `);
    } else {
      await tx.execute(sql`
        update services set category_id = ${categoryId}::uuid, name = ${fields.name.trim()},
          description = ${description}, buffer_after_min = ${fields.bufferAfterMin}, online = ${fields.online},
          staff_rule = ${fields.staffRule}, cancel_note = ${cancelNote},
          position = ${moved ? (end?.next ?? 0) : sql`position`}, updated_at = now(), updated_by_member_id = ${by}::uuid
        where id = ${id}::uuid
      `);
    }
    // Variants: the ones named keep their ids, new ones get one, the rest are archived (a booked visit names them).
    const existing = new Set(
      (
        await tx.execute<{ id: string }>(sql`
          select id::text from service_variants where service_id = ${id}::uuid and archived_at is null
        `)
      ).rows.map((row) => row.id),
    );
    for (const variantId of variantIds) {
      if (!existing.has(variantId)) throw inputInvalid('variants', 'That option doesn’t exist.');
    }
    const kept = new Set(variantIds);
    const dropped = [...existing].filter((each) => !kept.has(each));
    if (dropped.length > 0) {
      await tx.execute(sql`
        update service_variants set archived_at = now(), updated_at = now()
        where id = any(${`{${dropped.join(',')}}`}::uuid[])
      `);
    }
    for (const [position, variant] of fields.variants.entries()) {
      // Free and on request have no amount; a price kept would read wrong if the type changed back.
      const price = variant.priceType === 'free' || variant.priceType === 'on_request' ? 0 : variant.priceMinor;
      if (variant.id === undefined) {
        await tx.execute(sql`
          insert into service_variants (workspace_id, id, service_id, name, minutes, price_minor, price_type,
            buffer_before_min, position)
          values (${scope.workspaceId}::uuid, ${newId()}::uuid, ${id}::uuid, ${variant.name.trim()}, ${variant.minutes},
            ${price}, ${variant.priceType}, ${variant.bufferBeforeMin}, ${position})
        `);
      } else {
        await tx.execute(sql`
          update service_variants set name = ${variant.name.trim()}, minutes = ${variant.minutes},
            price_minor = ${price}, price_type = ${variant.priceType}, buffer_before_min = ${variant.bufferBeforeMin},
            position = ${position}, updated_at = now()
          where id = ${variant.id}::uuid
        `);
      }
    }
    await tx.execute(sql`delete from service_places where service_id = ${id}::uuid`);
    for (const placeId of placeIds) {
      await tx.execute(sql`
        insert into service_places (workspace_id, service_id, place_id, property_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${placeId}::uuid, ${propertyId}::uuid)
      `);
    }
    await tx.execute(sql`delete from service_staff where service_id = ${id}::uuid`);
    for (const staffId of staffIds) {
      await tx.execute(sql`
        insert into service_staff (workspace_id, service_id, staff_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${staffId}::uuid)
      `);
    }
    await tx.execute(sql`delete from service_resources where service_id = ${id}::uuid`);
    for (const need of fields.needs) {
      if ('resourceId' in need) {
        await tx.execute(sql`
          insert into service_resources (workspace_id, service_id, resource_id)
          values (${scope.workspaceId}::uuid, ${id}::uuid, ${need.resourceId}::uuid)
        `);
      } else {
        await tx.execute(sql`
          insert into service_resources (workspace_id, service_id, kind, count)
          values (${scope.workspaceId}::uuid, ${id}::uuid, ${need.kind}, ${need.count})
        `);
      }
    }
    return { places: [...new Set([...before, ...placeIds])], ids: { serviceId: id } };
  });
}

/** Moves a service into a category (null: none) at `toIndex` there (drag, or Move up and down). */
export async function moveService(
  scope: EngineScope,
  input: { readonly serviceId: string; readonly categoryId: string | null; readonly toIndex: number },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.serviceId, SERVICE_MISSING);
  const categoryId = input.categoryId === null ? null : checkId(input.categoryId, CATEGORY_MISSING);
  return catalogueWrite(scope, deps, hooks, 'service.moved', async ({ tx }) => {
    await requireServices(tx, [id]);
    if (categoryId !== null) {
      const [category] = (
        await tx.execute<{ id: string }>(sql`select id::text from service_categories where id = ${categoryId}::uuid`)
      ).rows;
      if (category === undefined) throw refuse('NOT_FOUND', CATEGORY_MISSING);
    }
    await tx.execute(
      sql`update services set category_id = ${categoryId}::uuid, updated_at = now() where id = ${id}::uuid`,
    );
    const order = (
      await tx.execute<{ id: string }>(sql`
        select id::text from services where category_id is not distinct from ${categoryId}::uuid
          and capacity_mode = 'one' and archived_at is null
        order by position, id
      `)
    ).rows.map((row) => row.id);
    await renumber(tx, 'services', placeAt(order, id, input.toIndex));
    return { places: await placesOfServices(tx, [id]), ids: { serviceId: id } };
  });
}

/** Refuses NOT_FOUND unless every id is a live service of this catalogue (never Table seating's). */
async function requireServices(tx: WorkspaceTx, ids: readonly string[], archived = false): Promise<void> {
  const [row] = (
    await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from services
      where id = any(${`{${ids.join(',')}}`}::uuid[]) and capacity_mode = 'one' and staff_rule <> 'none'
        and (archived_at is not null) = ${archived}
    `)
  ).rows;
  if ((row?.n ?? 0) !== new Set(ids).size) throw refuse('NOT_FOUND', SERVICE_MISSING);
}

const serviceIdsOf = (ids: readonly string[]) => [...new Set(ids.map((each) => checkId(each, SERVICE_MISSING)))];

/** Several services online or off (bulk). */
export async function setServicesOnline(
  scope: EngineScope,
  input: { readonly serviceIds: readonly string[]; readonly online: boolean },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const ids = serviceIdsOf(input.serviceIds);
  return catalogueWrite(scope, deps, hooks, input.online ? 'service.online' : 'service.offline', async ({ tx }) => {
    await requireServices(tx, ids);
    await tx.execute(sql`
      update services set online = ${input.online}, updated_at = now() where id = any(${`{${ids.join(',')}}`}::uuid[])
    `);
    return { places: await placesOfServices(tx, ids) };
  });
}

/** Several services into one category (null: none), after its last, in their present order (bulk). */
export async function setServicesCategory(
  scope: EngineScope,
  input: { readonly serviceIds: readonly string[]; readonly categoryId: string | null },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const ids = serviceIdsOf(input.serviceIds);
  const categoryId = input.categoryId === null ? null : checkId(input.categoryId, CATEGORY_MISSING);
  return catalogueWrite(scope, deps, hooks, 'service.moved', async ({ tx }) => {
    await requireServices(tx, ids);
    if (categoryId !== null) {
      const [category] = (
        await tx.execute<{ id: string }>(sql`select id::text from service_categories where id = ${categoryId}::uuid`)
      ).rows;
      if (category === undefined) throw refuse('NOT_FOUND', CATEGORY_MISSING);
    }
    const [end] = (
      await tx.execute<{ next: number }>(sql`
        select coalesce(max(position) + 1, 0)::int as next from services
        where category_id is not distinct from ${categoryId}::uuid and not (id = any(${`{${ids.join(',')}}`}::uuid[]))
      `)
    ).rows;
    await tx.execute(sql`
      with moving as (
        select id, row_number() over (order by position, id) - 1 as at from services
        where id = any(${`{${ids.join(',')}}`}::uuid[])
      )
      update services s set category_id = ${categoryId}::uuid, position = ${end?.next ?? 0} + moving.at, updated_at = now()
      from moving where s.id = moving.id
    `);
    return { places: await placesOfServices(tx, ids) };
  });
}

/** Archives services (bulk): they leave the catalogue and online booking; booked visits keep them. Restore undoes. */
export async function archiveServices(
  scope: EngineScope,
  input: { readonly serviceIds: readonly string[] },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const ids = serviceIdsOf(input.serviceIds);
  return catalogueWrite(scope, deps, hooks, 'service.archived', async ({ tx }) => {
    await requireServices(tx, ids);
    await tx.execute(sql`
      update services set archived_at = now(), updated_at = now() where id = any(${`{${ids.join(',')}}`}::uuid[])
    `);
    return { places: await placesOfServices(tx, ids) };
  });
}

/** Restores archived services, each at the end of its category; a slug a live service took since gets a new one. */
export async function restoreServices(
  scope: EngineScope,
  input: { readonly serviceIds: readonly string[] },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<CatalogueView> {
  requirePermission(scope, 'services.manage');
  const ids = serviceIdsOf(input.serviceIds);
  return catalogueWrite(scope, deps, hooks, 'service.restored', async ({ tx }) => {
    await requireServices(tx, ids, true);
    const [counted] = (
      await tx.execute<{ n: number }>(sql`select count(*)::int as n from services where archived_at is null`)
    ).rows;
    if ((counted?.n ?? 0) + ids.length > L.services) {
      throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.services)} services.`);
    }
    for (const id of ids) {
      const [row] = (
        await tx.execute<{ name: string; slug: string; category_id: string | null }>(sql`
          select name, slug, category_id::text from services where id = ${id}::uuid
        `)
      ).rows;
      if (row === undefined) continue;
      const [clash] = (
        await tx.execute<{ id: string }>(sql`
          select id::text from services where slug = ${row.slug} and archived_at is null and id <> ${id}::uuid
        `)
      ).rows;
      const [end] = (
        await tx.execute<{ next: number }>(sql`
          select coalesce(max(position) + 1, 0)::int as next from services
          where category_id is not distinct from ${row.category_id}::uuid and archived_at is null
        `)
      ).rows;
      await tx.execute(sql`
        update services set archived_at = null, updated_at = now(), position = ${end?.next ?? 0},
          slug = ${clash === undefined ? row.slug : await freeSlug(tx, row.name, id)}
        where id = ${id}::uuid
      `);
    }
    return { places: await placesOfServices(tx, ids) };
  });
}
