import { readMyPreferences, updateMyPreferences } from '@crm/core';
import { member } from '../../orpc.ts';
import { sourceOf } from '../invitations/public.ts';

// Settings › Account › Preferences: the caller's own, never another member's. A change is the member's own
// setting with no outbox row (like views.markOpened), and writes its audit entry in the same transaction.
export const preferencesRouter = member.preferences.router({
  get: member.preferences.get.handler(({ context }) => readMyPreferences(context.scope)),
  update: member.preferences.update.handler(({ context, input }) =>
    updateMyPreferences(context.scope, input, sourceOf(context)),
  ),
});
