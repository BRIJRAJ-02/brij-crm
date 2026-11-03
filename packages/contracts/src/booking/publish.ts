// Publish for public pages (spec 0068, AC-6810 to AC-6816), booking pages first. An edit in the editor changes the
// page's draft (`bookingPages.saveDraft`); guests keep seeing the published page until Publish (`bookingPages.publish`)
// writes the draft into it and keeps a version. Discard drops the draft; a version (the last 20) can be restored as a
// new draft. What stays instant (AC-6813) never enters a draft: pausing, the address, the place on the profile, the
// hosts and routing, and where the answers are filed are written by `bookingPages.update` as before.
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { BookingPageSettings } from './settings.ts';

/**
 * The booking page settings an edit drafts (AC-6810): everything a guest sees of the page. Anything else is instant
 * (AC-6813): status, the address and the profile placement, privacy, filing, form only and the reschedule rule.
 */
export const BOOKING_DRAFT_KEYS = [
  'title',
  'description',
  'durations',
  'location',
  'bufferBefore',
  'bufferAfter',
  'minNoticeMinutes',
  'windowDays',
  'dailyLimit',
  'slotStep',
  'scheduleId',
  'defaultView',
  'showSocials',
  'questions',
] as const;
/** One drafted setting. */
export type BookingDraftKey = (typeof BOOKING_DRAFT_KEYS)[number];

/** The drafted settings, any of them, each checked as a write checks it; nothing else may be in a draft. */
export const BookingPageDraft = BookingPageSettings.pick({
  title: true,
  description: true,
  durations: true,
  location: true,
  bufferBefore: true,
  bufferAfter: true,
  minNoticeMinutes: true,
  windowDays: true,
  dailyLimit: true,
  slotStep: true,
  scheduleId: true,
  defaultView: true,
  showSocials: true,
  questions: true,
})
  .partial()
  .strict();
/** The drafted settings. */
export type BookingPageDraft = z.infer<typeof BookingPageDraft>;

/** The most versions a page keeps (AC-6812): Publish prunes the oldest past it. */
export const PAGE_VERSIONS_KEPT = 20;

/**
 * Where a page stands (AC-6811): `changes` names each unpublished change in a plain sentence ("Length 30 → 45 min"),
 * empty when the page is as guests see it; `changedAt` is when the draft last changed.
 */
export const PagePublication = z.object({
  changes: z.array(z.string()),
  changedAt: Timestamp.optional(),
});
/** Where a page stands. */
export type PagePublication = z.infer<typeof PagePublication>;

/** One published version (AC-6812): its number, when, and who, by name while they are a member. */
export const PageVersionView = z.object({
  version: z.number().int().min(1),
  publishedAt: Timestamp,
  publishedBy: z.string().optional(),
  /** This is what guests see now. */
  isCurrent: z.boolean(),
});
/** One published version. */
export type PageVersionView = z.infer<typeof PageVersionView>;

/** A page's versions, newest first. */
export const PageVersionList = z.object({ versions: z.array(PageVersionView) });
/** A page's versions. */
export type PageVersionList = z.infer<typeof PageVersionList>;

/** Changes some drafted settings: each given replaces the draft's, and one set back to what guests see leaves it. */
export const SaveBookingDraftInput = WorkspaceScoped.extend({
  pageId: Uuid,
  settings: BookingPageDraft,
  mutationId: Uuid,
});
/** Changes some drafted settings. */
export type SaveBookingDraftInput = z.infer<typeof SaveBookingDraftInput>;

/** Publish or Discard one page's draft. */
export const PageDraftInput = WorkspaceScoped.extend({ pageId: Uuid, mutationId: Uuid });
/** Publish or Discard one page's draft. */
export type PageDraftInput = z.infer<typeof PageDraftInput>;

/** One page's versions. */
export const ListPageVersionsInput = WorkspaceScoped.extend({ pageId: Uuid });
/** One page's versions. */
export type ListPageVersionsInput = z.infer<typeof ListPageVersionsInput>;

/** A version brought back as the page's draft, to look at and publish (AC-6812). */
export const RestorePageVersionInput = WorkspaceScoped.extend({
  pageId: Uuid,
  version: z.number().int().min(1),
  mutationId: Uuid,
});
/** A version brought back as the page's draft. */
export type RestorePageVersionInput = z.infer<typeof RestorePageVersionInput>;
