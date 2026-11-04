// The Hospitality suite's setup (spec 0065, H0, AC-6501 to AC-6511): the Apps page (install and remove per workspace,
// behind Timefix's early access), the business profile, its places with opening hours, and each place's areas and
// resources. Every procedure is inside a workspace, behind the member door; installing and removing are for
// `workspace.manage`, the business and its places for `hospitality.manage`, and each refuses `APP_NOT_INSTALLED`
// while no Hospitality app is installed. The closed lists and pure rules are in `hospitality-model.ts`, shared with
// the browser without Zod.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { TimeZoneName } from './booking/settings.ts';
import {
  BUSINESS_KINDS,
  EARLY_ACCESS_FLAGS,
  HOSPITALITY_APPS,
  HOSPITALITY_LIMITS,
  hoursProblem,
  rangesProblem,
  RESOURCE_KINDS,
  RESOURCE_LABEL_PATTERN,
  WEEK_DAYS,
} from './hospitality-model.ts';
import { SocialLinks } from './profile.ts';
import { COUNTRY_CODES } from './values/countries.ts';
import { CURRENCY_CODES } from './values/currencies.ts';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

export * from './hospitality-model.ts';

const COUNTRIES: ReadonlySet<string> = new Set(COUNTRY_CODES);

/** Whether `value` is an http or https address with a host. */
function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
  } catch {
    return false;
  }
}
const CURRENCIES: ReadonlySet<string> = new Set(CURRENCY_CODES);
const L = HOSPITALITY_LIMITS;

/** One Hospitality app. */
export const HospitalityAppName = z.enum(HOSPITALITY_APPS, { error: 'Pick one of the apps.' });
/** One Hospitality app. */
export type HospitalityAppName = z.infer<typeof HospitalityAppName>;

/** One early access flag. */
export const EarlyAccessFlagName = z.enum(EARLY_ACCESS_FLAGS);
/** One early access flag. */
export type EarlyAccessFlagName = z.infer<typeof EarlyAccessFlagName>;

/** What a business is. */
export const BusinessKindName = z.enum(BUSINESS_KINDS, { error: 'Pick what kind of place it is.' });
/** What a business is. */
export type BusinessKindName = z.infer<typeof BusinessKindName>;

/** `HH:MM`, 24 hour. */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 18:30.');
/** `HH:MM`, 24 hour. */
export type TimeOfDay = z.infer<typeof TimeOfDay>;

/** One opening range, crossing midnight when `to` is not after `from`. */
export const HoursRange = z.strictObject({
  from: TimeOfDay,
  to: TimeOfDay,
  name: z
    .string()
    .trim()
    .min(1)
    .max(L.rangeNameMax, `Use ${String(L.rangeNameMax)} characters or fewer.`)
    .optional(),
});
/** One opening range. */
export type HoursRange = z.infer<typeof HoursRange>;

/** One day's opening ranges: up to three, in order, none overlapping, only the last past midnight. */
export const PlaceDayRanges = z
  .array(HoursRange)
  .max(L.rangesPerDay, `A day takes up to ${String(L.rangesPerDay)} opening times.`)
  .check((ctx) => {
    const problem = rangesProblem(ctx.value);
    if (problem !== undefined) ctx.issues.push({ code: 'custom', message: problem, input: ctx.value });
  });

/** A dated exception: closed, or its own ranges, with an optional note. */
export const HoursException = z.strictObject({
  date: z.iso.date({ error: 'Give the special day a date.' }),
  closed: z.boolean().optional(),
  ranges: PlaceDayRanges.optional(),
  note: z
    .string()
    .trim()
    .max(L.noteMax, `Use ${String(L.noteMax)} characters or fewer.`)
    .optional(),
});
/** A dated exception. */
export type HoursException = z.infer<typeof HoursException>;

/**
 * A place's opening hours (AC-6508; the one schema the spec names, `PlaceHours`): a weekly pattern of up to three
 * ranges a day, in order and never overlapping, the last of a day may cross midnight; and dated exceptions.
 */
