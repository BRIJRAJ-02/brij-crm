import { linkPageCacheTags } from '@crm/contracts';
import {
  addPageOnlyPerson,
  checkTeamHandle,
  claimTeamHandle,
  listTeamLinkPages,
  namePageOnlyPerson,
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
  // A page only person's name and the title under it (9 Nov 2026), from their page's editor. Their page draws both,
  // so the edge's copies of it are deleted once the change has committed.
  namePerson: member.teamPages.namePerson.handler(async ({ context, input }) => {
    const { handle, ...named } = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      namePageOnlyPerson(
        context.scope,
        { member: input.member, name: input.name, jobTitle: input.jobTitle },
        hooks,
        sourceOf(context),
      ),
    );
    if (handle !== undefined) await context.edgeCache.forget(linkPageCacheTags(handle));
    return named;
  }),
  checkHandle: member.teamPages.checkHandle.handler(({ context, input }) =>
    checkTeamHandle(context.scope, { handle: input.handle }),
  ),
  suggestHandle: member.teamPages.suggestHandle.handler(({ context, input }) =>
    suggestTeamHandle(context.scope, { name: input.name }),
  ),
  editedBy: member.teamPages.editedBy.handler(({ context }) => readLinkPageEditedBy(context.scope)),
});
