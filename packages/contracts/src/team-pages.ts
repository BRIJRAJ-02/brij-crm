// Team link pages (spec 0070, slice 1, AC-7001 to AC-7004): everyone's link page in one workspace, for owners, admins
// and holders of `link_pages.manage_team`. A page stays its member's: it is listed under their name, they keep editing
// it themselves, and every change someone else makes to it is written to History (`link_page.changed_for`). The
// editor itself is the member's own (the `profile.*` procedures with `member`, `PageScoped`); this namespace holds the
// list, the claim of a handle for someone, and the one line a member reads about who last changed their page.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { JobTitle, PublicHandle } from './profile.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/**
 * The header (or, on a read, the `member` query parameter) that names whose link page an upload or a picture read is
 * for (spec 0070, AC-7002): absent, the caller's own. The api lets it through the door's `enterTeamLinkPage` only.
 */
export const PAGE_MEMBER_HEADER = 'x-crm-page-member';

/**
 * What a change to someone else's link page was, as History words it (AC-7004): its blocks, its look, one of its
 * photos (its own value since 10 Nov 2026, never folded into the look), Live or Private, its QR code's style, whether
 * search engines list it, or a handle claimed for them. Publish, Discard and Restore keep
 * their own actions (`link_page.published` and the rest), whoever makes them.
 */
export const LINK_PAGE_TEAM_CHANGES = ['blocks', 'look', 'photo', 'live', 'private', 'qr', 'search', 'handle'] as const;
/** One kind of change to someone else's link page. */
export type LinkPageTeamChange = (typeof LINK_PAGE_TEAM_CHANGES)[number];

/** One member's link page as Team pages lists it (AC-7001). */
export const TeamLinkPage = z.object({
  memberId: Uuid,
  name: z.string(),
  /** Their picture as our own origin or their member row serves it, when there is one. */
  image: z.string().optional(),
  /** Their handle in this workspace; absent while they have none (Claim handle). */
  handle: z.string().optional(),
  /** Anyone can open the page now (Live); false while it is Private or has no handle. */
  isLive: z.boolean(),
  /** Views this calendar month (UTC), the same count the member's own Insights read. */
  views: z.number().int().min(0),
  /** The caller's own row: it opens their own editor, never the team one. */
  isSelf: z.boolean(),
  /**
   * A page only person (9 Nov 2026): added from Team pages with no Timefix login of their own. Only they can be
   * removed from Team pages; anyone else leaves through Members (or their partner).
   */
  isPageOnly: z.boolean().optional(),
  /** A page only person's own address, when they were given one: Invite to manage their page starts from it. */
  email: z.string().optional(),
  /** A page only person's open hand over (Invite to manage their page): to whom, and when it was last sent. */
  invite: z
    .object({
      email: z.string(),
      sentAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      /** Its 7 days are out: its link opens nothing, and it can be sent again. */
      isExpired: z.boolean().optional(),
    })
    .optional(),
});
/** One member's link page as Team pages lists it. */
export type TeamLinkPage = z.infer<typeof TeamLinkPage>;

/** Every active member's link page in the workspace, by name, and the month the views count. */
export const TeamLinkPages = z.object({
  pages: z.array(TeamLinkPage),
  /** The first day of the month counted, `YYYY-MM-DD` (UTC). */
  month: z.iso.date(),
});
/** Every active member's link page. */
export type TeamLinkPages = z.infer<typeof TeamLinkPages>;

/**
 * A handle claimed for a member who has none in this workspace (AC-7002). Unlike their own claim, the page starts
 * Private: a page with their name on it goes public only when someone turns on Live.
 */
export const ClaimTeamHandleInput = WorkspaceScoped.extend({
  member: Uuid,
  handle: PublicHandle,
  mutationId: Uuid,
});
/** A handle claimed for a member. */
export type ClaimTeamHandleInput = z.infer<typeof ClaimTeamHandleInput>;

/**
 * A page only person's name (9 Nov 2026): one line, no control characters, as a partner's person's is, since it is
 * their link page's name and History's.
 */
export const PageOnlyName = z
  .string()
  .trim()
  .min(1, 'Add their name.')
  .max(80, 'Use at most 80 characters for the name.')
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/, 'Use a name on one line.');
/** A page only person's name. */
export type PageOnlyName = z.infer<typeof PageOnlyName>;

/**
 * A page only person added from Team pages (9 Nov 2026): someone the workspace makes a link page for, who never signs
 * up. A name, an email when there is one (never an invitation, never an email to them), and their handle; the page
 * starts Private. `link_pages.manage_team` only. An address someone active here already uses, or an open invitation
 * names, is refused (`UNIQUE_CONFLICT` on `email`), and so is a full workspace (`SEAT_LIMIT`).
 */
export const AddPageOnlyPersonInput = WorkspaceScoped.extend({
  name: PageOnlyName,
  email: z.email('Enter a valid email address, or leave it empty.').max(254).optional(),
  handle: PublicHandle,
  mutationId: Uuid,
});
/** A page only person added from Team pages. */
export type AddPageOnlyPersonInput = z.infer<typeof AddPageOnlyPersonInput>;

/**
 * A page only person removed from Team pages: their handle stops working and their page's content is kept 30 days,
 * as any removal's. Anyone else is `NOT_FOUND` here (Members removes them).
 */
export const RemovePageOnlyPersonInput = WorkspaceScoped.extend({ member: Uuid, mutationId: Uuid });
/** A page only person removed from Team pages. */
export type RemovePageOnlyPersonInput = z.infer<typeof RemovePageOnlyPersonInput>;

