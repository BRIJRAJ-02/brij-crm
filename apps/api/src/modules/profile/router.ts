import { myPicturePath } from '@crm/contracts';
import {
  archiveProfileItem,
  deleteProfileItem,
  getMyProfile,
  listProfilePageChoices,
  orderProfileItems,
  readProfileItems,
  saveProfileItem,
  servedPicture,
  updateMyMemberProfile,
  type ProfileExtras,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext, type SessionContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

/**
 * What only the session knows: the account picture as our own origin serves it (`/api/me/picture?v=`), when it is
 * one of Google's, and whether Google is linked (for Sync Google photo), where Google sign in is on.
 */
async function extrasOf(context: RequestContext & SessionContext): Promise<ProfileExtras> {
  const { user } = context;
  const picture = servedPicture(user.id, user.image);
  const google = context.auth.providers.google
    ? (await context.googleLinked(user.id))
      ? 'linked'
      : 'unlinked'
    : undefined;
  return {
    ...(picture === undefined ? {} : { image: myPicturePath(picture.version) }),
    ...(google === undefined ? {} : { google }),
  };
}

// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own member row, behind the member door.
export const profileRouter = member.profile.router({
  get: member.profile.get.handler(async ({ context }) => getMyProfile(context.scope, await extrasOf(context))),
  update: member.profile.update.handler(async ({ context, input }) => {
    const extras = await extrasOf(context);
    return commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateMyMemberProfile(
        context.scope,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(input.handle === undefined ? {} : { handle: input.handle }),
          ...(input.bio === undefined ? {} : { bio: input.bio }),
          ...(input.pictureHidden === undefined ? {} : { pictureHidden: input.pictureHidden }),
          ...(input.socials === undefined ? {} : { socials: input.socials }),
        },
        extras,
        hooks,
        sourceOf(context),
      ),
    );
  }),
  // The link page (spec 0051): the caller's own blocks, in every workspace the same, never another person's.
  items: member.profile.items.handler(({ context }) => readProfileItems(context.scope)),
  pageChoices: member.profile.pageChoices.handler(async ({ context }) => [
    ...(await listProfilePageChoices(context.scope)),
  ]),
  saveItem: member.profile.saveItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveProfileItem(context.scope, {
        id: input.id,
        block: input.block,
        ...(input.isEdit === undefined ? {} : { isEdit: input.isEdit }),
      }),
    ),
  ),
  orderItems: member.profile.orderItems.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => orderProfileItems(context.scope, input.ids)),
  ),
  archiveItem: member.profile.archiveItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      archiveProfileItem(context.scope, { id: input.id, archived: input.archived }),
    ),
  ),
  deleteItem: member.profile.deleteItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => deleteProfileItem(context.scope, input.id)),
  ),
});