export const PlaceHours = z
  .strictObject({
    weekly: z.strictObject(
      Object.fromEntries(WEEK_DAYS.map((day) => [day, PlaceDayRanges.optional()])) as {
        [Day in (typeof WEEK_DAYS)[number]]: z.ZodOptional<typeof PlaceDayRanges>;
      },
    ),
    exceptions: z.array(HoursException).max(L.exceptions),
  })
  .check((ctx) => {
    const problem = hoursProblem(ctx.value);
    if (problem !== undefined) ctx.issues.push({ code: 'custom', message: problem, input: ctx.value });
  });
/** A place's opening hours. */
export type PlaceHours = z.infer<typeof PlaceHours>;

const Optional = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message ?? `Use ${String(max)} characters or fewer.`);

/** A phone number as typed: digits, spaces and the usual marks. */
const Phone = Optional(40).regex(/^[0-9+()\-. ]*$/, 'Use digits, spaces and + ( ) - only.');

const Country = z.string().refine((code) => COUNTRIES.has(code), { error: 'Pick a country.' });
const Currency = z.string().refine((code) => CURRENCIES.has(code), { error: 'Pick a currency, such as GBP.' });

/** The business profile (AC-6507), as Settings › Business shows it. Optional fields are absent when empty. */
export const BusinessProfile = z.object({
  name: z.string(),
  kind: BusinessKindName,
  description: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  links: SocialLinks,
  /** The workspace's currency (one per workspace). */
  currency: z.string().optional(),
});
/** The business profile. */
export type BusinessProfile = z.infer<typeof BusinessProfile>;

/** A business profile as saved: empty text clears a field. */
export const BusinessProfileFields = z.object({
  name: z.string().trim().min(1, 'Name the business.').max(L.businessNameMax),
  kind: BusinessKindName,
  description: Optional(L.descriptionMax).optional(),
  phone: Phone.optional(),
  email: z.union([z.literal(''), z.email({ error: 'Use an email address, such as hello@example.com.' })]).optional(),
  // A guest page links it (H1): only an http or https address, never a script.
  website: Optional(2048)
    .refine((value) => value === '' || isWebAddress(value), {
      error: 'Use a web address, such as https://example.com.',
    })
    .optional(),
  links: SocialLinks.optional(),
});
/** A business profile as saved. */
export type BusinessProfileFields = z.infer<typeof BusinessProfileFields>;

/** A place's address and contact, as saved (AC-6508). */
export const PlaceFields = z.object({
  name: z.string().trim().min(1, 'Name the place.').max(L.placeNameMax),
  addressLine: Optional(200).optional(),
  city: Optional(100).optional(),
  postcode: Optional(20).optional(),
  country: Country,
  timeZone: TimeZoneName,
  /** Prices format with it (AC-6532); defaulted from the country when absent. */
  locale: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a language tag, such as en-GB.')
    .optional(),
  phone: Phone.optional(),
});
/** A place's address and contact. */
export type PlaceFields = z.infer<typeof PlaceFields>;

