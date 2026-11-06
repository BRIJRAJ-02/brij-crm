// Team link pages (spec 0070, slice 1, AC-7001 to AC-7004): everyone's link page in one workspace, for owners, admins
// and holders of `link_pages.manage_team`. A page stays its member's: it is listed under their name, they keep editing
// it themselves, and every change someone else makes to it is written to History (`link_page.changed_for`). The
// editor itself is the member's own (the `profile.*` procedures with `member`, `PageScoped`); this namespace holds the
// list, the claim of a handle for someone, and the one line a member reads about who last changed their page.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { PublicHandle } from './profile.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/**
 * The header (or, on a read, the `member` query parameter) that names whose link page an upload or a picture read is
 * for (spec 0070, AC-7002): absent, the caller's own. The api lets it through the door's `enterTeamLinkPage` only.
 */
export const PAGE_MEMBER_HEADER = 'x-crm-page-member';

/**
 * What a change to someone else's link page was, as History words it (AC-7004): its blocks, its look, Live or Private,
 * its QR code's style, whether search engines list it, or a handle claimed for them. Publish, Discard and Restore keep
 * their own actions (`link_page.published` and the rest), whoever makes them.
 */
export const LINK_PAGE_TEAM_CHANGES = ['blocks', 'look', 'live', 'private', 'qr', 'search', 'handle'] as const;
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

/** A handle claimed for a member who has none in this workspace (AC-7002); it lives at once, as their own claim does. */
export const ClaimTeamHandleInput = WorkspaceScoped.extend({
  member: Uuid,
  handle: PublicHandle,
  mutationId: Uuid,
});
/** A handle claimed for a member. */
export type ClaimTeamHandleInput = z.infer<typeof ClaimTeamHandleInput>;

/**
 * Who last changed the caller's own link page, when it was someone else (AC-7004): "Edited by Ana", on their own
 * page. Absent when nobody else has.
 */
export const LinkPageEditedBy = z.object({
  last: z.object({ name: z.string(), at: z.iso.datetime() }).optional(),
});
/** Who last changed the caller's own link page. */
export type LinkPageEditedBy = z.infer<typeof LinkPageEditedBy>;

/** The team pages namespace. `list` and `claim` need `link_pages.manage_team`; `editedBy` is any member's own. */
export const teamPagesContract = {
  list: oc.input(WorkspaceScoped).output(TeamLinkPages),
  claim: oc.input(ClaimTeamHandleInput).output(TeamLinkPage),
  editedBy: oc.input(WorkspaceScoped).output(LinkPageEditedBy),
};
