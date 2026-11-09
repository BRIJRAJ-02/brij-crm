import {
  addPageOnlyPerson,
  checkTeamHandle,
  claimTeamHandle,
  listTeamLinkPages,
  readLinkPageEditedBy,
  removePageOnlyPerson,
  suggestTeamHandle,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Team link pages (spec 0070, slice 1): everyone's link page in the workspace for a holder of
// `link_pages.manage_team` (checked in packages/core before anything is read), a handle claimed for someone, and who
// last changed the caller's own page. Editing a member's page goes through the `profile.*` procedures with `member`.
// Page only people (9 Nov 2026): added with a page and removed again from Team pages, their identity made by the
// identity login (`context.pageOnlyUsers`), never the app's.
export const teamPagesRouter = member.teamPages.router({
  list: member.teamPages.list.handler(({ context }) => listTeamLinkPages(context.scope)),
  claim: member.teamPages.claim.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      claimTeamHandle(context.scope, { member: input.member, handle: input.handle }, sourceOf(context)),
    ),
  ),
  addPerson: member.teamPages.addPerson.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      addPageOnlyPerson(
        context.scope,
        { name: input.name, email: input.email, handle: input.handle },
        { users: context.pageOnlyUsers },
        hooks,
        sourceOf(context),
      ),
    ),
  ),
  removePerson: member.teamPages.removePerson.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removePageOnlyPerson(
        context.scope,
        { member: input.member },
        { users: context.pageOnlyUsers },
        hooks,
        sourceOf(context),
      ),
    ),
  ),
  checkHandle: member.teamPages.checkHandle.handler(({ context, input }) =>
    checkTeamHandle(context.scope, { handle: input.handle }),
  ),
  suggestHandle: member.teamPages.suggestHandle.handler(({ context, input }) =>
    suggestTeamHandle(context.scope, { name: input.name }),
  ),
  editedBy: member.teamPages.editedBy.handler(({ context }) => readLinkPageEditedBy(context.scope)),
});
