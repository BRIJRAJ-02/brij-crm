// Settings › Business (spec 0065, AC-6507, AC-6508): the property and its places, each with an address, a
// time zone, a locale prices format with, a phone and opening hours. `hospitality.manage` only, checked before any
// input is read, and only while some Hospitality app is installed (`requireAnyApp`). Hours are checked by the one
// rule the editor runs too (`hoursProblem`), and stored whole as one document.
import { randomBytes } from 'node:crypto';
import {
  RESTAURANT_HOURS,
  HOSPITALITY_LIMITS,
  hoursProblem,
  type BusinessView,
  type Place,
  type PlaceFields,
  type PlaceHours,
  type PlaceHoursShape,
  type Property,
  type PropertyFields,
  type SocialLinks,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { auditSetup, hospitalityMember, requireAnyApp, requireBusiness } from './gate.ts';
import { currentProperty, requireCurrencyFree } from './property.ts';

const { places, properties, resources } = schema;

/** The refusal for a place that isn't there, or is another workspace's. */
export const PLACE_NOT_FOUND = 'That place doesn’t exist.';

/** A public key: 16 URL safe characters from 12 random bytes (the reservation page's and the guest menu's). */
const newKey = (): string => randomBytes(12).toString('base64url');

/** The locale a country's prices format with when none is set (AC-6532): its likely language, and the country. */
export function localeForCountry(country: string): string {
  try {
    const language = new Intl.Locale('und', { region: country }).maximize().language;
    return /^[a-z]{2,3}$/.test(language) ? `${language}-${country}` : `en-${country}`;
  } catch {
    return `en-${country}`;
  }
}

/** Empty text as null, so a cleared field leaves the row. */
const blank = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value.trim();

/** A place's columns from its fields. */
function placeColumns(fields: PlaceFields) {
  return {
    name: fields.name,
    addressLine: blank(fields.addressLine),
    city: blank(fields.city),
    postcode: blank(fields.postcode),
    country: fields.country,
    timeZone: fields.timeZone,
    locale: fields.locale ?? localeForCountry(fields.country),
    phone: blank(fields.phone),
  };
}

/** Refuses a time zone the platform doesn't know (the contract checks it too; the database can't). */
function checkZone(zone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    throw inputInvalid('timeZone', 'Pick a time zone from the list.');
  }
}

/**
 * Adds a place to a property (up to 20 a property, AC-6518, `LIMIT_REACHED` past it) in the caller's transaction,
 * under the workspace's places lock; a retry with the same id answers the place already made. The first install's
 * card and Add place both call it. Left out, the property is the first.
 */
export async function insertPlace(
  tx: WorkspaceTx,
  scope: EngineScope,
  id: string,
  fields: PlaceFields,
  by: string,
  hours: PlaceHoursShape = RESTAURANT_HOURS,
  propertyId?: string,
): Promise<void> {
  checkZone(fields.timeZone);
  await lockKey(tx, `places:${scope.workspaceId}`);
  const [again] = await tx
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.workspaceId, scope.workspaceId), eq(places.id, id)));
  if (again !== undefined) return;
  const property = await currentProperty(tx, scope.workspaceId, propertyId);
  const [counted] = await tx
    .select({ n: count() })
    .from(places)
    .where(and(eq(places.workspaceId, scope.workspaceId), eq(places.propertyId, property.id)));
  if ((counted?.n ?? 0) >= HOSPITALITY_LIMITS.places) {
    throw refuse('LIMIT_REACHED', `A business takes up to ${String(HOSPITALITY_LIMITS.places)} places.`);
  }
  // Positions run across the workspace, so places keep one order whichever property lists them.
  const [last] = await tx
    .select({ end: sql<number>`coalesce(max(${places.position}) + 1, 0)::int` })
    .from(places)
    .where(eq(places.workspaceId, scope.workspaceId));
  const position = last?.end ?? 0;
  await tx.insert(places).values({
    workspaceId: scope.workspaceId,
    id,
    propertyId: property.id,
    ...placeColumns(fields),
    hours,
    publicKey: newKey(),
    menuKey: newKey(),
    position,
    createdByMemberId: by,
    updatedByMemberId: by,
  });
}

const PLACE_COLUMNS = {
  id: places.id,
  name: places.name,
  addressLine: places.addressLine,
  city: places.city,
  postcode: places.postcode,
  country: places.country,
  timeZone: places.timeZone,
  locale: places.locale,
  phone: places.phone,
  hours: places.hours,
  updatedAt: places.updatedAt,
} as const;

interface PlaceRow {
  readonly id: string;
  readonly name: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly country: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly phone: string | null;
  readonly hours: unknown;
  readonly updatedAt: Date | string;
}

