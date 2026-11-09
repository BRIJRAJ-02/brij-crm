import { claimTeamHandle, listTeamLinkPages, readLinkPageEditedBy } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Team link pages (spec 0070, slice 1): everyone's link page in the workspace for a holder of
// `link_pages.manage_team` (checked in packages/core before anything is read), a handle claimed for someone, and who
// last changed the caller's own page. Editing a member's page goes through the `profile.*` procedures with `member`.
export const teamPagesRouter = member.teamPages.router({
  list: member.teamPages.list.handler(({ context }) => listTeamLinkPages(context.scope)),
  claim: member.teamPages.claim.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      claimTeamHandle(context.scope, { member: input.member, handle: input.handle }, sourceOf(context)),
    ),
  ),
  editedBy: member.teamPages.editedBy.handler(({ context }) => readLinkPageEditedBy(context.scope)),
});
