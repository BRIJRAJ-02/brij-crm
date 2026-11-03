// Settings › Business (spec 0065, AC-6507, AC-6508): the business profile and its places, each with an address, a
// time zone, a locale prices format with, a phone and opening hours. `hospitality.manage` only, checked before any
// input is read, and only while some Hospitality app is installed (`requireAnyApp`). Hours are checked by the one
// rule the editor runs too (`hoursProblem`), and stored whole as one document.
import { randomBytes } from 'node:crypto';
import {
  EMPTY_HOURS,
  HOSPITALITY_LIMITS,
  hoursProblem,
  type BusinessProfile,
  type BusinessProfileFields,
  type BusinessView,
  type Place,
  type PlaceFields,
  type PlaceHours,
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
import { auditSetup, hospitalityMember, requireAnyApp } from './gate.ts';

const { businessProfiles, places, resources, workspaces } = schema;

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
 * Adds a place (up to 20, `LIMIT_REACHED` past it) in the caller's transaction, under the workspace's places lock;
 * a retry with the same id answers the place already made. The first install's card and Add place both call it.
 */
export async function insertPlace(
  tx: WorkspaceTx,
  scope: EngineScope,
  id: string,
  fields: PlaceFields,
  by: string,
): Promise<void> {
  checkZone(fields.timeZone);
  await lockKey(tx, `places:${scope.workspaceId}`);
  const [again] = await tx
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.workspaceId, scope.workspaceId), eq(places.id, id)));
  if (again !== undefined) return;
  const [counted] = await tx.select({ n: count() }).from(places).where(eq(places.workspaceId, scope.workspaceId));
  const position = counted?.n ?? 0;
  if (position >= HOSPITALITY_LIMITS.places) {
    throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(HOSPITALITY_LIMITS.places)} places.`);
  }
  await tx.insert(places).values({
    workspaceId: scope.workspaceId,
    id,
    ...placeColumns(fields),
    hours: EMPTY_HOURS,
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

/** The workspace's places in order (or the one `only` names), each with its live table count. */
async function readPlaces(tx: WorkspaceTx, workspaceId: string, only?: string): Promise<Place[]> {
  const rows = await tx
    .select(PLACE_COLUMNS)
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), ...(only === undefined ? [] : [eq(places.id, only)])))
    .orderBy(asc(places.position), asc(places.id));
  const counts = await tx
    .select({ placeId: resources.placeId, n: count() })
    .from(resources)
    .where(
      and(
        eq(resources.workspaceId, workspaceId),
        isNull(resources.archivedAt),
        ...(only === undefined ? [] : [eq(resources.placeId, only)]),
      ),
    )
    .groupBy(resources.placeId);
  const byPlace = new Map(counts.map((row) => [row.placeId, row.n]));
  return rows.map((row) => placeView(row, byPlace.get(row.id) ?? 0));
}

/** One place, or NOT_FOUND. */
async function readPlace(tx: WorkspaceTx, workspaceId: string, placeId: string): Promise<Place> {
  const [found] = await readPlaces(tx, workspaceId, placeId);
  if (found === undefined) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
  return found;
}

/** The profile as the screens show it, with the workspace's currency. */
async function readProfile(tx: WorkspaceTx, workspaceId: string): Promise<BusinessProfile | undefined> {
  const [row] = await tx
    .select({
      name: businessProfiles.name,
      kind: businessProfiles.kind,
      description: businessProfiles.description,
      phone: businessProfiles.phone,
      email: businessProfiles.email,
      website: businessProfiles.website,
      links: businessProfiles.links,
      currency: workspaces.currency,
    })
    .from(businessProfiles)
    .innerJoin(workspaces, eq(workspaces.id, businessProfiles.workspaceId))
    .where(eq(businessProfiles.workspaceId, workspaceId));
  if (row === undefined) return undefined;
  return {
    name: row.name,
    kind: row.kind as BusinessProfile['kind'],
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.phone === null ? {} : { phone: row.phone }),
    ...(row.email === null ? {} : { email: row.email }),
    ...(row.website === null ? {} : { website: row.website }),
    links: (Array.isArray(row.links) ? row.links : []) as SocialLinks,
    ...(row.currency === null ? {} : { currency: row.currency }),
  };
}

/** Settings › Business (AC-6507, AC-6508): the profile and the places, for `hospitality.manage`. */
export async function getBusiness(scope: EngineScope): Promise<BusinessView> {
  requirePermission(scope, 'hospitality.manage');
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const profile = await readProfile(tx, scope.workspaceId);
    return {
      ...(profile === undefined ? {} : { profile }),
      places: await readPlaces(tx, scope.workspaceId),
      canEdit: true,
    };
  });
}

/** Saves the business profile, whole (AC-6507): empty text clears a field. Answers it as saved. */
export async function saveBusiness(scope: EngineScope, fields: BusinessProfileFields): Promise<BusinessProfile> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const values = {
      name: fields.name,
      kind: fields.kind,
      description: blank(fields.description),
      phone: blank(fields.phone),
      email: blank(fields.email),
      website: blank(fields.website),
      links: fields.links ?? [],
      updatedByMemberId: by,
    };
    await tx
      .insert(businessProfiles)
      .values({ workspaceId: scope.workspaceId, ...values, createdByMemberId: by })
      .onConflictDoUpdate({ target: businessProfiles.workspaceId, set: { ...values, updatedAt: sql`now()` } });
    await auditSetup(tx, scope, 'business.saved');
    const saved = await readProfile(tx, scope.workspaceId);
    if (saved === undefined) throw new Error('The business profile was not stored.');
    return saved;
  });
}

/** Adds a place (AC-6508; up to 20). `id` is the caller's own, so a retry makes one place. */
export async function createPlace(
  scope: EngineScope,
  input: { readonly id: string; readonly place: PlaceFields },
): Promise<Place> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const id = checkId(input.id, PLACE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await insertPlace(tx, scope, id, input.place, by);
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