/** A place's row as the screens show it, with how many live tables it has. */
function placeView(row: PlaceRow, tables: number): Place {
  return {
    id: row.id,
    name: row.name,
    ...(row.addressLine === null ? {} : { addressLine: row.addressLine }),
    ...(row.city === null ? {} : { city: row.city }),
    ...(row.postcode === null ? {} : { postcode: row.postcode }),
    country: row.country,
    timeZone: row.timeZone,
    locale: row.locale,
    ...(row.phone === null ? {} : { phone: row.phone }),
    hours: row.hours as PlaceHours,
    resourceCount: tables,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** A property's places in order (or the one `only` names), each with its live table count. */
async function readPlaces(
  tx: WorkspaceTx,
  workspaceId: string,
  only: { readonly placeId: string } | { readonly propertyId: string },
): Promise<Place[]> {
  const rows = await tx
    .select(PLACE_COLUMNS)
    .from(places)
    .where(
      and(
        eq(places.workspaceId, workspaceId),
        'placeId' in only ? eq(places.id, only.placeId) : eq(places.propertyId, only.propertyId),
      ),
    )
    .orderBy(asc(places.position), asc(places.id));
  const counts = await tx
    .select({ placeId: resources.placeId, n: count() })
    .from(resources)
    .where(
      and(
        eq(resources.workspaceId, workspaceId),
        isNull(resources.archivedAt),
        ...('placeId' in only ? [eq(resources.placeId, only.placeId)] : []),
      ),
    )
    .groupBy(resources.placeId);
  const byPlace = new Map(counts.map((row) => [row.placeId, row.n]));
  return rows.map((row) => placeView(row, byPlace.get(row.id) ?? 0));
}

/** One place, or NOT_FOUND. */
async function readPlace(tx: WorkspaceTx, workspaceId: string, placeId: string): Promise<Place> {
  const [found] = await readPlaces(tx, workspaceId, { placeId });
  if (found === undefined) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
  return found;
}

/** The property as the screens show it, with its currency; undefined until someone has set it up. */
async function readProperty(tx: WorkspaceTx, workspaceId: string, propertyId?: string): Promise<Property | undefined> {
  const row = await currentProperty(tx, workspaceId, propertyId);
  if (row.name === null || row.kind === null) return undefined;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Property['kind'],
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.phone === null ? {} : { phone: row.phone }),
    ...(row.email === null ? {} : { email: row.email }),
    ...(row.website === null ? {} : { website: row.website }),
    links: (Array.isArray(row.links) ? row.links : []) as SocialLinks,
    ...(row.currency === null ? {} : { currency: row.currency }),
  };
}

/**
 * Settings › Business (AC-6507, AC-6508): a property and its places, for `hospitality.manage`. Left out, the property
 * is the first (AC-6516: one property reads exactly as before).
 */
export async function getBusiness(
  scope: EngineScope,
  input: { readonly propertyId?: string } = {},
): Promise<BusinessView> {
  requirePermission(scope, 'hospitality.manage');
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const property = await currentProperty(tx, scope.workspaceId, input.propertyId);
    const profile = await readProperty(tx, scope.workspaceId, property.id);
    return {
      ...(profile === undefined ? {} : { profile }),
      places: await readPlaces(tx, scope.workspaceId, { propertyId: property.id }),
      canEdit: true,
    };
  });
}

/**
 * Saves a property, whole (AC-6507): empty text clears a field. Its currency changes only while it has no price
 * (AC-6519, `IN_USE`). Left out, the property is the first. Answers it as saved.
 */
export async function saveBusiness(
  scope: EngineScope,
  fields: PropertyFields,
  input: { readonly propertyId?: string } = {},
): Promise<Property> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await requireBusiness(tx, scope.workspaceId);
    const property = await currentProperty(tx, scope.workspaceId, input.propertyId);
    if (fields.currency !== undefined) {
      await lockKey(tx, `menu:${scope.workspaceId}`);
      await requireCurrencyFree(tx, scope.workspaceId, property, fields.currency);
    }
    const values = {
      name: fields.name,
      kind: fields.kind,
      description: blank(fields.description),
      phone: blank(fields.phone),
      email: blank(fields.email),
      website: blank(fields.website),
      links: fields.links ?? [],
      ...(fields.currency === undefined ? {} : { currency: fields.currency }),
      updatedByMemberId: by,
    };
    await tx
      .update(properties)
      .set({
        ...values,
        createdByMemberId: sql`coalesce(${properties.createdByMemberId}, ${by}::uuid)`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(properties.workspaceId, scope.workspaceId), eq(properties.id, property.id)));
    await auditSetup(tx, scope, 'business.saved', { propertyId: property.id });
    const saved = await readProperty(tx, scope.workspaceId, property.id);
    if (saved === undefined) throw new Error('The property was not stored.');
    return saved;
  });
}

/** Adds a place (AC-6508; up to 20). `id` is the caller's own, so a retry makes one place. */
export async function createPlace(
  scope: EngineScope,
  input: { readonly id: string; readonly place: PlaceFields; readonly propertyId?: string },
): Promise<Place> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const id = checkId(input.id, PLACE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await requireBusiness(tx, scope.workspaceId);
    await insertPlace(tx, scope, id, input.place, by, RESTAURANT_HOURS, input.propertyId);
    await auditSetup(tx, scope, 'place.created', { placeId: id });
    return readPlace(tx, scope.workspaceId, id);
  });
}

/**
 * Changes a place's address and contact, its hours, or both (AC-6508). Hours that break the rules are refused on
 * `hours` with the rule's own sentence. Changing hours never touches a reservation (none until H3).
 */
export async function updatePlace(
  scope: EngineScope,
  input: { readonly placeId: string; readonly place?: PlaceFields; readonly hours?: PlaceHours },
): Promise<Place> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const placeId = checkId(input.placeId, PLACE_NOT_FOUND);
  if (input.hours !== undefined) {
    const problem = hoursProblem(input.hours);
    if (problem !== undefined) throw inputInvalid('hours', problem);
  }
  if (input.place !== undefined) checkZone(input.place.timeZone);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const changed = await tx
      .update(places)
      .set({
        ...(input.place === undefined ? {} : placeColumns(input.place)),
        ...(input.hours === undefined ? {} : { hours: input.hours }),
        updatedByMemberId: by,
        updatedAt: sql`now()`,
      })
      .where(and(eq(places.workspaceId, scope.workspaceId), eq(places.id, placeId)))
      .returning({ id: places.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
    await auditSetup(tx, scope, input.hours === undefined ? 'place.updated' : 'place.hours', { placeId });
    return readPlace(tx, scope.workspaceId, placeId);
  });
}
