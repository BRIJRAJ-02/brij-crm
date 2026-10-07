import { startWorkspace } from '@crm/core';
import { apiError, withInputFields } from '../../errors.ts';
import { authed } from '../../orpc.ts';

// Bootstrap: a session and a verified email; the workspace doesn't exist yet.
export const workspacesRouter = authed.workspaces.router({
  create: authed.workspaces.create.handler(async ({ context, input }) => {
    if (!context.user.emailVerified) {
      throw apiError('EMAIL_UNVERIFIED', 'Verify your email by signing in with a code, then create a workspace.');
    }
    let created: Awaited<ReturnType<typeof startWorkspace>>;
    try {
      created = await startWorkspace({ db: context.db, identity: context.identity }, context.user, input);
    } catch (error) {
      throw withInputFields(error, { SLUG_TAKEN: 'slug', ID_TAKEN: 'id' });
    }
    // The write committed: poke the relay (realtime/wake.ts). Every write procedure ends like this. This one
    // stores no outbox rows yet, so its poke only costs the relay one empty look.
    context.wakeRelay();
    return created;
  }),
});
