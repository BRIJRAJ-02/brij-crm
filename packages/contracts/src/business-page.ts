// Settings › Business › Page (spec 0066, B4 lite): the business page's editor. The handle is claimed at once (spec
// 0068, AC-6813: handles are reserved at once, live on Publish); everything else is a draft that guests never see
// until Publish, which refuses a page that would be broken with one line saying what to fix. Every procedure is
// inside a workspace, behind the member door, for `hospitality.manage`, and refuses `APP_NOT_INSTALLED` while no
// business app is installed. The pure rules are in `business-page-model.ts`, shared with the browser without Zod.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BUSINESS_AMENITIES, BUSINESS_PAGE_LIMITS, placeSlugProblem } from './business-page-model.ts';
import { HANDLE_PATTERN, isReservedHandle } from './booking/handles.ts';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

export * from './business-page-model.ts';

const L = BUSINESS_PAGE_LIMITS;

/** One amenity from the closed list. */
export const BusinessAmenityName = z.enum(BUSINESS_AMENITIES, { error: 'Pick from the list.' });
/** One amenity. */
export type BusinessAmenityName = z.infer<typeof BusinessAmenityName>;

/** One picture of the gallery: its id, its size, and a description for people who can't see it. */
export const BusinessPhoto = z.strictObject({
  id: Uuid,
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  alt: z
    .string()
    .trim()
    .max(L.altMax, `Use ${String(L.altMax)} characters or fewer.`)
    .optional(),
});
/** One picture of the gallery. */
export type BusinessPhoto = z.infer<typeof BusinessPhoto>;

/** The page's own content, as drafted and as published. */
export const BusinessPageContent = z
  .strictObject({
    gallery: z.array(BusinessPhoto).max(L.photos, `A page shows up to ${String(L.photos)} photos.`),
    amenities: z.array(BusinessAmenityName).max(BUSINESS_AMENITIES.length),
    about: z
      .string()
      .trim()
      .max(L.aboutMax, `Use ${String(L.aboutMax)} characters or fewer.`)
      .optional(),
    hiddenPlaces: z.array(Uuid).max(20),
  })
  .refine((content) => new Set(content.gallery.map((photo) => photo.id)).size === content.gallery.length, {
    error: 'A photo is in the gallery twice.',
    path: ['gallery'],
  })
  .refine((content) => new Set(content.amenities).size === content.amenities.length, {
    error: 'An amenity is listed twice.',
    path: ['amenities'],
  });
/** The page's own content. */
export type BusinessPageContent = z.infer<typeof BusinessPageContent>;

/** A business handle as claimed: a handle's shape, and never a word kept for Timefix. */
export const BusinessHandle = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters.')
  .max(40, 'Use at most 40 characters.')
  .regex(HANDLE_PATTERN, 'Use lowercase letters, numbers and single hyphens.')
  .refine((handle) => !isReservedHandle(handle), { error: 'That address is kept for Timefix. Pick another.' });
/** A business handle. */
export type BusinessHandle = z.infer<typeof BusinessHandle>;

/** A place's slug as set: a slug's shape, never one of the business's own words (`book`, `reserve`, …). */
export const PlaceSlug = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((slug, context) => {
    const problem = placeSlugProblem(slug);
    if (problem !== undefined) context.addIssue({ code: 'custom', message: problem });
  });
/** A place's slug. */
export type PlaceSlug = z.infer<typeof PlaceSlug>;

/** What Publish would refuse, in one line, and where to fix it. */
export const BusinessPublishProblem = z.object({
  message: z.string(),
  fix: z.enum(['handle', 'profile', 'place', 'hours', 'address', 'services', 'staff', 'shifts']),
  placeId: Uuid.optional(),
});
/** What Publish would refuse. */
export type BusinessPublishProblem = z.infer<typeof BusinessPublishProblem>;

/** One place as the page editor lists it: its address on the page and whether it is ready. */
export const BusinessPagePlace = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string().optional(),
  hasAddress: z.boolean(),
  hasHours: z.boolean(),
});
/** One place in the page editor. */
export type BusinessPagePlace = z.infer<typeof BusinessPagePlace>;

/**
 * Which business a page call works in (spec 0065 H7, AC-6592): the switcher's choice; left out, the workspace's first.
 * One of another workspace answers `NOT_FOUND`. (The same shape as `PropertyScoped`, kept here so this file imports no
 * hospitality schema.)
 */
