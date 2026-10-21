import { startWorkspace } from '@crm/core';
import { apiError, withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { sendMilestones } from '../../monitoring/milestones.ts';
import { authed } from '../../orpc.ts';

// Bootstrap: a session and a verified email; the workspace doesn't exist yet.
export const workspacesRouter = authed.workspaces.router({
  create: authed.workspaces.create.handler(async ({ context, input }) => {
    if (!context.user.emailVerified) {
      throw apiError('EMAIL_UNVERIFIED', 'Verify your email by signing in with a code, then create a workspace.');
    }
    // While sign up is closed, an account an invitation let in joins that workspace and starts none of its own
    // (spec 0031, owner decision 3), so one invitation can't grow into more people sending invitations.
    if (!context.mayStartWorkspace(context.user.email)) {
      throw apiError(
        'SIGNUP_CLOSED',
        'Making a workspace isn’t open yet. To join your team, open the invitation they emailed you.',
      );
    }
    // No hooks and no events (see commitWrite): its poke only costs the relay one empty look.
    const started = await commitWrite(context, undefined, () =>
      startWorkspace({ db: context.db, identity: context.identity }, context.user, input),
    ).catch((error: unknown) => {
      throw withInputFields(error, { SLUG_TAKEN: 'slug', ID_TAKEN: 'id' });
    });
    // Committed: `workspace_created` when this request made it (spec 0010, AC-175), nothing on a replay.
    sendMilestones(context, started.milestones);
    return { workspace: started.workspace };
  }),
});
