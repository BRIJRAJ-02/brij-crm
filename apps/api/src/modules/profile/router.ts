import { myPicturePath } from '@crm/contracts';
import { getMyProfile, servedPicture, updateMyMemberProfile, type ProfileExtras } from '@crm/core';
import type { SessionUser } from '../../auth/auth.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

/** The caller's account picture as our own origin serves it (`/api/me/picture?v=`), when it is one of Google's. */
function extrasOf(user: SessionUser): ProfileExtras {
  const picture = servedPicture(user.id, user.image);
  return picture === undefined ? {} : { image: myPicturePath(picture.version) };
}

// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own member row, behind the member door.
export const profileRouter = member.profile.router({
  get: member.profile.get.handler(({ context }) => getMyProfile(context.scope, extrasOf(context.user))),
  update: member.profile.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateMyMemberProfile(
        context.scope,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(input.handle === undefined ? {} : { handle: input.handle }),
          ...(input.bio === undefined ? {} : { bio: input.bio }),
          ...(input.pictureHidden === undefined ? {} : { pictureHidden: input.pictureHidden }),
        },
        extrasOf(context.user),
        hooks,
        sourceOf(context),
      ),
    ),
  ),
});