export const BusinessPageScoped = WorkspaceScoped.extend({ property: Uuid.optional() });
/** Which business a page call works in. */
export type BusinessPageScoped = z.infer<typeof BusinessPageScoped>;

/** Settings › Business › Page: the handle, the draft, what is live, and what Publish needs. */
export const BusinessPageView = z.object({
  handle: z.string().optional(),
  /**
   * This business's address is taken only at its first Publish (spec 0065 H7, AC-6592): a business other than the
   * first, holding none yet. `handle`, when present, is the one it chose, which Publish can still find taken.
   */
  handleOnPublish: z.literal(true).optional(),
  /**
   * While there is no handle yet: a free one the business's name suggests (`somewhere-nowhere`), for the editor to
   * start the field with. Absent once there is a handle, or when the name suggests none that is free.
   */
  suggestedHandle: z.string().optional(),
  draft: BusinessPageContent,
  /** When the page went live last, and its version; absent while it has never been published. */
  published: z.object({ at: Timestamp, version: z.number().int().positive() }).optional(),
  /** Whether the draft differs from what guests see. */
  hasChanges: z.boolean(),
  /** What differs, in plain sentences ("Gallery: 2 photos added"). */
  changes: z.array(z.string()),
  places: z.array(BusinessPagePlace),
  /** Whether the Menu and Table seating apps are installed (what the page will show). */
  showsMenu: z.boolean(),
  showsReserve: z.boolean(),
  problem: BusinessPublishProblem.optional(),
});
/** The page editor's view. */
export type BusinessPageView = z.infer<typeof BusinessPageView>;

/**
 * Claims the page's address: at once for the first business (not drafted); for another, kept until its first Publish
 * takes it (AC-6592). A workspace takes at most 5 new addresses a day (`LIMIT_REACHED`).
 */
export const ClaimBusinessHandleInput = BusinessPageScoped.extend({ handle: BusinessHandle, mutationId: Uuid });
/** Claims the page's address. */
export type ClaimBusinessHandleInput = z.infer<typeof ClaimBusinessHandleInput>;

/** Saves the draft, whole. */
export const SaveBusinessPageInput = BusinessPageScoped.extend({ draft: BusinessPageContent, mutationId: Uuid });
/** Saves the draft. */
export type SaveBusinessPageInput = z.infer<typeof SaveBusinessPageInput>;

/** Sets a place's slug (at once: the old one keeps finding it). */
export const SetPlaceSlugInput = BusinessPageScoped.extend({ placeId: Uuid, slug: PlaceSlug, mutationId: Uuid });
/** Sets a place's slug. */
export type SetPlaceSlugInput = z.infer<typeof SetPlaceSlugInput>;

/** Publish or Discard: the draft goes live, or goes back to what is live. */
export const BusinessPageStepInput = BusinessPageScoped.extend({ mutationId: Uuid });
/** Publish or Discard. */
export type BusinessPageStepInput = z.infer<typeof BusinessPageStepInput>;

/** A gallery picture as uploaded: its id and size, ready to go into the draft. */
export const UploadedBusinessPhoto = z.object({ id: Uuid, width: z.number().int(), height: z.number().int() });
/** A gallery picture as uploaded. */
export type UploadedBusinessPhoto = z.infer<typeof UploadedBusinessPhoto>;

/**
 * The page editor (B4 lite). All `hospitality.manage`'s. `claimHandle` refuses `NAME_TAKEN` on `handle` for an
 * address anybody holds, `LIMIT_REACHED` past 20; `setPlaceSlug` refuses `NAME_TAKEN` on `slug` for one another place
 * of the business held; `publish` refuses `VALIDATION_FAILED` with the one line Publish needs fixed.
 */
export const businessPageContract = {
  page: oc.input(BusinessPageScoped).output(BusinessPageView),
  claimHandle: oc.input(ClaimBusinessHandleInput).output(BusinessPageView),
  save: oc.input(SaveBusinessPageInput).output(BusinessPageView),
  setPlaceSlug: oc.input(SetPlaceSlugInput).output(BusinessPageView),
  publish: oc.input(BusinessPageStepInput).output(BusinessPageView),
  discard: oc.input(BusinessPageStepInput).output(BusinessPageView),
};
