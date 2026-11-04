// Services, staff and shifts (spec 0066 B1, AC-6610 to AC-6613): the settings screens of the visit engine. The
// catalogue (categories, services and their variants, where each is offered, who does it and what it needs) is
// `services.manage`'s, and so are the staff profiles; each staff member's shifts, date overrides, time off and blocks
// are `services.calendar`'s. Every write answers the whole copy it changed, so a screen lays it over its own. One
// schema per shape, the type beside it under the same name.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { PlaceHours } from './hospitality.ts';
import { RESOURCE_KINDS } from './hospitality-model.ts';
import { Timestamp } from './values/attribute-values.ts';
import { Hue } from './values/hues.ts';
import { Uuid } from './values/ids.ts';
import { CATALOGUE_LIMITS as L, PRICE_TYPES, STAFF_TIME_OFF_REASONS, VISIT_LIMITS } from './visits-model.ts';
import { WorkspaceScoped } from './workspaces.ts';

const Name = (max: number, empty: string) =>
  z
    .string()
    .trim()
    .min(1, empty)
    .max(max, `Use ${String(max)} characters or fewer.`);
const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${String(max)} characters or fewer.`);
const Minutes = (min: number, max: number, what: string) =>
  z
    .number()
    .int(`Give the ${what} in whole minutes.`)
    .min(min, `Give the ${what} as ${String(min)} minutes or more.`)
    .max(max, `Give the ${what} as ${String(max)} minutes or fewer.`);

/** How a price reads: fixed, from (the least it costs), free, or on request. */
export const PriceTypeName = z.enum(PRICE_TYPES, { error: 'Pick how the price reads.' });
/** How a price reads. */
export type PriceTypeName = z.infer<typeof PriceTypeName>;

/** Who does a service a screen sets: every staff member at the place, or only the chosen ones. */
export const ServiceStaffRule = z.enum(['all', 'chosen'], { error: 'Pick who does it.' });
/** Who does a service. */
export type ServiceStaffRule = z.infer<typeof ServiceStaffRule>;

/** A variant of a service as the editor sends it: its id when it is already there. */
export const VariantFields = z.object({
  id: Uuid.optional(),
  name: Name(L.variantNameMax, 'Name the option.'),
  minutes: Minutes(VISIT_LIMITS.minutesMin, VISIT_LIMITS.minutesMax, 'length'),
  priceMinor: z
    .number()
    .int('Give the price in whole units.')
    .min(0, 'Give a price of 0 or more.')
    .max(L.priceMax, 'That price is too large.'),
  priceType: PriceTypeName,
  bufferBeforeMin: Minutes(0, VISIT_LIMITS.bufferMax, 'time before'),
});
/** A variant as the editor sends it. */
export type VariantFields = z.infer<typeof VariantFields>;

/** What a service needs besides staff: `count` resources of a kind, or one named resource. */
export const ServiceNeed = z.union([
  z.object({
    kind: z.enum(RESOURCE_KINDS, { error: 'Pick what it needs.' }),
    count: z.number().int().min(1).max(VISIT_LIMITS.needCount, 'A service needs at most 5 of one kind.'),
  }),
  z.object({ resourceId: Uuid }),
]);
/** What a service needs. */
export type ServiceNeed = z.infer<typeof ServiceNeed>;

/** A service as the editor sends it, whole (AC-6610). */
export const ServiceFields = z.object({
  name: Name(L.serviceNameMax, 'Name the service.'),
  description: Text(L.descriptionMax).optional(),
  categoryId: Uuid.nullable(),
  bufferAfterMin: Minutes(0, VISIT_LIMITS.bufferMax, 'time after'),
  online: z.boolean(),
  staffRule: ServiceStaffRule,
  /** The staff who do it when the rule is `chosen`. */
  staffIds: z.array(Uuid).max(L.staff),
  placeIds: z.array(Uuid).max(20),
  needs: z.array(ServiceNeed).max(VISIT_LIMITS.resourceNeedsPerService, 'A service needs at most 5 things.'),
  variants: z
    .array(VariantFields)
    .min(1, 'Give the service a length and price.')
    .max(VISIT_LIMITS.variantsPerService, 'A service takes up to 8 options.'),
  cancelNote: Text(L.cancelNoteMax).optional(),
});
/** A service as the editor sends it. */
export type ServiceFields = z.infer<typeof ServiceFields>;

/** One variant as the screens show it. */
export const ServiceVariantView = z.object({
  id: Uuid,
  name: z.string(),
  minutes: z.number().int(),
  priceMinor: z.number().int(),
  priceType: PriceTypeName,
  bufferBeforeMin: z.number().int(),
});
/** One variant. */
export type ServiceVariantView = z.infer<typeof ServiceVariantView>;

/** One service as the catalogue lists it. */
export const CatalogueService = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().optional(),
  categoryId: Uuid.optional(),
  bufferAfterMin: z.number().int(),
  online: z.boolean(),
  staffRule: ServiceStaffRule,
  staffIds: z.array(Uuid),
  placeIds: z.array(Uuid),
  needs: z.array(ServiceNeed),
  variants: z.array(ServiceVariantView),
  cancelNote: z.string().optional(),
  archived: z.boolean(),
});
/** One service. */
export type CatalogueService = z.infer<typeof CatalogueService>;

/** One category, in order. */
export const CatalogueCategory = z.object({ id: Uuid, name: z.string() });
/** One category. */
export type CatalogueCategory = z.infer<typeof CatalogueCategory>;

/** One step of the Appointments setup checklist, done or not (spec 0068, Foolproof). */
export const SetupStepId = z.enum(['business', 'hours', 'service', 'staff', 'shifts', 'publish']);
/** One setup step. */
export type SetupStepId = z.infer<typeof SetupStepId>;

/** The setup checklist's facts: each step, and the place a step names when it is one place's. */
export const AppointmentsSetup = z.object({
  steps: z.array(z.object({ id: SetupStepId, done: z.boolean(), placeId: Uuid.optional() })),
});
/** The setup checklist's facts. */
export type AppointmentsSetup = z.infer<typeof AppointmentsSetup>;

/** A place as the catalogue and the team name it. */
export const ServicePlace = z.object({
  id: Uuid,
  name: z.string(),
  timeZone: z.string(),
  hours: PlaceHours,
});
/** A place. */
export type ServicePlace = z.infer<typeof ServicePlace>;

/** A resource a service may name. */
export const ServiceResource = z.object({
  id: Uuid,
  placeId: Uuid,
  label: z.string(),
  kind: z.enum(RESOURCE_KINDS),
});
/** A resource a service may name. */
export type ServiceResource = z.infer<typeof ServiceResource>;

/** Settings › Services (AC-6613): categories, services (archived too), and what a service may name. */
export const CatalogueView = z.object({
  categories: z.array(CatalogueCategory),
  services: z.array(CatalogueService),
  places: z.array(ServicePlace),
  staff: z.array(z.object({ id: Uuid, name: z.string(), placeIds: z.array(Uuid) })),
  resources: z.array(ServiceResource),
  /** The workspace's currency, which every price is in (Rules settled: Currency). */
  currency: z.string().optional(),
  /** The business's kind, for the starter service. */
  businessKind: z.string().optional(),
  setup: AppointmentsSetup,
});
/** Settings › Services. */
export type CatalogueView = z.infer<typeof CatalogueView>;

/** One staff member's work at a place: their weekly shifts and date overrides, and whether they may start early. */
export const StaffPlaceView = z.object({ placeId: Uuid, shifts: PlaceHours, outsideHours: z.boolean() });
/** One staff member's work at a place. */
export type StaffPlaceView = z.infer<typeof StaffPlaceView>;

/** One stretch of time off (an unlinked staff member's own). */
export const StaffTimeOffView = z.object({
  id: Uuid,
  placeId: Uuid.optional(),
  start: Timestamp,
  end: Timestamp,
  reason: z.enum(STAFF_TIME_OFF_REASONS),
});
/** One stretch of time off. */
export type StaffTimeOffView = z.infer<typeof StaffTimeOffView>;

/** One blocked time at a place (lunch, training). */
export const StaffBlockView = z.object({
  id: Uuid,
  placeId: Uuid,
  start: Timestamp,
  end: Timestamp,
  reason: z.string().optional(),
});
/** One blocked time. */
export type StaffBlockView = z.infer<typeof StaffBlockView>;

/** A staff profile (AC-6611) with where they work, what they do, and their upcoming time off and blocks. */
export const StaffView = z.object({
  id: Uuid,
  name: z.string(),
  title: z.string().optional(),
  bio: z.string().optional(),
  color: Hue.optional(),
  /** A version of their photo, for its address; absent with none. */
  photo: z.string().optional(),
  /** The member they are, when linked: they then sign in, and their own time off and calendar block them. */
  memberId: Uuid.optional(),
  memberName: z.string().optional(),
  archived: z.boolean(),
  places: z.array(StaffPlaceView),
  /** The live services they do (every service whose rule is `all` at a place of theirs, and those that chose them). */
  serviceIds: z.array(Uuid),
  timeOff: z.array(StaffTimeOffView),
  blocks: z.array(StaffBlockView),
  /** Their booked visits to come (archive refuses while any are). */
  upcoming: z.number().int(),
});
/** A staff profile. */
export type StaffView = z.infer<typeof StaffView>;

/** Settings › Staff and Shifts: every profile in order (archived too), the places, and what can be chosen. */
export const StaffTeamView = z.object({
  staff: z.array(StaffView),
  places: z.array(ServicePlace),
  services: z.array(z.object({ id: Uuid, name: z.string(), categoryId: Uuid.optional(), staffRule: ServiceStaffRule })),
  categories: z.array(CatalogueCategory),
  /** The members a profile may be linked to, with the profile each already is (`services.manage` only). */
  members: z.array(z.object({ id: Uuid, name: z.string(), staffId: Uuid.optional() })).optional(),
  /** Whether the reader may change profiles (`services.manage`), beyond shifts. */
  canManage: z.boolean(),
});
/** Settings › Staff and Shifts. */
export type StaffTeamView = z.infer<typeof StaffTeamView>;

/** A staff profile as the editor sends it. */
export const StaffFields = z.object({
  name: Name(L.staffNameMax, 'Give their name.'),
  title: Text(L.staffTitleMax).optional(),
  bio: Text(L.staffBioMax).optional(),
  color: Hue.nullable(),
  placeIds: z.array(Uuid).max(20),
  /** Every live service they do; one whose rule is `all` turns to the chosen staff when they leave it out. */
  serviceIds: z.array(Uuid).max(L.services),
});
/** A staff profile as the editor sends it. */
export type StaffFields = z.infer<typeof StaffFields>;

const Write = WorkspaceScoped.extend({ mutationId: Uuid });

/** Adds or renames a category; `id` is the caller's own, so a retry makes one. */
export const SaveCategoryInput = Write.extend({ id: Uuid, name: Name(L.categoryNameMax, 'Name the category.') });
/** Adds or renames a category. */
export type SaveCategoryInput = z.infer<typeof SaveCategoryInput>;

/** One category; its services stay, under no category. */
export const CategoryInput = Write.extend({ categoryId: Uuid });
/** One category. */
export type CategoryInput = z.infer<typeof CategoryInput>;

/** Moves a category to `toIndex` among the categories. */
export const MoveCategoryInput = CategoryInput.extend({ toIndex: z.number().int().min(0).max(L.categories) });
/** Moves a category. */
export type MoveCategoryInput = z.infer<typeof MoveCategoryInput>;

/** Adds or changes a service, whole; `id` is the caller's own, so a retry makes one. */
export const SaveServiceInput = Write.extend({ id: Uuid, service: ServiceFields });
/** Adds or changes a service. */
export type SaveServiceInput = z.infer<typeof SaveServiceInput>;

/** Moves a service into a category (null: none) at `toIndex` there. */
export const MoveServiceInput = Write.extend({
  serviceId: Uuid,
  categoryId: Uuid.nullable(),
  toIndex: z.number().int().min(0).max(L.services),
});
/** Moves a service. */
export type MoveServiceInput = z.infer<typeof MoveServiceInput>;

/** Several services at once (bulk actions). */
export const ServicesInput = Write.extend({ serviceIds: z.array(Uuid).min(1).max(L.bulk) });
/** Several services at once. */
export type ServicesInput = z.infer<typeof ServicesInput>;

/** Several services online or off. */
export const SetServicesOnlineInput = ServicesInput.extend({ online: z.boolean() });
/** Several services online or off. */
export type SetServicesOnlineInput = z.infer<typeof SetServicesOnlineInput>;

/** Several services into one category (null: none), after its last. */
export const SetServicesCategoryInput = ServicesInput.extend({ categoryId: Uuid.nullable() });
/** Several services into one category. */
export type SetServicesCategoryInput = z.infer<typeof SetServicesCategoryInput>;

/** Adds or changes a staff profile; `id` is the caller's own, so a retry makes one. */
export const SaveStaffInput = Write.extend({ id: Uuid, staff: StaffFields });
/** Adds or changes a staff profile. */
export type SaveStaffInput = z.infer<typeof SaveStaffInput>;

/** One staff profile. */
export const StaffInput = Write.extend({ staffId: Uuid });
/** One staff profile. */
export type StaffInput = z.infer<typeof StaffInput>;

/** Moves a staff profile to `toIndex` (the order "Any professional" breaks ties by). */
export const MoveStaffInput = StaffInput.extend({ toIndex: z.number().int().min(0).max(L.staff) });
/** Moves a staff profile. */
export type MoveStaffInput = z.infer<typeof MoveStaffInput>;

/** Links a profile to a member, or unlinks it (null). */
export const LinkStaffInput = StaffInput.extend({ memberId: Uuid.nullable() });
/** Links a profile to a member. */
export type LinkStaffInput = z.infer<typeof LinkStaffInput>;

/**
 * A staff member's shifts at a place, whole: the weekly pattern and every date override in one write, so a "copy to
 * all weeks" saves all seven days at once.
 */
export const SetShiftsInput = StaffInput.extend({ placeId: Uuid, shifts: PlaceHours, outsideHours: z.boolean() });
/** A staff member's shifts at a place. */
export type SetShiftsInput = z.infer<typeof SetShiftsInput>;

/** Copies one staff member's weekly shifts at a place to others who work there (AC-6612). */
export const CopyShiftsInput = StaffInput.extend({
  placeId: Uuid,
  toStaffIds: z.array(Uuid).min(1).max(L.copyTo),
});
/** Copies weekly shifts. */
export type CopyShiftsInput = z.infer<typeof CopyShiftsInput>;

/** Adds time off for an unlinked staff member (a linked one uses their own, in Availability). */
export const AddTimeOffInput = StaffInput.extend({
  id: Uuid,
  placeId: Uuid.optional(),
  start: Timestamp,
  end: Timestamp,
  reason: z.enum(STAFF_TIME_OFF_REASONS, { error: 'Pick a reason.' }),
});
/** Adds time off. */
export type AddTimeOffInput = z.infer<typeof AddTimeOffInput>;

/** Adds a block of time at a place for an unlinked staff member. */
export const AddBlockInput = StaffInput.extend({
  id: Uuid,
  placeId: Uuid,
  start: Timestamp,
  end: Timestamp,
  reason: Text(L.blockReasonMax).optional(),
});
/** Adds a block. */
export type AddBlockInput = z.infer<typeof AddBlockInput>;

/** Removes one time off or one block. */
export const RemoveStaffTimeInput = Write.extend({ id: Uuid });
/** Removes one time off or block. */
export type RemoveStaffTimeInput = z.infer<typeof RemoveStaffTimeInput>;

/** The times a service could start on a place date, for the desk (`services.calendar`). */
export const ServiceTimesInput = WorkspaceScoped.extend({
  placeId: Uuid,
  serviceId: Uuid,
  variantId: Uuid,
  staffId: Uuid.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day.'),
});
/** The times query. */
export type ServiceTimesInput = z.infer<typeof ServiceTimesInput>;

/** The offered starts, each with the staff member it would go to. */
export const ServiceTimesView = z.object({
  times: z.array(z.object({ start: Timestamp, end: Timestamp, staffId: Uuid.optional() })),
});
/** The offered starts. */
export type ServiceTimesView = z.infer<typeof ServiceTimesView>;

/** Staff photos: what the upload answers. */
export const UploadedStaffPhoto = z.object({ photo: z.string() });
/** What a staff photo upload answers. */
export type UploadedStaffPhoto = z.infer<typeof UploadedStaffPhoto>;

/** The services procedures (spec 0066 B1). */
export const servicesContract = {
  catalogue: oc.input(WorkspaceScoped).output(CatalogueView),
  saveCategory: oc.input(SaveCategoryInput).output(CatalogueView),
  deleteCategory: oc.input(CategoryInput).output(CatalogueView),
  moveCategory: oc.input(MoveCategoryInput).output(CatalogueView),
  saveService: oc.input(SaveServiceInput).output(CatalogueView),
  moveService: oc.input(MoveServiceInput).output(CatalogueView),
  setOnline: oc.input(SetServicesOnlineInput).output(CatalogueView),
  setCategory: oc.input(SetServicesCategoryInput).output(CatalogueView),
  archive: oc.input(ServicesInput).output(CatalogueView),
  restore: oc.input(ServicesInput).output(CatalogueView),
  team: oc.input(WorkspaceScoped).output(StaffTeamView),
  shifts: oc.input(WorkspaceScoped).output(StaffTeamView),
  saveStaff: oc.input(SaveStaffInput).output(StaffTeamView),
  moveStaff: oc.input(MoveStaffInput).output(StaffTeamView),
  linkStaff: oc.input(LinkStaffInput).output(StaffTeamView),
  archiveStaff: oc.input(StaffInput).output(StaffTeamView),
  restoreStaff: oc.input(StaffInput).output(StaffTeamView),
  removeStaffPhoto: oc.input(StaffInput).output(StaffTeamView),
  setShifts: oc.input(SetShiftsInput).output(StaffTeamView),
  copyShifts: oc.input(CopyShiftsInput).output(StaffTeamView),
  addTimeOff: oc.input(AddTimeOffInput).output(StaffTeamView),
  removeTimeOff: oc.input(RemoveStaffTimeInput).output(StaffTeamView),
  addBlock: oc.input(AddBlockInput).output(StaffTeamView),
  removeBlock: oc.input(RemoveStaffTimeInput).output(StaffTeamView),
  times: oc.input(ServiceTimesInput).output(ServiceTimesView),
};
