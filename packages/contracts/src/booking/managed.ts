// Managed booking pages (spec 0037, AC-1333 to AC-1336): one template holding a page's settings, the members it
// makes a page for, and which parts those members may not change. Each member gets their own page, owned by them,
// at `<template slug>-<first name>`; the template's own public link answers "no longer available", since a template
// is not a page. Saving the template copies its locked parts to every member page in one transaction (AC-1334);
// removing a member deletes their page (AC-1335); deleting the template leaves every member page standing.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { BookingPageSettings } from './settings.ts';

/** The most members one template makes pages for (spec 0037's Numbers): past it, 409 `MANAGED_MEMBERS_LIMIT`. */
export const MANAGED_MEMBERS_MAX = 200;

/**
 * The parts of a managed page that can be locked (AC-1333), in the order the template editor lists them. A locked
 * part is the workspace's: the member sees it read only, and the server refuses their write to it (AC-1334).
 */
export const MANAGED_PARTS = [
  'address',
  'details',
  'durations',
  'location',
  'questions',
  'on_booking',
  'limits',
  'hours',
] as const;

/** One lockable part of a managed page. */
export const ManagedPart = z.enum(MANAGED_PARTS);
/** One lockable part of a managed page. */
export type ManagedPart = z.infer<typeof ManagedPart>;

/**
 * Which settings each part owns (AC-1334): the server refuses a member's write to any key of a locked part, and the
 * propagation copies exactly these keys from the template. Every other setting is the member's own always: their
 * page's address, where it sits on their profile, their social links, whether it is live, private, and which view it
 * opens in. Keyed by part so one list serves the lock check, the propagation and the editor's read only fields.
 */
export const MANAGED_PART_KEYS = {
  // The address is the template's by AC-1333 (`intro-call-sam`, the Value sourcing table), not a judgement call:
  // a member who renamed it would break links already shared and drift the workspace's addressing (coordinator,
  // 3 November 2026). `status`, `isPrivate`, the profile placement, `showSocials`, `defaultView` and `formOnly`
  // stay the member's own: the workspace sets what the page asks, the member owns whether it takes bookings, so
  // someone away can always stop their page sending them meetings.
  address: ['slug'],
  details: ['title', 'description'],
  durations: ['durations'],
  location: ['location'],
  questions: ['questions'],
  on_booking: ['fileToCrm', 'answersObjectId'],
  // `slotStep` belongs to Limits, not Durations: the part names are what the editor shows, and the editor puts
  // "Slots start every" under Limits with the buffers and the window.
  limits: ['bufferBefore', 'bufferAfter', 'minNoticeMinutes', 'windowDays', 'dailyLimit', 'slotStep'],
  // The Hours rule, not the hours: a member page always books on its own member's hours (AC-1336). Locked, the
  // member's default schedule is used and they may not name another; unlocked, they pick one (spec 0035, AC-966).
  hours: ['scheduleId'],
} as const satisfies Record<ManagedPart, readonly (keyof BookingPageSettings)[]>;

/** Which settings each lockable part owns. */
export type ManagedPartKeys = typeof MANAGED_PART_KEYS;

/** The locked parts of a template: each named once. */
export const ManagedLocks = z
  .array(ManagedPart)
  .max(MANAGED_PARTS.length)
  .refine((parts) => new Set(parts).size === parts.length, { error: 'Name each part once.' });
/** The locked parts of a template. */
export type ManagedLocks = z.infer<typeof ManagedLocks>;

/** One member of a template, as the editor lists them, with the page they hold now. */
export const ManagedMemberView = z.object({
  /** The member's id, which is also the row's key. */
  id: Uuid,
  name: z.string(),
  /** Their page made from this template, when they have one; absent while it is being made or after it went. */
  pageId: Uuid.optional(),
  /** Their page's address after their handle, when they have one. */
  slug: z.string().optional(),
});
/** One member of a template. */
export type ManagedMemberView = z.infer<typeof ManagedMemberView>;

