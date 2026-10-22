import { getMyProfile, updateMyMemberProfile } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own member row, behind the member door.
export const profileRouter = member.profile.router({
  get: member.profile.get.handler(({ context }) => getMyProfile(context.scope)),
  update: member.profile.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateMyMemberProfile(
        context.scope,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(input.handle === undefined ? {} : { handle: input.handle }),
          ...(input.bio === undefined ? {} : { bio: input.bio }),
        },
        {},
        hooks,
        sourceOf(context),
      ),
    ),
  ),
});