/**
 * A page only person's name and the line under it, changed from their page's editor (9 Nov 2026, the owner: "an option
 * to change the name and an option to add title below the name"). Either or both; an empty title clears it. Only a page
 * only person in this workspace: anyone with a login changes their own in Profile, so they are `NOT_FOUND` here, and
 * one made an owner or admin since is `FORBIDDEN`.
 */
export const NamePageOnlyPersonInput = WorkspaceScoped.extend({
  member: Uuid,
  name: PageOnlyName.optional(),
  jobTitle: JobTitle.optional(),
  mutationId: Uuid,
});
/** A page only person's name and title. */
export type NamePageOnlyPersonInput = z.infer<typeof NamePageOnlyPersonInput>;

/**
 * A page only person's name and title as saved, and whether the title shows under the name on their page: a title
 * given here is meant to show, so it does; one cleared shows nothing.
 */
export const PageOnlyNamed = z.object({
  name: z.string(),
  jobTitle: z.string().optional(),
  showJobTitle: z.boolean(),
});
/** A page only person's name and title as saved. */
export type PageOnlyNamed = z.infer<typeof PageOnlyNamed>;

/** A handle checked as it is typed in Add a page: free means nobody holds or ever held it, and it isn't reserved. */
export const TeamHandleCheckInput = WorkspaceScoped.extend({ handle: z.string().trim().toLowerCase().max(64) });
/** A handle checked as it is typed. */
export type TeamHandleCheckInput = z.infer<typeof TeamHandleCheckInput>;

/** Whether a handle can be claimed now. */
export const TeamHandleCheck = z.object({ isFree: z.boolean() });
/** Whether a handle can be claimed now. */
export type TeamHandleCheck = z.infer<typeof TeamHandleCheck>;

/** A free handle made from a name, for Add a page's first value. */
export const TeamHandleSuggestInput = WorkspaceScoped.extend({ name: z.string().trim().max(80) });
/** A free handle made from a name. */
export type TeamHandleSuggestInput = z.infer<typeof TeamHandleSuggestInput>;

/** The suggestion, absent when every try was taken. */
export const TeamHandleSuggestion = z.object({ handle: z.string().optional() });
/** The suggestion. */
export type TeamHandleSuggestion = z.infer<typeof TeamHandleSuggestion>;

/**
 * Invite to manage their page (9 Nov 2026): an email invitation that hands a page only person's page to whoever opens
 * it at that address, who signs up there and is the same member from then on, with their page, handle and history.
 * `link_pages.manage_team` and `members.invite` (it lets someone in with a login). Sent again to the same person, it
 * replaces the open one (a new link, a fresh 7 days). An address someone else here uses, or another open invitation
 * names, is refused (`UNIQUE_CONFLICT` on `email`).
 */
export const InviteToManagePageInput = WorkspaceScoped.extend({
  member: Uuid,
  email: z.email('Enter a valid email address.').max(254),
  mutationId: Uuid,
});
/** Invite to manage their page. */
export type InviteToManagePageInput = z.infer<typeof InviteToManagePageInput>;

/** The hand over as sent, and whether its email went out (it stands either way, and can be sent again). */
export const PageInviteSent = z.object({
  invite: z.object({
    email: z.string(),
    sentAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    isExpired: z.boolean().optional(),
  }),
  sent: z.boolean(),
});
/** The hand over as sent. */
export type PageInviteSent = z.infer<typeof PageInviteSent>;

/** Cancels a page only person's open hand over: its link stops working at once. */
export const CancelPageInviteInput = WorkspaceScoped.extend({ member: Uuid, mutationId: Uuid });
/** Cancels a page's hand over. */
export type CancelPageInviteInput = z.infer<typeof CancelPageInviteInput>;

/** Whether there was an open hand over to cancel. */
export const PageInviteCancelled = z.object({ cancelled: z.boolean() });
/** Whether there was an open hand over to cancel. */
export type PageInviteCancelled = z.infer<typeof PageInviteCancelled>;

/** Whether the removal changed anything (false when they were already gone). */
export const PageOnlyRemoved = z.object({ removed: z.boolean() });
/** Whether the removal changed anything. */
export type PageOnlyRemoved = z.infer<typeof PageOnlyRemoved>;

/**
 * Who last changed the caller's own link page, when it was someone else (AC-7004): "Edited by Ana", on their own
 * page. Absent when nobody else has.
 */
export const LinkPageEditedBy = z.object({
  last: z.object({ name: z.string(), at: z.iso.datetime() }).optional(),
});
/** Who last changed the caller's own link page. */
export type LinkPageEditedBy = z.infer<typeof LinkPageEditedBy>;

/**
 * The team pages namespace. Everything but `editedBy` (any member's own) needs `link_pages.manage_team`: the list, a
 * claim, and adding, removing and naming a page only person.
 */
export const teamPagesContract = {
  list: oc.input(WorkspaceScoped).output(TeamLinkPages),
  claim: oc.input(ClaimTeamHandleInput).output(TeamLinkPage),
  addPerson: oc.input(AddPageOnlyPersonInput).output(TeamLinkPage),
  removePerson: oc.input(RemovePageOnlyPersonInput).output(PageOnlyRemoved),
  namePerson: oc.input(NamePageOnlyPersonInput).output(PageOnlyNamed),
  invitePerson: oc.input(InviteToManagePageInput).output(PageInviteSent),
  cancelInvite: oc.input(CancelPageInviteInput).output(PageInviteCancelled),
  checkHandle: oc.input(TeamHandleCheckInput).output(TeamHandleCheck),
  suggestHandle: oc.input(TeamHandleSuggestInput).output(TeamHandleSuggestion),
  editedBy: oc.input(WorkspaceScoped).output(LinkPageEditedBy),
};