/** A template as its editor reads it (AC-1333). */
export const ManagedPageView = z.object({
  id: Uuid,
  title: z.string(),
  /** The template's own slug: every member page's address starts with it. */
  slug: z.string(),
  /** The description every member page takes from it, when Details is locked; its editor shows it either way. */
  description: z.string(),
  locked: ManagedLocks,
  /** The team the template follows, when it follows one instead of naming members. */
  followTeamId: Uuid.nullable(),
  members: z.array(ManagedMemberView),
  /** Whether the reader may change the template (`booking.admin`, or one of its editors). */
  canChange: z.boolean(),
});
/** A template as its editor reads it. */
export type ManagedPageView = z.infer<typeof ManagedPageView>;

/** Every template in the workspace, newest first. */
export const ManagedPageList = z.object({ templates: z.array(ManagedPageView) });
/** Every template in the workspace. */
export type ManagedPageList = z.infer<typeof ManagedPageList>;

/** Which template. */
export const GetManagedPageInput = WorkspaceScoped.extend({ templateId: Uuid });
/** Which template. */
export type GetManagedPageInput = z.infer<typeof GetManagedPageInput>;

/** Every template. */
export const ListManagedPagesInput = WorkspaceScoped;
/** Every template. */
export type ListManagedPagesInput = z.infer<typeof ListManagedPagesInput>;

/**
 * A new template (AC-1333): its title and time zone as a page's, the parts locked, and the members it makes pages
 * for, or the team it follows. The same `id` again answers the template it made (a retry).
 */
export const CreateManagedPageInput = WorkspaceScoped.extend({
  id: Uuid,
  title: z.string().trim().min(1, 'Give the page a title.').max(120, 'Keep the title to 120 characters.'),
  timeZone: z.string(),
  settings: BookingPageSettings.partial().optional(),
  locked: ManagedLocks.optional(),
  memberIds: z.array(Uuid).max(MANAGED_MEMBERS_MAX).optional(),
  followTeamId: Uuid.optional(),
  mutationId: Uuid,
});
/** A new template. */
export type CreateManagedPageInput = z.infer<typeof CreateManagedPageInput>;

/**
 * A change to a template (AC-1334): only the settings given, and the locks when given. Every locked part is copied
 * to every member page in the same transaction, so no member is left on older settings than another.
 */
export const UpdateManagedPageInput = WorkspaceScoped.extend({
  templateId: Uuid,
  settings: BookingPageSettings.partial().optional(),
  locked: ManagedLocks.optional(),
  mutationId: Uuid,
});
/** A change to a template. */
export type UpdateManagedPageInput = z.infer<typeof UpdateManagedPageInput>;

/**
 * The template's members, replaced (AC-1335): each named once, at most 200. Someone added gets their page at once;
 * someone removed has theirs deleted the way spec 0025 AC-648 deletes one, their bookings kept. Each is emailed.
 */
export const SetManagedMembersInput = WorkspaceScoped.extend({
  templateId: Uuid,
  memberIds: z
    .array(Uuid)
    .max(MANAGED_MEMBERS_MAX)
    .refine((list) => new Set(list).size === list.length, { error: 'Add each person once.' }),
  mutationId: Uuid,
});
/** The template's members, replaced. */
export type SetManagedMembersInput = z.infer<typeof SetManagedMembersInput>;

/** A template deleted (AC-1335): every member page stays, as that member's own, no longer linked to it. */
export const DeleteManagedPageInput = WorkspaceScoped.extend({ templateId: Uuid, mutationId: Uuid });
/** A template deleted. */
export type DeleteManagedPageInput = z.infer<typeof DeleteManagedPageInput>;

/** Member procedures for managed booking pages. */
export const managedPagesContract = {
  list: oc.input(ListManagedPagesInput).output(ManagedPageList),
  get: oc.input(GetManagedPageInput).output(ManagedPageView),
  create: oc.input(CreateManagedPageInput).output(ManagedPageView),
  update: oc.input(UpdateManagedPageInput).output(ManagedPageView),
  setMembers: oc.input(SetManagedMembersInput).output(ManagedPageView),
  delete: oc.input(DeleteManagedPageInput).output(z.object({ deleted: z.literal(true) })),
};