/** One place as Settings › Business lists it. */
export const Place = z.object({
  id: Uuid,
  name: z.string(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string(),
  timeZone: z.string(),
  locale: z.string(),
  phone: z.string().optional(),
  hours: PlaceHours,
  /** Its live resources. */
  resourceCount: z.number().int().nonnegative(),
  updatedAt: Timestamp,
});
/** One place. */
export type Place = z.infer<typeof Place>;

/** One area of a place (Inside, Terrace, Bar). */
export const Area = z.object({ id: Uuid, name: z.string(), position: z.number().int() });
/** One area of a place. */
export type Area = z.infer<typeof Area>;

/** What a resource is. */
export const ResourceKindName = z.enum(RESOURCE_KINDS, { error: 'Pick what it is.' });
/** What a resource is. */
export type ResourceKindName = z.infer<typeof ResourceKindName>;

/** One resource of a place (AC-6509): a resource, a room, a chair, a bed, a court. Capacity is how many people it takes. */
export const Resource = z.object({
  id: Uuid,
  kind: ResourceKindName,
  label: z.string(),
  areaId: Uuid.optional(),
  minCapacity: z.number().int(),
  maxCapacity: z.number().int(),
  online: z.boolean(),
  joins: z.array(Uuid),
  position: z.number().int(),
  archived: z.boolean(),
});
/** One resource of a place. */
export type Resource = z.infer<typeof Resource>;

/** One place's floor: its areas and resources in order, archived ones last. */
export const PlaceFloor = z.object({ placeId: Uuid, areas: z.array(Area), resources: z.array(Resource) });
/** One place's floor. */
export type PlaceFloor = z.infer<typeof PlaceFloor>;

/** One app on the Apps page. */
export const AppState = z.object({
  app: HospitalityAppName,
  installed: z.boolean(),
  installedAt: Timestamp.optional(),
});
/** One app on the Apps page. */
export type AppState = z.infer<typeof AppState>;

/**
 * Settings › Apps (AC-6501): `available` only when Timefix opened early access for the workspace, and `apps` empty
 * otherwise, so nothing about them shows. `canManage` says whether this reader may install and remove.
 */
export const AppsView = z.object({
  available: z.boolean(),
  canManage: z.boolean(),
  hasBusiness: z.boolean(),
  apps: z.array(AppState),
});
/** Settings › Apps. */
export type AppsView = z.infer<typeof AppsView>;

/** Settings › Business: the profile (absent before the first install) and its places, in order. */
export const BusinessView = z.object({
  profile: BusinessProfile.optional(),
  places: z.array(Place),
  canEdit: z.boolean(),
});
/** Settings › Business. */
export type BusinessView = z.infer<typeof BusinessView>;

/** The first install's business card (AC-6506): the business, its first place, and the workspace's currency. */
export const FirstBusiness = z.object({
  name: BusinessProfileFields.shape.name,
  kind: BusinessKindName,
  place: PlaceFields.pick({ addressLine: true, city: true, postcode: true, country: true, timeZone: true }),
  currency: Currency,
});
/** The first install's business card. */
export type FirstBusiness = z.infer<typeof FirstBusiness>;

/**
 * Installing an app (AC-6503, AC-6505, AC-6506): `withNeeded` installs what it needs in the same step (Menu with
 * Menu QR); `business` is required the first time any Hospitality app is installed (`BUSINESS_NEEDED` without it).
 */
export const InstallAppInput = WorkspaceScoped.extend({
  app: HospitalityAppName,
  withNeeded: z.boolean().default(false),
  business: FirstBusiness.optional(),
  mutationId: Uuid,
});
/** Installing an app. */
export type InstallAppInput = z.infer<typeof InstallAppInput>;

/** Removing an app (AC-6503, AC-6505): `withDependents` removes the apps that need it too (Menu QR with Menu). */
export const RemoveAppInput = WorkspaceScoped.extend({
  app: HospitalityAppName,
  withDependents: z.boolean().default(false),
  mutationId: Uuid,
});
/** Removing an app. */
export type RemoveAppInput = z.infer<typeof RemoveAppInput>;

/** Saving the business profile, whole. */
export const SaveBusinessInput = WorkspaceScoped.extend({ profile: BusinessProfileFields, mutationId: Uuid });
/** Saving the business profile. */
export type SaveBusinessInput = z.infer<typeof SaveBusinessInput>;

/** Adding a place (up to 20). `id` is the client's own, so a retry makes one place. */
export const CreatePlaceInput = WorkspaceScoped.extend({ id: Uuid, place: PlaceFields, mutationId: Uuid });
/** Adding a place. */
export type CreatePlaceInput = z.infer<typeof CreatePlaceInput>;

/** Changing a place's address and contact, its hours, or both. */
export const UpdatePlaceInput = WorkspaceScoped.extend({
  placeId: Uuid,
  place: PlaceFields.optional(),
  hours: PlaceHours.optional(),
  mutationId: Uuid,
});
/** Changing a place. */
export type UpdatePlaceInput = z.infer<typeof UpdatePlaceInput>;

/** One place's floor. */
export const PlaceInput = WorkspaceScoped.extend({ placeId: Uuid });
/** One place's floor. */
export type PlaceInput = z.infer<typeof PlaceInput>;

const AreaName = z.string().trim().min(1, 'Name the area.').max(L.areaNameMax);

/** Adding an area (`areaId` absent) or renaming one. */
export const SaveAreaInput = WorkspaceScoped.extend({
  placeId: Uuid,
  areaId: Uuid.optional(),
  id: Uuid.optional(),
  name: AreaName,
  mutationId: Uuid,
});
/** Adding or renaming an area. */
export type SaveAreaInput = z.infer<typeof SaveAreaInput>;

/** Deleting an area: its resources stay, with no area. */
export const DeleteAreaInput = WorkspaceScoped.extend({ placeId: Uuid, areaId: Uuid, mutationId: Uuid });
/** Deleting an area. */
export type DeleteAreaInput = z.infer<typeof DeleteAreaInput>;

/** A resource's label: up to 12 characters ("T4", "Chair 2"), unique in its place ignoring case. */
export const ResourceLabel = z
  .string()
  .trim()
  .min(1, 'Give it a label.')
  .max(L.labelMax, `Use ${String(L.labelMax)} characters or fewer.`)
  .regex(RESOURCE_LABEL_PATTERN, 'Use letters and numbers, such as T4 or Chair 2.');

const Capacity = z
  .number()
  .int()
  .min(L.capacityMin, `Take at least ${String(L.capacityMin)}.`)
  .max(L.capacityMax, `Take at most ${String(L.capacityMax)}.`);

/** Adding resources at once ("T1 to T10, 2 to 4 people"): their kind, the labels, one area, the capacity, online. */
export const AddResourcesInput = WorkspaceScoped.extend({
  placeId: Uuid,
  kind: ResourceKindName,
  labels: z.array(ResourceLabel).min(1).max(L.resourcesPerAdd),
  areaId: Uuid.optional(),
  minCapacity: Capacity,
  maxCapacity: Capacity,
  online: z.boolean().default(true),
  mutationId: Uuid,
}).refine((input) => input.minCapacity <= input.maxCapacity, {
  message: 'The fewest can’t be more than the most.',
  path: ['minCapacity'],
});
/** Adding resources at once. */
export type AddResourcesInput = z.infer<typeof AddResourcesInput>;

/** Changing one resource: any of its fields (`areaId: null` takes it out of its area). */
export const UpdateResourceInput = WorkspaceScoped.extend({
  placeId: Uuid,
  resourceId: Uuid,
  kind: ResourceKindName.optional(),
  label: ResourceLabel.optional(),
  areaId: Uuid.nullable().optional(),
  minCapacity: Capacity.optional(),
  maxCapacity: Capacity.optional(),
  online: z.boolean().optional(),
  joins: z
    .array(Uuid)
    .max(L.joinsPerResource, `One joins up to ${String(L.joinsPerResource)} others.`)
    .optional(),
  mutationId: Uuid,
});
/** Changing one resource. */
export type UpdateResourceInput = z.infer<typeof UpdateResourceInput>;

/** Moving a resource to a place among its place's live resources (drag to reorder). */
export const MoveResourceInput = WorkspaceScoped.extend({
  placeId: Uuid,
  resourceId: Uuid,
  toIndex: z.number().int().min(0),
  mutationId: Uuid,
});
/** Moving a resource. */
export type MoveResourceInput = z.infer<typeof MoveResourceInput>;

/** Archiving a resource (it leaves online fitting, keeps its holds), bringing one back, or deleting it. */
export const ResourceInput = WorkspaceScoped.extend({ placeId: Uuid, resourceId: Uuid, mutationId: Uuid });
/** One resource. */
export type ResourceInput = z.infer<typeof ResourceInput>;

/** One table's QR (spec 0065, H2): its label and area, its code, and how many scans it had in the last 30 days. */
export const TableQr = z.object({
  id: Uuid,
  label: z.string(),
  areaName: z.string().optional(),
  /** The code its printed QR carries (`/m/<menu key>?t=<code>`): 22 random base64url characters. */
  code: z.string(),
  /** Visitors a day who opened the menu from this code, summed over the last 30 days. */
  scans: z.number().int().nonnegative(),
});
/** One table's QR. */
export type TableQr = z.infer<typeof TableQr>;

/**
 * A place's QR codes (H2): the place, its guest menu's key, whether guests can read a menu there now (published and
 * not hidden), and its live tables in order with their codes. Archived tables and other kinds of resource have none.
 */
export const PlaceQrCodes = z.object({
  placeId: Uuid,
  placeName: z.string(),
  menuKey: z.string(),
  /** `live` guests see the menu; `unpublished` it was never published; `hidden` it is switched to Hidden. */
  menuState: z.enum(['live', 'unpublished', 'hidden']),
  tables: z.array(TableQr),
});
/** A place's QR codes. */
export type PlaceQrCodes = z.infer<typeof PlaceQrCodes>;

/** A table whose code to replace: its old print stops opening the table. */
export const RegenerateTableCodeInput = WorkspaceScoped.extend({ placeId: Uuid, resourceId: Uuid, mutationId: Uuid });
/** A table whose code to replace. */
export type RegenerateTableCodeInput = z.infer<typeof RegenerateTableCodeInput>;

/**
 * The Hospitality setup (H0). `apps` is any member's (empty without early access); `install` and `remove` are
 * `workspace.manage`'s; the rest are `hospitality.manage`'s, and refuse `APP_NOT_INSTALLED` while no Hospitality app
 * is installed. Limits answer `LIMIT_REACHED`; a label or area name already in the place `NAME_TAKEN`.
 */
export const hospitalityContract = {
  apps: oc.input(WorkspaceScoped).output(AppsView),
  install: oc.input(InstallAppInput).output(AppsView),
  remove: oc.input(RemoveAppInput).output(AppsView),
  business: oc.input(WorkspaceScoped).output(BusinessView),
  saveBusiness: oc.input(SaveBusinessInput).output(BusinessProfile),
  createPlace: oc.input(CreatePlaceInput).output(Place),
  updatePlace: oc.input(UpdatePlaceInput).output(Place),
  resources: oc.input(PlaceInput).output(PlaceFloor),
  saveArea: oc.input(SaveAreaInput).output(PlaceFloor),
  deleteArea: oc.input(DeleteAreaInput).output(PlaceFloor),
  addResources: oc.input(AddResourcesInput).output(PlaceFloor),
  updateResource: oc.input(UpdateResourceInput).output(PlaceFloor),
  moveResource: oc.input(MoveResourceInput).output(PlaceFloor),
  archiveResource: oc.input(ResourceInput).output(PlaceFloor),
  restoreResource: oc.input(ResourceInput).output(PlaceFloor),
  /** Refused `IN_USE` while the resource holds future reservations (none until Table seating, H3). */
  deleteResource: oc.input(ResourceInput).output(PlaceFloor),
  /** A place's table QR codes (H2): `hospitality.manage`, and only while Menu QR is installed. */
  qrCodes: oc.input(PlaceInput).output(PlaceQrCodes),
  /** A new code for one table (H2): the old print stops opening it. `hospitality.manage`, Menu QR installed. */
  regenerateTableCode: oc.input(RegenerateTableCodeInput).output(PlaceQrCodes),
};

/** The operator console's one write (AC-6502): a workspace's early access flag on or off. */
export const SetEarlyAccessInput = z.object({ workspaceId: Uuid, flag: EarlyAccessFlagName, on: z.boolean() });
/** The operator console's one write. */
export type SetEarlyAccessInput = z.infer<typeof SetEarlyAccessInput>;

/** A workspace's early access flags, before and after the switch. */
export const EarlyAccessChange = z.object({
  workspaceId: Uuid,
  before: z.array(EarlyAccessFlagName),
  after: z.array(EarlyAccessFlagName),
});
/** A workspace's early access flags, before and after. */
export type EarlyAccessChange = z.infer<typeof EarlyAccessChange>;
